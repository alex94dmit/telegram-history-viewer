"use client";

import {
  ChangeEvent,
  DragEvent,
  Fragment,
  KeyboardEvent,
  ReactNode,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type RichTextPart =
  | string
  | {
      type?: string;
      text?: string;
      href?: string;
    };

type TelegramMessage = {
  id: number | string;
  type?: string;
  date?: string;
  date_unixtime?: string;
  edited?: string;
  from?: string;
  from_id?: string;
  actor?: string;
  actor_id?: string;
  action?: string;
  text?: string | RichTextPart[];
  text_entities?: RichTextPart[];
  reply_to_message_id?: number | string;
  forwarded_from?: string;
  saved_from?: string;
  photo?: string;
  file?: string;
  file_name?: string;
  file_size?: number;
  thumbnail?: string;
  media_type?: string;
  mime_type?: string;
  duration_seconds?: number;
  width?: number;
  height?: number;
  sticker_emoji?: string;
  media_spoiler?: boolean;
  discard_reason?: string;
  is_missed?: boolean;
  reactions?: Array<{
    type?: string;
    count?: number;
    emoji?: string;
    document_id?: string;
    recent?: Array<{ from?: string; from_id?: string; date?: string }>;
  }>;
  inline_bot_buttons?: Array<Array<{ text?: string; type?: string; data?: string }>>;
  contact_information?: { first_name?: string; last_name?: string; phone_number?: string };
  location_information?: { latitude?: number; longitude?: number };
  poll?: { question?: string; answers?: Array<{ text?: string; voters?: number; chosen?: boolean }> };
};

type TelegramChat = {
  name?: string;
  type?: string;
  id?: number | string;
  messages: TelegramMessage[];
};

type RawExport = TelegramChat & {
  chats?: { list?: TelegramChat[] };
};

type SenderFilter = "all" | "me" | "them";
type MediaFilter = "all" | "photos" | "videos" | "voice" | "files" | "links";
type MediaViewerItem = {
  kind: "photo" | "video";
  url: string;
  label: string;
  alt: string;
  mimeType?: string;
  posterUrl?: string;
};

const demoChat: TelegramChat = {
  name: "Alex Chen",
  type: "personal_chat",
  id: 12804019,
  messages: [
    {
      id: 101,
      type: "message",
      date: "2024-03-14T18:42:00",
      from: "Alex Chen",
      from_id: "user12804019",
      text: "I found the tiny bookstore I was telling you about.",
    },
    {
      id: 102,
      type: "message",
      date: "2024-03-14T18:43:00",
      from: "Jamie",
      from_id: "user901121",
      text: "The one with the blue door?",
    },
    {
      id: 103,
      type: "message",
      date: "2024-03-14T18:44:00",
      from: "Alex Chen",
      from_id: "user12804019",
      text: [
        "Yes — and it has a reading room upstairs. ",
        { type: "italic", text: "Dangerous for my wallet." },
      ],
    },
    {
      id: 104,
      type: "message",
      date: "2024-03-14T18:46:00",
      from: "Jamie",
      from_id: "user901121",
      reply_to_message_id: 103,
      text: "Saturday morning? I’ll bring coffee.",
    },
    {
      id: 105,
      type: "message",
      date: "2024-03-14T18:48:00",
      from: "Alex Chen",
      from_id: "user12804019",
      text: [
        "Perfect. Here’s the place: ",
        { type: "link", text: "Open map", href: "https://maps.google.com" },
      ],
    },
    {
      id: 106,
      type: "message",
      date: "2024-05-02T09:11:00",
      from: "Jamie",
      from_id: "user901121",
      text: "Still laughing about the cat asleep in the poetry section.",
    },
    {
      id: 107,
      type: "message",
      date: "2024-05-02T09:14:00",
      from: "Alex Chen",
      from_id: "user12804019",
      text: "Best employee there, honestly. 🐈",
    },
  ],
};

const monthFormatter = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const dayFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});
const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const shortDateFormatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });

function messageText(message: TelegramMessage): string {
  const source = message.text_entities ?? message.text ?? "";
  if (typeof source === "string") return source;
  if (!Array.isArray(source)) return "";
  return source.map((part) => (typeof part === "string" ? part : part.text ?? "")).join("");
}

function normalizePath(path: string) {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function safeDate(message: TelegramMessage) {
  const raw = message.date ?? (message.date_unixtime ? Number(message.date_unixtime) * 1000 : undefined);
  const date = raw ? new Date(raw) : new Date(0);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function dayKey(message: TelegramMessage) {
  const date = safeDate(message);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function monthKey(message: TelegramMessage) {
  const date = safeDate(message);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function sameMessageGroup(first?: TelegramMessage, second?: TelegramMessage) {
  if (!first || !second || first.type === "service" || second.type === "service") return false;
  const firstSender = first.from_id ?? first.from;
  const secondSender = second.from_id ?? second.from;
  const gap = Math.abs(safeDate(second).getTime() - safeDate(first).getTime());
  return firstSender === secondSender && dayKey(first) === dayKey(second) && gap <= 5 * 60 * 1000;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "TG";
}

function mediaKind(message: TelegramMessage): MediaFilter | null {
  const mime = message.mime_type ?? "";
  const type = message.media_type ?? "";
  if (message.photo || mime.startsWith("image/") || type === "photo") return "photos";
  if (mime.startsWith("video/") || type === "video_file" || type === "animation" || type === "video_message") return "videos";
  if (mime.startsWith("audio/") || type === "voice_message" || type === "audio_file") return "voice";
  if (message.file) return "files";
  if (/https?:\/\//i.test(messageText(message))) return "links";
  const entities = message.text_entities ?? (Array.isArray(message.text) ? message.text : []);
  if (Array.isArray(entities) && entities.some((part) => typeof part !== "string" && ["link", "text_link"].includes(part.type ?? ""))) {
    return "links";
  }
  return null;
}

function formatDuration(seconds?: number) {
  if (!seconds) return "";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatFileSize(bytes?: number) {
  if (!bytes || bytes < 1) return "";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

function TelegramAudio({ src, duration }: { src: string; duration?: number }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [knownDuration, setKnownDuration] = useState(duration ?? 0);
  const bars = [7, 12, 16, 10, 19, 13, 8, 17, 21, 12, 15, 9, 18, 14, 20, 11, 16, 8, 13, 18, 10, 15];
  const progress = knownDuration ? Math.min(100, (currentTime / knownDuration) * 100) : 0;

  async function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      await audio.play();
      setPlaying(true);
    } else {
      audio.pause();
      setPlaying(false);
    }
  }

  return (
    <div className="telegram-audio">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={(event) => setKnownDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : duration ?? 0)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onEnded={() => setPlaying(false)}
      />
      <button type="button" onClick={() => void toggle()} aria-label={playing ? "Pause voice message" : "Play voice message"}>{playing ? "Ⅱ" : "▶"}</button>
      <div className="audio-track">
        <input
          type="range"
          min="0"
          max={knownDuration || 1}
          step="0.1"
          value={currentTime}
          onChange={(event) => {
            const value = Number(event.target.value);
            setCurrentTime(value);
            if (audioRef.current) audioRef.current.currentTime = value;
          }}
          aria-label="Voice message position"
        />
        <div className="waveform" aria-hidden="true">
          <div className="waveform-base">{bars.map((height, index) => <i key={index} style={{ height }} />)}</div>
          <div className="waveform-progress" style={{ width: `${progress}%` }}>{bars.map((height, index) => <i key={index} style={{ height }} />)}</div>
        </div>
        <small>{formatDuration(Math.round(currentTime || knownDuration))}</small>
      </div>
    </div>
  );
}

function TelegramTgsSticker({ src, emoji }: { src: string; emoji?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let disposed = false;
    let animation: { destroy: () => void } | undefined;

    void (async () => {
      try {
        const response = await fetch(src);
        if (!response.body) throw new Error("Sticker file is empty");
        const stream = response.body.pipeThrough(new DecompressionStream("gzip"));
        const animationData = JSON.parse(await new Response(stream).text());
        const lottie = (await import("lottie-web/build/player/lottie_light")).default;
        if (disposed || !containerRef.current) return;
        animation = lottie.loadAnimation({
          container: containerRef.current,
          renderer: "svg",
          loop: true,
          autoplay: true,
          animationData,
          rendererSettings: { progressiveLoad: true },
        });
      } catch {
        if (!disposed) setFailed(true);
      }
    })();

    return () => {
      disposed = true;
      animation?.destroy();
    };
  }, [src]);

  return (
    <div className={`tgs-sticker${failed ? " failed" : ""}`} aria-label="Animated Telegram sticker">
      <div ref={containerRef} />
      {failed && <span>{emoji || "✦"}</span>}
    </div>
  );
}

function safeHref(href: string) {
  if (/^(https?:|mailto:|tel:)/i.test(href)) return href;
  return undefined;
}

function serviceMessageText(message: TelegramMessage) {
  const existing = messageText(message);
  if (existing) return existing;
  const actor = message.actor ?? "Someone";
  if (message.action === "phone_call") {
    const callType = message.is_missed || message.discard_reason === "missed" ? "Missed call" : "Call";
    return `${actor} · ${callType}${message.duration_seconds ? ` · ${formatDuration(message.duration_seconds)}` : ""}`;
  }
  if (message.action === "conference_call") return `${actor} started a conference call`;
  if (message.action === "joined_telegram") return `${actor} joined Telegram`;
  if (message.action === "send_star_gift" || message.action === "send_stars_gift") return `${actor} sent a Telegram gift`;
  return `${actor} ${message.action?.replaceAll("_", " ") ?? "updated the chat"}`;
}

function highlightText(text: string, query: string): ReactNode {
  if (!query.trim()) return text;
  const needle = query.trim();
  const parts = text.split(new RegExp(`(${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
  return parts.map((part, index) =>
    part.toLocaleLowerCase().includes(needle.toLocaleLowerCase()) ? <mark key={index}>{part}</mark> : part,
  );
}

function renderRichText(message: TelegramMessage, query: string) {
  const source = message.text_entities ?? message.text ?? "";
  const parts: RichTextPart[] = typeof source === "string" ? [source] : Array.isArray(source) ? source : [];

  return parts.map((part, index) => {
    if (typeof part === "string") return <Fragment key={index}>{highlightText(part, query)}</Fragment>;
    const text = part.text ?? "";
    const content = highlightText(text, query);
    const type = part.type ?? "";
    if (["bold"].includes(type)) return <strong key={index}>{content}</strong>;
    if (["italic"].includes(type)) return <em key={index}>{content}</em>;
    if (["underline"].includes(type)) return <u key={index}>{content}</u>;
    if (["strikethrough"].includes(type)) return <s key={index}>{content}</s>;
    if (["code", "pre"].includes(type)) return <code key={index}>{content}</code>;
    if (type === "blockquote") return <span className="inline-blockquote" key={index}>{content}</span>;
    if (type === "spoiler") return <span className="text-spoiler" key={index} tabIndex={0}>{content}</span>;
    if (["link", "text_link", "email", "phone"].includes(type)) {
      const fallback = type === "email" ? `mailto:${text}` : type === "phone" ? `tel:${text}` : text;
      const href = safeHref(part.href ?? fallback);
      return href ? (
        <a key={index} href={href} target="_blank" rel="noreferrer">
          {content}
        </a>
      ) : (
        <Fragment key={index}>{content}</Fragment>
      );
    }
    return <Fragment key={index}>{content}</Fragment>;
  });
}

function extractChat(data: RawExport): TelegramChat {
  if (Array.isArray(data.messages)) return data;
  const chats = data.chats?.list?.filter((chat) => Array.isArray(chat.messages)) ?? [];
  if (!chats.length) throw new Error("No Telegram messages were found in this JSON file.");
  return chats.reduce((largest, chat) => (chat.messages.length > largest.messages.length ? chat : largest), chats[0]);
}

export default function Home() {
  const [chat, setChat] = useState<TelegramChat>(demoChat);
  const [isDemo, setIsDemo] = useState(true);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [senderFilter, setSenderFilter] = useState<SenderFilter>("all");
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>("all");
  const [monthFilter, setMonthFilter] = useState("all");
  const [visibleLimit, setVisibleLimit] = useState(240);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [sourceLabel, setSourceLabel] = useState("Sample archive");
  const [mediaFileCount, setMediaFileCount] = useState(0);
  const [viewerMedia, setViewerMedia] = useState<MediaViewerItem | null>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const mediaFilesRef = useRef(new Map<string, File>());
  const mediaUrlsRef = useRef(new Map<string, string>());
  const viewerUrlRef = useRef<string | null>(null);
  const viewerPosterUrlRef = useRef<string | null>(null);
  const messageListRef = useRef<HTMLDivElement>(null);

  const closeMediaViewer = useCallback(() => {
    if (viewerUrlRef.current) URL.revokeObjectURL(viewerUrlRef.current);
    if (viewerPosterUrlRef.current) URL.revokeObjectURL(viewerPosterUrlRef.current);
    viewerUrlRef.current = null;
    viewerPosterUrlRef.current = null;
    setViewerMedia(null);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (!viewerMedia) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") closeMediaViewer();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [viewerMedia, closeMediaViewer]);

  const messagesById = useMemo(
    () => new Map(chat.messages.map((message) => [String(message.id), message])),
    [chat.messages],
  );

  const participants = useMemo(() => {
    const counts = new Map<string, number>();
    chat.messages.forEach((message) => {
      const name = message.from ?? message.actor;
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  }, [chat.messages]);

  const otherName = chat.name ?? participants[0] ?? "Contact";
  const meName = participants.find((name) => name !== otherName) ?? participants[1] ?? "You";
  const peerIdDigits = String(chat.id ?? "").replace(/\D/g, "");
  const isMine = (message: TelegramMessage) => {
    const senderIdDigits = String(message.from_id ?? message.actor_id ?? "").replace(/\D/g, "");
    if (peerIdDigits && senderIdDigits) return senderIdDigits !== peerIdDigits;
    return (message.from ?? message.actor) === meName;
  };

  const months = useMemo(() => {
    const unique = new Map<string, Date>();
    chat.messages.forEach((message) => unique.set(monthKey(message), safeDate(message)));
    return [...unique.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [chat.messages]);

  const filteredMessages = useMemo(() => {
    const needle = deferredQuery.trim().toLocaleLowerCase();
    return chat.messages.filter((message) => {
      if (senderFilter === "me" && !isMine(message)) return false;
      if (senderFilter === "them" && isMine(message)) return false;
      if (monthFilter !== "all" && monthKey(message) !== monthFilter) return false;
      if (mediaFilter !== "all" && mediaKind(message) !== mediaFilter) return false;
      if (needle && !`${messageText(message)} ${message.from ?? ""} ${message.forwarded_from ?? ""}`.toLocaleLowerCase().includes(needle)) {
        return false;
      }
      return true;
    });
  }, [chat.messages, deferredQuery, senderFilter, monthFilter, mediaFilter, meName]);

  const visibleMessages = filteredMessages.slice(-visibleLimit);
  const hiddenCount = Math.max(0, filteredMessages.length - visibleMessages.length);
  const latestMessage = chat.messages.at(-1);
  const latestPreview = latestMessage ? (messageText(latestMessage) || (mediaKind(latestMessage) ? "Attachment" : serviceMessageText(latestMessage))) : "No messages";

  const stats = useMemo(() => {
    const media = { photos: 0, videos: 0, voice: 0, files: 0, links: 0 };
    chat.messages.forEach((message) => {
      const kind = mediaKind(message);
      if (kind) media[kind] += 1;
    });
    const first = chat.messages[0] ? safeDate(chat.messages[0]) : undefined;
    const last = chat.messages.at(-1) ? safeDate(chat.messages.at(-1)!) : undefined;
    return { ...media, first, last };
  }, [chat.messages]);
  const needsMediaFolder = !isDemo && mediaFileCount === 0 && stats.photos + stats.videos + stats.voice + stats.files > 0;

  function resetObjectUrls() {
    mediaUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    mediaUrlsRef.current.clear();
  }

  function mediaFile(path?: string) {
    if (!path) return undefined;
    const normalized = normalizePath(path);
    return mediaFilesRef.current.get(normalized) ?? mediaFilesRef.current.get(normalized.split("/").at(-1) ?? normalized);
  }

  function resolveMedia(path?: string) {
    if (!path) return undefined;
    const normalized = normalizePath(path);
    if (mediaUrlsRef.current.has(normalized)) return mediaUrlsRef.current.get(normalized);
    const file = mediaFile(normalized);
    if (!file) return undefined;
    const url = URL.createObjectURL(file);
    mediaUrlsRef.current.set(normalized, url);
    return url;
  }

  function openMediaViewer(
    path: string,
    label: string,
    alt: string,
    kind: "photo" | "video",
    mimeType?: string,
    posterPath?: string,
  ) {
    const file = mediaFile(path);
    if (!file) return;
    if (viewerUrlRef.current) URL.revokeObjectURL(viewerUrlRef.current);
    if (viewerPosterUrlRef.current) URL.revokeObjectURL(viewerPosterUrlRef.current);
    const url = URL.createObjectURL(file);
    const posterFile = mediaFile(posterPath);
    const posterUrl = posterFile ? URL.createObjectURL(posterFile) : undefined;
    viewerUrlRef.current = url;
    viewerPosterUrlRef.current = posterUrl ?? null;
    setViewerMedia({ kind, url, label, alt, mimeType, posterUrl });
  }

  async function loadFiles(fileList: FileList | File[]) {
    setError("");
    const files = Array.from(fileList);
    const jsonFile = files.find((file) => file.name.toLocaleLowerCase() === "result.json") ?? files.find((file) => file.name.endsWith(".json"));
    if (!jsonFile) {
      setError("Choose the Telegram export folder or its result.json file.");
      return;
    }

    try {
      const data = JSON.parse(await jsonFile.text()) as RawExport;
      const nextChat = extractChat(data);
      closeMediaViewer();
      resetObjectUrls();
      const media = new Map<string, File>();
      files.forEach((file) => {
        const relative = normalizePath(file.webkitRelativePath || file.name);
        media.set(relative, file);
        const withoutRoot = relative.includes("/") ? relative.slice(relative.indexOf("/") + 1) : relative;
        media.set(withoutRoot, file);
        if (!media.has(file.name)) media.set(file.name, file);
      });
      mediaFilesRef.current = media;
      setMediaFileCount(Math.max(0, files.length - 1));
      setChat({ ...nextChat, messages: nextChat.messages.slice().sort((a, b) => safeDate(a).getTime() - safeDate(b).getTime()) });
      setIsDemo(false);
      setSourceLabel(jsonFile.webkitRelativePath?.split("/")[0] || jsonFile.name);
      setQuery("");
      setSenderFilter("all");
      setMediaFilter("all");
      setMonthFilter("all");
      setVisibleLimit(240);
      requestAnimationFrame(() => messageListRef.current?.scrollTo({ top: messageListRef.current.scrollHeight }));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "This file could not be read as a Telegram export.");
    }
  }

  function onFolderChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files?.length) void loadFiles(event.target.files);
    event.target.value = "";
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length) void loadFiles(event.dataTransfer.files);
  }

  function clearFilters() {
    setQuery("");
    setSenderFilter("all");
    setMediaFilter("all");
    setMonthFilter("all");
    setVisibleLimit(240);
  }

  function scrollToMessage(id: number | string) {
    const element = document.getElementById(`message-${id}`);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
      element.classList.add("message-flash");
      window.setTimeout(() => element.classList.remove("message-flash"), 1400);
    }
  }

  function searchKeyboard(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") setQuery("");
  }

  function renderMedia(message: TelegramMessage) {
    const path = message.photo ?? message.file;
    if (!path) return null;
    const url = resolveMedia(path);
    const kind = mediaKind(message);
    const label = message.file_name ?? path.split(/[\\/]/).at(-1) ?? "Attachment";
    const wrapSpoiler = (content: ReactNode) => message.media_spoiler ? (
      <details className="media-spoiler">
        <summary>Reveal media spoiler</summary>
        {content}
      </details>
    ) : content;

    if (message.media_type === "sticker") {
      if (message.mime_type === "application/x-tgsticker" && url) return <TelegramTgsSticker src={url} emoji={message.sticker_emoji} />;
      if (url) {
        return (
          <a className="sticker-media" href={url} target="_blank" rel="noreferrer" aria-label="Open sticker">
            <img src={url} alt={message.sticker_emoji ? `Sticker ${message.sticker_emoji}` : "Telegram sticker"} />
          </a>
        );
      }
    }

    if (kind === "photos" && url) {
      const alt = messageText(message) || label;
      return wrapSpoiler(
        <button className="media-photo" type="button" onClick={() => openMediaViewer(path, label, alt, "photo")} aria-label={`View ${label}`}>
          {/* Browser-created object URLs never leave this device. */}
          <img src={url} alt={alt} />
        </button>,
      );
    }
    if (kind === "videos" && url) {
      const animation = message.media_type === "animation";
      const round = message.media_type === "video_message";
      const poster = resolveMedia(message.thumbnail);
      return wrapSpoiler(
        <div className={`telegram-video-frame${round ? " round-video-frame" : ""}`}>
          <video
            className={`media-video${round ? " round-video" : ""}${animation ? " telegram-gif" : ""}`}
            controls={!animation}
            controlsList="nofullscreen noremoteplayback"
            disablePictureInPicture
            autoPlay={animation}
            loop={animation}
            muted={animation}
            playsInline
            preload={animation ? "auto" : "metadata"}
            poster={poster}
            width={message.width}
            height={message.height}
          >
            <source src={url} type={message.mime_type || "video/mp4"} />
          </video>
          <button
            className="video-open-viewer"
            type="button"
            aria-label={`Open ${label} in media viewer`}
            onClick={(event) => {
              event.currentTarget.parentElement?.querySelector("video")?.pause();
              openMediaViewer(path, label, messageText(message) || label, "video", message.mime_type || "video/mp4", message.thumbnail);
            }}
          >
            ⛶
          </button>
        </div>,
      );
    }
    if (kind === "voice" && url) {
      return <TelegramAudio src={url} duration={message.duration_seconds} />;
    }
    const cardContent = (
      <>
        <span className="file-icon">{kind === "photos" ? "IMG" : kind === "videos" ? "VID" : kind === "voice" ? "AUD" : "FILE"}</span>
        <span>
          <strong>{label}</strong>
          <small>{url ? [formatFileSize(message.file_size), "Open attachment"].filter(Boolean).join(" · ") : "Select the full export folder to open media"}</small>
        </span>
      </>
    );
    return url ? (
      <a className="file-card" href={url} download={label}>{cardContent}</a>
    ) : (
      <button className="file-card is-missing" type="button" onClick={() => folderInputRef.current?.click()}>{cardContent}</button>
    );
  }

  return (
    <main
      className={`app-shell${dragging ? " is-dragging" : ""}`}
      onDragEnter={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <input
        ref={folderInputRef}
        className="visually-hidden"
        type="file"
        onChange={onFolderChange}
        {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
      />
      <input ref={jsonInputRef} className="visually-hidden" type="file" accept=".json,application/json" onChange={onFolderChange} />

      <section className="workspace">
        <aside className="sidebar">
          <div className="sidebar-toolbar">
            <button className="telegram-menu" type="button" onClick={() => setTheme(theme === "light" ? "dark" : "light")} aria-label={`Use ${theme === "light" ? "dark" : "light"} theme`}>
              {theme === "light" ? "☰" : "☀"}
            </button>
            <div className="telegram-brand"><strong>Stillgram</strong><small>local archive</small></div>
            <button className="telegram-compose" type="button" onClick={() => folderInputRef.current?.click()} aria-label="Open Telegram export">＋</button>
          </div>

          <div className="chat-list-label">Chats</div>
          <button className="chat-list-row selected" type="button" onClick={clearFilters}>
            <div className="avatar large">{initials(otherName)}</div>
            <div className="chat-list-copy">
              <span><strong>{otherName}</strong><time>{latestMessage ? shortDateFormatter.format(safeDate(latestMessage)) : ""}</time></span>
              <p>{latestPreview}</p>
            </div>
          </button>

          <div className="archive-source">
            <span className="source-icon">✓</span>
            <div>
              <strong>{sourceLabel}</strong>
              <small>{isDemo ? "Sample conversation" : "On-device only · loaded locally"}</small>
            </div>
          </div>

          <nav className="filter-section" aria-label="Message filters">
            <span className="section-label">Message filters</span>
            <button className={senderFilter === "all" ? "active" : ""} onClick={() => setSenderFilter("all")} type="button"><span>☷</span> All messages <b>{chat.messages.length.toLocaleString()}</b></button>
            <button className={senderFilter === "me" ? "active" : ""} onClick={() => setSenderFilter("me")} type="button"><span>↗</span> Sent by you</button>
            <button className={senderFilter === "them" ? "active" : ""} onClick={() => setSenderFilter("them")} type="button"><span>↙</span> Sent by {otherName.split(" ")[0]}</button>
          </nav>

          <div className="filter-section media-filters">
            <span className="section-label">Media & links</span>
            {([
              ["photos", "▧", "Photos", stats.photos],
              ["videos", "▷", "Videos", stats.videos],
              ["voice", "≋", "Audio", stats.voice],
              ["files", "□", "Files", stats.files],
              ["links", "↗", "Links", stats.links],
            ] as const).map(([value, icon, label, count]) => (
              <button key={value} className={mediaFilter === value ? "active" : ""} onClick={() => setMediaFilter(mediaFilter === value ? "all" : value)} type="button">
                <span>{icon}</span> {label} <b>{count}</b>
              </button>
            ))}
          </div>

          <div className="sidebar-foot">
            <span className="privacy-dot">●</span>
            <p><strong>Private archive</strong>Your files stay in this browser tab.</p>
          </div>
        </aside>

        <section className="conversation-panel">
          <div className="conversation-toolbar">
            <div className="chat-header-title">
              <div className="avatar">{initials(otherName)}</div>
              <span><strong>{otherName}</strong><small>{chat.messages.length.toLocaleString()} archived messages</small></span>
            </div>
            <label className="search-box">
              <span aria-hidden="true">⌕</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={searchKeyboard} placeholder="Search this conversation" aria-label="Search this conversation" />
              {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search">×</button>}
            </label>
            <select value={monthFilter} onChange={(event) => setMonthFilter(event.target.value)} aria-label="Filter by month">
              <option value="all">Any date</option>
              {months.map(([key, date]) => <option key={key} value={key}>{monthFormatter.format(date)}</option>)}
            </select>
          </div>

          {isDemo && (
            <div className="welcome-strip">
              <span className="welcome-lock">◇</span>
              <div>
                <strong>This is a sample conversation</strong>
                <p>Open your Telegram export folder to replace it. Nothing is uploaded.</p>
              </div>
              <button type="button" onClick={() => folderInputRef.current?.click()}>Choose folder</button>
              <button className="text-button" type="button" onClick={() => jsonInputRef.current?.click()}>Messages only (.json)</button>
            </div>
          )}

          {needsMediaFolder && (
            <div className="media-connect-banner" role="status">
              <span>▧</span>
              <div><strong>Media folder isn’t connected</strong><p>Choose the complete ChatExport folder to display photos, GIFs, stickers, voice notes, and videos.</p></div>
              <button type="button" onClick={() => folderInputRef.current?.click()}>Connect media</button>
            </div>
          )}

          {error && <div className="error-banner" role="alert"><strong>Couldn’t open that export.</strong><span>{error}</span><button type="button" onClick={() => setError("")}>×</button></div>}

          <div className="mobile-filter-bar" aria-label="Mobile message filters">
            <button className={senderFilter === "all" ? "active" : ""} type="button" onClick={() => setSenderFilter("all")}>All</button>
            <button className={senderFilter === "me" ? "active" : ""} type="button" onClick={() => setSenderFilter("me")}>You</button>
            <button className={senderFilter === "them" ? "active" : ""} type="button" onClick={() => setSenderFilter("them")}>{otherName.split(" ")[0]}</button>
            <select value={mediaFilter} onChange={(event) => setMediaFilter(event.target.value as MediaFilter)} aria-label="Filter media">
              <option value="all">All types</option>
              <option value="photos">Photos</option>
              <option value="videos">Videos</option>
              <option value="voice">Audio</option>
              <option value="files">Files</option>
              <option value="links">Links</option>
            </select>
          </div>

          <div className="message-list" ref={messageListRef}>
            {hiddenCount > 0 && (
              <button className="load-older" type="button" onClick={() => setVisibleLimit((limit) => limit + 300)}>
                Show {Math.min(300, hiddenCount).toLocaleString()} earlier messages
              </button>
            )}

            {visibleMessages.length === 0 ? (
              <div className="empty-state">
                <span>⌕</span>
                <h2>No messages found</h2>
                <p>Try a different word, date, or media filter.</p>
                <button type="button" onClick={clearFilters}>Clear filters</button>
              </div>
            ) : (
              visibleMessages.map((message, index) => {
                const previous = visibleMessages[index - 1];
                const next = visibleMessages[index + 1];
                const showDate = !previous || dayKey(previous) !== dayKey(message);
                const mine = isMine(message);
                const joinsPrevious = sameMessageGroup(previous, message);
                const joinsNext = sameMessageGroup(message, next);
                const reply = message.reply_to_message_id ? messagesById.get(String(message.reply_to_message_id)) : undefined;
                const service = message.type === "service";
                return (
                  <Fragment key={`${message.id}-${index}`}>
                    {showDate && <div className="date-divider"><span>{dayFormatter.format(safeDate(message))}</span></div>}
                    {service ? (
                      <div className="service-message">{serviceMessageText(message)}</div>
                    ) : (
                      <article id={`message-${message.id}`} className={`message-row ${mine ? "mine" : "theirs"}${joinsPrevious ? " joins-previous" : ""}${joinsNext ? " joins-next" : ""}`}>
                        <div className="bubble-wrap">
                          <div className={`message-bubble${message.media_type === "sticker" ? " sticker-bubble" : ""}`}>
                            {message.forwarded_from && <div className="forwarded">Forwarded from {message.forwarded_from}</div>}
                            {reply && (
                              <button className="reply-preview" type="button" onClick={() => scrollToMessage(reply.id)}>
                                <strong>{reply.from ?? "Message"}</strong>
                                <span>{messageText(reply) || "Attachment"}</span>
                              </button>
                            )}
                            {renderMedia(message)}
                            {message.poll && (
                              <div className="poll-card">
                                <strong>{message.poll.question ?? "Poll"}</strong>
                                {message.poll.answers?.map((answer, answerIndex) => (
                                  <div className={answer.chosen ? "chosen" : ""} key={answerIndex}><span>{answer.text}</span><b>{answer.voters ?? 0}</b></div>
                                ))}
                              </div>
                            )}
                            {message.contact_information && (
                              <div className="contact-card"><span className="avatar tiny">{initials(`${message.contact_information.first_name ?? ""} ${message.contact_information.last_name ?? ""}`)}</span><span><strong>{message.contact_information.first_name} {message.contact_information.last_name}</strong><small>{message.contact_information.phone_number}</small></span></div>
                            )}
                            {message.location_information && (
                              <a className="location-card" href={`https://www.openstreetmap.org/?mlat=${message.location_information.latitude}&mlon=${message.location_information.longitude}`} target="_blank" rel="noreferrer">⌖ <span><strong>Shared location</strong><small>Open in map</small></span></a>
                            )}
                            {messageText(message) && <p className="message-copy">{renderRichText(message, deferredQuery)}</p>}
                            {message.inline_bot_buttons?.length ? (
                              <div className="bot-buttons">
                                {message.inline_bot_buttons.flat().map((button, buttonIndex) => <span key={buttonIndex}>{button.text || "Telegram button"}</span>)}
                              </div>
                            ) : null}
                            {message.reactions?.length ? (
                              <div className="reactions" aria-label="Message reactions">
                                {message.reactions.map((reaction, reactionIndex) => (
                                  <span key={`${reaction.emoji ?? reaction.document_id ?? "reaction"}-${reactionIndex}`} title={reaction.recent?.map((item) => item.from).filter(Boolean).join(", ") || undefined}>
                                    {reaction.emoji || "✦"}<b>{reaction.count ?? 1}</b>
                                  </span>
                                ))}
                              </div>
                            ) : null}
                            <span className="message-meta">{message.edited && <span>edited</span>}{timeFormatter.format(safeDate(message))}</span>
                          </div>
                        </div>
                      </article>
                    )}
                  </Fragment>
                );
              })
            )}
            {visibleMessages.length > 0 && <div className="end-marker"><span>End of selected messages</span></div>}
          </div>
        </section>
      </section>

      {viewerMedia && (
        <div
          className="media-viewer"
          role="dialog"
          aria-modal="true"
          aria-label={`Viewing ${viewerMedia.label}`}
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) closeMediaViewer();
          }}
        >
          <div className="media-viewer-toolbar">
            <div><strong>{viewerMedia.label}</strong><span>{viewerMedia.kind === "photo" ? "Photo" : "Video"} from this archive</span></div>
            <a href={viewerMedia.url} download={viewerMedia.label} aria-label={`Download ${viewerMedia.kind}`}>↓</a>
            <button type="button" onClick={closeMediaViewer} aria-label="Close media viewer" autoFocus>×</button>
          </div>
          <div
            className="media-viewer-stage"
            onMouseDown={(event) => {
              if (event.currentTarget === event.target) closeMediaViewer();
            }}
          >
            {viewerMedia.kind === "photo" ? (
              <img src={viewerMedia.url} alt={viewerMedia.alt} />
            ) : (
              <video
                className="media-viewer-video"
                controls
                controlsList="nofullscreen noremoteplayback"
                disablePictureInPicture
                autoPlay
                playsInline
                preload="metadata"
                poster={viewerMedia.posterUrl}
                aria-label={viewerMedia.alt}
              >
                <source src={viewerMedia.url} type={viewerMedia.mimeType || "video/mp4"} />
              </video>
            )}
          </div>
        </div>
      )}

      {dragging && <div className="drop-overlay"><div><span>⇩</span><strong>Drop your Telegram export</strong><p>Use result.json, or choose the folder to include media.</p></div></div>}
    </main>
  );
}
