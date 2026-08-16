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

type ArchiveFileEntry = {
  file: File;
  relativePath: string;
};

type CachedArchiveRecord = ArchiveFileEntry;
type CachedArchiveMetadata = {
  label: string;
  count: number;
  cachedAt: number;
};
type ArchiveCacheStatus = "checking" | "saving" | "saved" | "idle" | "unavailable";

type SenderFilter = "all" | "me" | "them";
type MediaFilter = "all" | "photos" | "videos" | "voice" | "files" | "links";
type LibraryMediaFilter = "all" | "photos" | "videos";
type MediaViewerItem = {
  kind: "photo" | "video";
  url: string;
  label: string;
  alt: string;
  mimeType?: string;
  posterUrl?: string;
};

type LinkPreviewData = {
  url: string;
  siteName?: string;
  title?: string;
  description?: string;
  image?: string;
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
const mediaDateFormatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const ARCHIVE_CACHE_DATABASE = "stillgram-local-archive-files";
const ARCHIVE_FILES_STORE = "files";
const ARCHIVE_META_STORE = "metadata";
const ARCHIVE_CACHE_KEY = "current-archive";
const CHAT_REMOVED_STORAGE_KEY = "stillgram:chat-removed";

function messageText(message: TelegramMessage): string {
  const source = message.text_entities ?? message.text ?? "";
  if (typeof source === "string") return source;
  if (!Array.isArray(source)) return "";
  return source.map((part) => (typeof part === "string" ? part : part.text ?? "")).join("");
}

function normalizePath(path: string) {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function openArchiveCache() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(ARCHIVE_CACHE_DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(ARCHIVE_FILES_STORE)) {
        request.result.createObjectStore(ARCHIVE_FILES_STORE, { keyPath: "relativePath" });
      }
      if (!request.result.objectStoreNames.contains(ARCHIVE_META_STORE)) {
        request.result.createObjectStore(ARCHIVE_META_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function waitForTransaction(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function requestValue<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readCachedArchive() {
  if (typeof indexedDB === "undefined") return undefined;
  try {
    const database = await openArchiveCache();
    const transaction = database.transaction([ARCHIVE_FILES_STORE, ARCHIVE_META_STORE], "readonly");
    const recordsRequest = transaction.objectStore(ARCHIVE_FILES_STORE).getAll() as IDBRequest<CachedArchiveRecord[]>;
    const metadataRequest = transaction.objectStore(ARCHIVE_META_STORE).get(ARCHIVE_CACHE_KEY) as IDBRequest<CachedArchiveMetadata | undefined>;
    const [entries, metadata] = await Promise.all([requestValue(recordsRequest), requestValue(metadataRequest)]);
    await waitForTransaction(transaction);
    database.close();
    if (!metadata || !entries.length || metadata.count !== entries.length) return undefined;
    return { entries, label: metadata.label };
  } catch {
    return undefined;
  }
}

async function cacheArchive(entries: ArchiveFileEntry[], label: string) {
  if (typeof indexedDB === "undefined") return false;
  try {
    const database = await openArchiveCache();
    const transaction = database.transaction([ARCHIVE_FILES_STORE, ARCHIVE_META_STORE], "readwrite");
    const filesStore = transaction.objectStore(ARCHIVE_FILES_STORE);
    filesStore.clear();
    entries.forEach((entry) => filesStore.put(entry));
    transaction.objectStore(ARCHIVE_META_STORE).put({
      label,
      count: entries.length,
      cachedAt: Date.now(),
    } satisfies CachedArchiveMetadata, ARCHIVE_CACHE_KEY);
    await waitForTransaction(transaction);
    database.close();
    return true;
  } catch {
    // The archive still opens when browser storage is unavailable or full.
    return false;
  }
}

async function clearCachedArchive() {
  if (typeof indexedDB === "undefined") return false;
  try {
    const database = await openArchiveCache();
    const transaction = database.transaction([ARCHIVE_FILES_STORE, ARCHIVE_META_STORE], "readwrite");
    transaction.objectStore(ARCHIVE_FILES_STORE).clear();
    transaction.objectStore(ARCHIVE_META_STORE).delete(ARCHIVE_CACHE_KEY);
    await waitForTransaction(transaction);
    database.close();
    return true;
  } catch {
    return false;
  }
}

function archiveEntries(fileList: FileList | File[]) {
  return Array.from(fileList).map((file) => ({
    file,
    relativePath: file.webkitRelativePath || file.name,
  }));
}

function archiveLabel(entries: ArchiveFileEntry[]) {
  const jsonEntry = entries.find(({ file }) => file.name.toLocaleLowerCase() === "result.json")
    ?? entries.find(({ file }) => file.name.toLocaleLowerCase().endsWith(".json"));
  return jsonEntry?.relativePath.includes("/")
    ? jsonEntry.relativePath.slice(0, jsonEntry.relativePath.indexOf("/"))
    : jsonEntry?.file.name ?? "Telegram export";
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

const DEFAULT_MESSAGE_LIMIT = 240;
const MEDIA_MESSAGE_LIMIT = 60;

function useNearViewport<T extends Element>(rootMargin = "500px 0px") {
  const elementRef = useRef<T>(null);
  const [nearViewport, setNearViewport] = useState(false);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    if (typeof IntersectionObserver === "undefined") {
      setNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setNearViewport((current) => entry.isIntersecting === current ? current : entry.isIntersecting),
      { root: element.closest(".message-list"), rootMargin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [rootMargin]);

  return [elementRef, nearViewport] as const;
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
  const [containerRef, nearViewport] = useNearViewport<HTMLDivElement>();
  const audioRef = useRef<HTMLAudioElement>(null);
  const currentTimeRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [knownDuration, setKnownDuration] = useState(duration ?? 0);
  const bars = [7, 12, 16, 10, 19, 13, 8, 17, 21, 12, 15, 9, 18, 14, 20, 11, 16, 8, 13, 18, 10, 15];
  const progress = knownDuration ? Math.min(100, (currentTime / knownDuration) * 100) : 0;
  const active = nearViewport || playing;

  useEffect(() => {
    if (active && audioRef.current && currentTimeRef.current) audioRef.current.currentTime = currentTimeRef.current;
  }, [active]);

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
    <div ref={containerRef} className={`telegram-audio${active ? "" : " is-deferred"}`}>
      {active ? (
        <>
          <audio
            ref={audioRef}
            src={src}
            preload="metadata"
            onLoadedMetadata={(event) => setKnownDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : duration ?? 0)}
            onTimeUpdate={(event) => {
              currentTimeRef.current = event.currentTarget.currentTime;
              setCurrentTime(event.currentTarget.currentTime);
            }}
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
                currentTimeRef.current = value;
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
        </>
      ) : (
        <div className="audio-deferred" aria-hidden="true"><span>Voice message</span><small>{formatDuration(duration)}</small></div>
      )}
    </div>
  );
}

function TelegramGif({ src, poster, label, mimeType, width, height }: { src: string; poster?: string; label: string; mimeType: string; width?: number; height?: number }) {
  const [frameRef, nearViewport] = useNearViewport<HTMLDivElement>();
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!nearViewport) return;
    const video = videoRef.current;
    if (!video) return;
    const ensurePlayback = () => {
      if (!document.hidden && video.paused) void video.play().catch(() => undefined);
    };
    ensurePlayback();
    video.addEventListener("canplay", ensurePlayback);
    video.addEventListener("pause", ensurePlayback);
    document.addEventListener("visibilitychange", ensurePlayback);
    return () => {
      video.removeEventListener("canplay", ensurePlayback);
      video.removeEventListener("pause", ensurePlayback);
      document.removeEventListener("visibilitychange", ensurePlayback);
      video.pause();
    };
  }, [src, nearViewport]);

  return (
    <div ref={frameRef} className="telegram-gif-frame" role="img" aria-label={label} style={{ aspectRatio: width && height ? `${width} / ${height}` : "16 / 9" }}>
      {nearViewport ? (
        <video ref={videoRef} className="telegram-gif-media" autoPlay loop muted playsInline preload="auto" poster={poster} aria-hidden="true">
          <source src={src} type={mimeType} />
        </video>
      ) : poster ? (
        <img className="telegram-media-poster" src={poster} alt="" loading="lazy" decoding="async" />
      ) : (
        <span className="telegram-media-deferred" aria-hidden="true">GIF</span>
      )}
    </div>
  );
}

function TelegramVideo({ src, poster, label, mimeType, width, height, round, onOpen }: {
  src: string;
  poster?: string;
  label: string;
  mimeType: string;
  width?: number;
  height?: number;
  round?: boolean;
  onOpen: () => void;
}) {
  const [frameRef, nearViewport] = useNearViewport<HTMLDivElement>();
  return (
    <div ref={frameRef} className={`telegram-video-frame${round ? " round-video-frame" : ""}`} style={{ aspectRatio: round ? "1" : width && height ? `${width} / ${height}` : "16 / 9" }}>
      {nearViewport ? (
        <video className={`media-video${round ? " round-video" : ""}`} controls controlsList="nofullscreen noremoteplayback" disablePictureInPicture playsInline preload="metadata" poster={poster} width={width} height={height}>
          <source src={src} type={mimeType} />
        </video>
      ) : poster ? (
        <img className={`telegram-media-poster${round ? " round-video" : ""}`} src={poster} alt="" loading="lazy" decoding="async" />
      ) : (
        <span className="telegram-media-deferred" aria-hidden="true">VIDEO</span>
      )}
      {nearViewport && (
        <button className="video-open-viewer" type="button" aria-label={`Open ${label} in media viewer`} onClick={(event) => {
          event.currentTarget.parentElement?.querySelector("video")?.pause();
          onOpen();
        }}>⛶</button>
      )}
    </div>
  );
}

function TelegramTgsSticker({ src, emoji }: { src: string; emoji?: string }) {
  const [visibilityRef, nearViewport] = useNearViewport<HTMLDivElement>();
  const containerRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!nearViewport) return;
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
  }, [src, nearViewport]);

  return (
    <div ref={visibilityRef} className={`tgs-sticker${failed ? " failed" : ""}`} aria-label="Animated Telegram sticker">
      <div ref={containerRef} />
      {(failed || !nearViewport) && <span>{emoji || "✦"}</span>}
    </div>
  );
}

function safeHref(href: string) {
  if (/^(https?:|mailto:|tel:)/i.test(href)) return href;
  return undefined;
}

function normalizedHttpUrl(value?: string) {
  if (!value) return undefined;
  const trimmed = value.trim().replace(/[.,!?;:]+$/, "");
  const candidate = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : /^(?:www\.|t\.me\/)/i.test(trimmed)
      ? `https://${trimmed}`
      : undefined;
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate);
    return ["http:", "https:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function messagePreviewUrl(message: TelegramMessage) {
  const source = message.text_entities ?? message.text ?? "";
  const parts: RichTextPart[] = typeof source === "string" ? [source] : Array.isArray(source) ? source : [];

  for (const part of parts) {
    if (typeof part === "string") {
      const match = part.match(/(?:https?:\/\/|www\.)[^\s<>"']+/i);
      const url = normalizedHttpUrl(match?.[0]);
      if (url) return url;
      continue;
    }
    if (!["link", "text_link"].includes(part.type ?? "")) continue;
    const url = normalizedHttpUrl(part.href ?? part.text);
    if (url) return url;
  }
  return undefined;
}

const linkPreviewCache = new Map<string, Promise<LinkPreviewData | null>>();

function fetchLinkPreview(url: string) {
  const cached = linkPreviewCache.get(url);
  if (cached) return cached;
  const request = fetch(`/api/link-preview?url=${encodeURIComponent(url)}`)
    .then(async (response) => response.ok ? await response.json() as LinkPreviewData : null)
    .catch(() => null);
  linkPreviewCache.set(url, request);
  return request;
}

function TelegramLinkPreview({ url }: { url: string }) {
  const cardRef = useRef<HTMLAnchorElement>(null);
  const [preview, setPreview] = useState<LinkPreviewData | null>();
  const [nearViewport, setNearViewport] = useState(false);
  const fallback = useMemo(() => {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    let path = parsed.pathname;
    try { path = decodeURIComponent(path); } catch { /* Keep the encoded path. */ }
    path = path.replace(/\/$/, "");
    return { host, label: path && path !== "/" ? `${host}${path}` : host };
  }, [url]);

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setNearViewport(true);
        observer.disconnect();
      },
      { root: card.closest(".message-list"), rootMargin: "350px 0px" },
    );
    observer.observe(card);
    return () => observer.disconnect();
  }, [url]);

  useEffect(() => {
    if (!nearViewport) return;
    let active = true;
    void fetchLinkPreview(url).then((nextPreview) => {
      if (active) setPreview(nextPreview);
    });
    return () => { active = false; };
  }, [nearViewport, url]);

  const title = preview?.title || fallback.label;
  const description = preview?.description;
  return (
    <a
      ref={cardRef}
      className={`link-preview-card${nearViewport && preview === undefined ? " is-loading" : ""}`}
      href={url}
      target="_blank"
      rel="noreferrer"
      aria-label={`Open link preview: ${title}`}
    >
      <span className="link-preview-accent" aria-hidden="true" />
      <span className="link-preview-copy">
        <small>{preview?.siteName || fallback.host}</small>
        <strong>{title}</strong>
        {description && <span>{description}</span>}
      </span>
      {preview?.image && (
        <img src={preview.image} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
      )}
    </a>
  );
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
  const [hasConversation, setHasConversation] = useState(true);
  const [isDemo, setIsDemo] = useState(true);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [senderFilter, setSenderFilter] = useState<SenderFilter>("all");
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>("all");
  const [monthFilter, setMonthFilter] = useState("all");
  const [visibleLimit, setVisibleLimit] = useState(DEFAULT_MESSAGE_LIMIT);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [sourceLabel, setSourceLabel] = useState("Sample archive");
  const [restoringArchive, setRestoringArchive] = useState(true);
  const [cacheStatus, setCacheStatus] = useState<ArchiveCacheStatus>("checking");
  const [mediaFileCount, setMediaFileCount] = useState(0);
  const [viewerMedia, setViewerMedia] = useState<MediaViewerItem | null>(null);
  const [mediaLibraryOpen, setMediaLibraryOpen] = useState(false);
  const [mediaLibraryFilter, setMediaLibraryFilter] = useState<LibraryMediaFilter>("all");
  const [mediaLibraryLimit, setMediaLibraryLimit] = useState(120);
  const [conversationNameOverride, setConversationNameOverride] = useState<{ key: string; value: string } | null>(null);
  const [renamingConversation, setRenamingConversation] = useState(false);
  const [conversationNameDraft, setConversationNameDraft] = useState("");
  const folderInputRef = useRef<HTMLInputElement>(null);
  const conversationNameInputRef = useRef<HTMLInputElement>(null);
  const mediaFilesRef = useRef(new Map<string, File>());
  const mediaUrlsRef = useRef(new Map<string, string>());
  const viewerUrlRef = useRef<string | null>(null);
  const viewerPosterUrlRef = useRef<string | null>(null);
  const messageListRef = useRef<HTMLDivElement>(null);

  const scrollMessagesToLatest = useCallback(() => {
    const pinToLatest = () => {
      const list = messageListRef.current;
      if (!list) return;
      const previousBehavior = list.style.scrollBehavior;
      list.style.scrollBehavior = "auto";
      list.scrollTop = list.scrollHeight;
      list.style.scrollBehavior = previousBehavior;
    };
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        pinToLatest();
      });
    });
    // Media can change the list height just after the filtered messages render.
    window.setTimeout(pinToLatest, 150);
    window.setTimeout(pinToLatest, 600);
    window.setTimeout(pinToLatest, 1200);
  }, []);

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
    let active = true;
    void (async () => {
      try {
        let chatWasRemoved = false;
        try {
          chatWasRemoved = window.localStorage.getItem(CHAT_REMOVED_STORAGE_KEY) === "true";
        } catch {
          // The deletion still applies for this session when browser storage is unavailable.
        }
        if (chatWasRemoved) {
          if (active) {
            setHasConversation(false);
            setCacheStatus("idle");
          }
          return;
        }
        const cached = await readCachedArchive();
        if (!cached || !active) {
          if (active) setCacheStatus(typeof indexedDB === "undefined" ? "unavailable" : "idle");
          return;
        }
        if (await loadFiles(cached.entries, cached.label)) {
          setHasConversation(true);
          setCacheStatus("saved");
        }
      } catch {
        if (active) setCacheStatus("unavailable");
      } finally {
        if (active) setRestoringArchive(false);
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!viewerMedia && !mediaLibraryOpen && !renamingConversation) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (viewerMedia) closeMediaViewer();
      else if (mediaLibraryOpen) setMediaLibraryOpen(false);
      else cancelConversationRename();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [viewerMedia, mediaLibraryOpen, renamingConversation, closeMediaViewer]);

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
  const defaultConversationName = meName === otherName ? otherName : `${meName} & ${otherName}`;
  const conversationNameStorageKey = `stillgram:chat-name:${String(chat.id ?? `${meName}|${otherName}`)}`;
  const customConversationName = conversationNameOverride?.key === conversationNameStorageKey ? conversationNameOverride.value : "";
  const conversationName = customConversationName || defaultConversationName;
  const conversationInitials = `${initials(meName).slice(0, 1)}${initials(otherName).slice(0, 1)}`;
  const peerIdDigits = String(chat.id ?? "").replace(/\D/g, "");
  const isMine = (message: TelegramMessage) => {
    const senderIdDigits = String(message.from_id ?? message.actor_id ?? "").replace(/\D/g, "");
    if (peerIdDigits && senderIdDigits) return senderIdDigits !== peerIdDigits;
    return (message.from ?? message.actor) === meName;
  };

  useEffect(() => {
    let storedName = "";
    try {
      storedName = window.localStorage.getItem(conversationNameStorageKey)?.trim() ?? "";
    } catch {
      // Renaming still works for this session when browser storage is unavailable.
    }
    setConversationNameOverride(storedName ? { key: conversationNameStorageKey, value: storedName } : null);
    setRenamingConversation(false);
  }, [conversationNameStorageKey]);

  useEffect(() => {
    if (!renamingConversation) return;
    const frame = window.requestAnimationFrame(() => {
      conversationNameInputRef.current?.focus();
      conversationNameInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [renamingConversation]);

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
  const messageLoadIncrement = mediaFilter === "all" ? 300 : MEDIA_MESSAGE_LIMIT;

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
  const sharedMedia = useMemo(
    () => chat.messages
      .filter((message) => {
        const kind = mediaKind(message);
        return message.media_type !== "sticker" && Boolean(message.photo ?? message.file) && (kind === "photos" || kind === "videos");
      })
      .slice()
      .reverse(),
    [chat.messages],
  );
  const libraryMedia = useMemo(
    () => mediaLibraryFilter === "all" ? sharedMedia : sharedMedia.filter((message) => mediaKind(message) === mediaLibraryFilter),
    [sharedMedia, mediaLibraryFilter],
  );
  const visibleLibraryMedia = libraryMedia.slice(0, mediaLibraryLimit);
  const needsMediaFolder = !isDemo && mediaFileCount === 0 && stats.photos + stats.videos + stats.voice + stats.files > 0;
  const cacheStatusLabel = cacheStatus === "saving"
    ? " · saving for refresh…"
    : cacheStatus === "saved"
      ? " · saved for refresh"
      : cacheStatus === "unavailable"
        ? " · available in this tab"
        : "";

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

  async function loadFiles(fileList: FileList | File[] | ArchiveFileEntry[], preferredLabel?: string): Promise<boolean> {
    setError("");
    const entries = Array.from(fileList).map((entry) => entry instanceof File
      ? { file: entry, relativePath: entry.webkitRelativePath || entry.name }
      : entry);
    const jsonEntry = entries.find(({ file }) => file.name.toLocaleLowerCase() === "result.json")
      ?? entries.find(({ file }) => file.name.endsWith(".json"));
    if (!jsonEntry) {
      setError("Choose the Telegram export folder or its result.json file.");
      setRestoringArchive(false);
      return false;
    }

    try {
      const jsonFile = jsonEntry.file;
      const data = JSON.parse(await jsonFile.text()) as RawExport;
      const nextChat = extractChat(data);
      closeMediaViewer();
      resetObjectUrls();
      const media = new Map<string, File>();
      entries.forEach(({ file, relativePath }) => {
        const relative = normalizePath(relativePath || file.name);
        media.set(relative, file);
        const withoutRoot = relative.includes("/") ? relative.slice(relative.indexOf("/") + 1) : relative;
        media.set(withoutRoot, file);
        if (!media.has(file.name)) media.set(file.name, file);
      });
      mediaFilesRef.current = media;
      setMediaFileCount(Math.max(0, entries.length - 1));
      setChat({ ...nextChat, messages: nextChat.messages.slice().sort((a, b) => safeDate(a).getTime() - safeDate(b).getTime()) });
      setHasConversation(true);
      setIsDemo(false);
      setSourceLabel(preferredLabel || jsonEntry.relativePath.split("/")[0] || jsonFile.name);
      setQuery("");
      setSenderFilter("all");
      setMediaFilter("all");
      setMediaLibraryOpen(false);
      setMediaLibraryFilter("all");
      setMediaLibraryLimit(120);
      setMonthFilter("all");
      setVisibleLimit(DEFAULT_MESSAGE_LIMIT);
      try {
        window.localStorage.removeItem(CHAT_REMOVED_STORAGE_KEY);
      } catch {
        // Opening the archive still works when browser storage is unavailable.
      }
      scrollMessagesToLatest();
      return true;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "This file could not be read as a Telegram export.");
      return false;
    } finally {
      setRestoringArchive(false);
    }
  }

  function chooseFolder() {
    setError("");
    folderInputRef.current?.click();
  }

  function onFolderChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files?.length) {
      const entries = archiveEntries(event.target.files);
      const label = archiveLabel(entries);
      setCacheStatus("saving");
      void (async () => {
        if (!await loadFiles(entries, label)) {
          setCacheStatus("idle");
          return;
        }
        setCacheStatus(await cacheArchive(entries, label) ? "saved" : "unavailable");
      })();
    }
    event.target.value = "";
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length) {
      const entries = archiveEntries(event.dataTransfer.files);
      const label = archiveLabel(entries);
      setCacheStatus("saving");
      void (async () => {
        if (!await loadFiles(entries, label)) {
          setCacheStatus("idle");
          return;
        }
        setCacheStatus(await cacheArchive(entries, label) ? "saved" : "unavailable");
      })();
    }
  }

  function startConversationRename() {
    setConversationNameDraft(conversationName);
    setRenamingConversation(true);
  }

  function toggleSidebar() {
    setSidebarOpen((open) => !open);
  }

  function closeSidebarManually() {
    setSidebarOpen(false);
  }

  async function removeCurrentChat() {
    closeMediaViewer();
    resetObjectUrls();
    mediaFilesRef.current.clear();
    viewerPosterUrlRef.current = null;
    setHasConversation(false);
    setChat(demoChat);
    setIsDemo(true);
    setSourceLabel("Sample archive");
    setRestoringArchive(false);
    setCacheStatus("idle");
    setMediaFileCount(0);
    setMediaLibraryOpen(false);
    setRenamingConversation(false);
    setConversationNameOverride(null);
    setQuery("");
    setSenderFilter("all");
    setMediaFilter("all");
    setMonthFilter("all");
    setVisibleLimit(DEFAULT_MESSAGE_LIMIT);
    setError("");
    try {
      window.localStorage.setItem(CHAT_REMOVED_STORAGE_KEY, "true");
      window.localStorage.removeItem(conversationNameStorageKey);
    } catch {
      // The chat remains removed for this session when browser storage is unavailable.
    }
    await clearCachedArchive();
  }

  function cancelConversationRename() {
    setConversationNameDraft(conversationName);
    setRenamingConversation(false);
  }

  function saveConversationName() {
    const nextName = conversationNameDraft.trim().replace(/\s+/g, " ");
    if (!nextName) return;
    setConversationNameOverride({ key: conversationNameStorageKey, value: nextName });
    try {
      window.localStorage.setItem(conversationNameStorageKey, nextName);
    } catch {
      // Keep the session-only rename when browser storage is unavailable.
    }
    setRenamingConversation(false);
  }

  function clearFilters() {
    setQuery("");
    setSenderFilter("all");
    setMediaFilter("all");
    setMonthFilter("all");
    setVisibleLimit(DEFAULT_MESSAGE_LIMIT);
    scrollMessagesToLatest();
  }

  function selectSenderFilter(filter: SenderFilter) {
    setVisibleLimit(mediaFilter === "all" ? DEFAULT_MESSAGE_LIMIT : MEDIA_MESSAGE_LIMIT);
    setSenderFilter(filter);
    scrollMessagesToLatest();
  }

  function selectMediaFilter(filter: MediaFilter) {
    setVisibleLimit(filter === "all" ? DEFAULT_MESSAGE_LIMIT : MEDIA_MESSAGE_LIMIT);
    setMediaFilter(filter);
    scrollMessagesToLatest();
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
            <img src={url} alt={message.sticker_emoji ? `Sticker ${message.sticker_emoji}` : "Telegram sticker"} loading="lazy" decoding="async" />
          </a>
        );
      }
    }

    if (kind === "photos" && url) {
      const alt = messageText(message) || label;
      return wrapSpoiler(
        <button className="media-photo" type="button" onClick={() => openMediaViewer(path, label, alt, "photo")} aria-label={`View ${label}`}>
          {/* Browser-created object URLs never leave this device. */}
          <img src={url} alt={alt} loading="lazy" decoding="async" />
        </button>,
      );
    }
    if (kind === "videos" && url) {
      const poster = resolveMedia(message.thumbnail);
      if (message.media_type === "animation") {
        return wrapSpoiler(
          <TelegramGif
            src={url}
            poster={poster}
            label={messageText(message) || `Animated image ${label}`}
            mimeType={message.mime_type || "video/mp4"}
            width={message.width}
            height={message.height}
          />,
        );
      }
      const round = message.media_type === "video_message";
      return wrapSpoiler(
        <TelegramVideo
          src={url}
          poster={poster}
          label={label}
          mimeType={message.mime_type || "video/mp4"}
          width={message.width}
          height={message.height}
          round={round}
          onOpen={() => openMediaViewer(path, label, messageText(message) || label, "video", message.mime_type || "video/mp4", message.thumbnail)}
        />,
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
      <button className="file-card is-missing" type="button" onClick={() => void chooseFolder()}>{cardContent}</button>
    );
  }

  function openLibraryMedia(message: TelegramMessage) {
    const path = message.photo ?? message.file;
    if (!path || !mediaFile(path)) {
      void chooseFolder();
      return;
    }
    const kind = mediaKind(message);
    const label = message.file_name ?? path.split(/[\\/]/).at(-1) ?? (kind === "photos" ? "Photo" : "Video");
    openMediaViewer(
      path,
      label,
      messageText(message) || label,
      kind === "photos" ? "photo" : "video",
      message.mime_type,
      message.thumbnail,
    );
  }

  function renderLibraryMedia(message: TelegramMessage) {
    const path = message.photo ?? message.file;
    if (!path) return null;
    const kind = mediaKind(message);
    const isVideo = kind === "videos";
    const previewUrl = resolveMedia(isVideo ? message.thumbnail : path);
    const label = message.file_name ?? path.split(/[\\/]/).at(-1) ?? (isVideo ? "Video" : "Photo");
    const available = Boolean(mediaFile(path));
    return (
      <button
        className={`media-library-item${isVideo ? " is-video" : ""}${available ? "" : " is-missing"}`}
        type="button"
        key={String(message.id)}
        onClick={() => openLibraryMedia(message)}
        aria-label={available ? `View ${label}` : `Connect media folder to view ${label}`}
      >
        {previewUrl ? <img src={previewUrl} alt="" loading="lazy" decoding="async" /> : <span className="media-library-placeholder" aria-hidden="true">{isVideo ? "VID" : "IMG"}</span>}
        {isVideo && <span className="media-library-play" aria-hidden="true">▶</span>}
        {isVideo && message.duration_seconds ? <span className="media-library-duration">{formatDuration(message.duration_seconds)}</span> : null}
        <span className="media-library-date">{mediaDateFormatter.format(safeDate(message))}</span>
      </button>
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

      <section className={`workspace${sidebarOpen ? "" : " sidebar-closed"}`}>
        <aside className="sidebar" id="archive-sidebar" aria-label="Archive panel" aria-hidden={sidebarOpen ? undefined : true}>
          <div className="sidebar-toolbar">
            <button className="theme-toggle" type="button" onClick={() => setTheme(theme === "light" ? "dark" : "light")} aria-label={`Use ${theme === "light" ? "dark" : "light"} theme`}>
              {theme === "light" ? "☾" : "☀"}
            </button>
            <div className="telegram-brand"><strong>Stillgram</strong><small>local archive</small></div>
            <button className="telegram-compose" type="button" onClick={() => void chooseFolder()} aria-label="Open a Telegram export folder">
              ＋
              <span className="control-tooltip" role="tooltip">Open a Telegram export folder</span>
            </button>
          </div>

          <div className="chat-list-label">Chats</div>
          {hasConversation ? (
            <>
              <div className="chat-list-row selected">
                <button className="chat-list-open" type="button" onClick={clearFilters} aria-label={`Open ${conversationName} chat`}>
                  <div className="avatar large">{conversationInitials}</div>
                  <div className="chat-list-copy"><strong>{conversationName}</strong></div>
                </button>
                <button className="chat-list-rename" type="button" onClick={startConversationRename} aria-label="Rename chat from chat list" title="Rename chat">✎</button>
                <button className="chat-list-delete" type="button" onClick={() => void removeCurrentChat()} aria-label="Delete current chat" title="Remove chat from Stillgram">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-2 6h10l-1 11H8L7 9Zm3 2v7h2v-7h-2Zm4 0v7h2v-7h-2Z" />
                  </svg>
                </button>
              </div>

              <div className="archive-source">
                <span className="source-icon">✓</span>
                <div>
                  <strong>{sourceLabel}</strong>
                  <small>{isDemo ? "Sample conversation" : "On-device only · loaded locally"}</small>
                </div>
              </div>

              <nav className="filter-section" aria-label="Message filters">
                <span className="section-label">Message filters</span>
                <button className={senderFilter === "all" ? "active" : ""} onClick={() => selectSenderFilter("all")} type="button"><span>☷</span> All messages <b>{chat.messages.length.toLocaleString()}</b></button>
                <button className={senderFilter === "me" ? "active" : ""} onClick={() => selectSenderFilter("me")} type="button"><span>↗</span> Sent by you</button>
                <button className={senderFilter === "them" ? "active" : ""} onClick={() => selectSenderFilter("them")} type="button"><span>↙</span> Sent by {otherName.split(" ")[0]}</button>
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
                  <button key={value} className={mediaFilter === value ? "active" : ""} onClick={() => selectMediaFilter(mediaFilter === value ? "all" : value)} type="button">
                    <span>{icon}</span> {label} <b>{count}</b>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="chat-list-empty"><strong>No chats</strong><small>Use + to open an export folder.</small></div>
          )}

          <div className="sidebar-foot">
            <span className="privacy-dot">●</span>
            <p><strong>Private archive</strong>Your files stay on this device.</p>
          </div>
        </aside>

        {sidebarOpen && <button className="sidebar-backdrop" type="button" onClick={closeSidebarManually} aria-label="Close archive panel" />}

        <section className="conversation-panel">
          <div className={`conversation-toolbar${hasConversation ? "" : " is-empty"}`}>
            <div className="chat-header-title">
              <button
                className="sidebar-toggle"
                type="button"
                onClick={toggleSidebar}
                aria-label={sidebarOpen ? "Hide archive panel" : "Show archive panel"}
                aria-controls="archive-sidebar"
                aria-expanded={sidebarOpen}
              >
                ☰
              </button>
              {hasConversation && (
                <>
                  <div className="header-avatar-edit">
                    <div className="avatar">{conversationInitials}</div>
                    <button className="header-avatar-rename" type="button" onClick={startConversationRename} aria-label="Rename chat from header avatar" title="Rename chat">✎</button>
                  </div>
                  <span>
                    <strong>{conversationName}</strong>
                    <span className="chat-title-meta">
                      <small>{chat.messages.length.toLocaleString()} archived messages</small>
                    </span>
                  </span>
                </>
              )}
            </div>
            {hasConversation && (
              <>
                <button
                  className="view-media-button"
                  type="button"
                  onClick={() => {
                    setMediaLibraryOpen(true);
                    setMediaLibraryLimit(120);
                  }}
                >
                  <span aria-hidden="true">▦</span> View Media
                </button>
                <label className="search-box">
                  <span aria-hidden="true">⌕</span>
                  <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={searchKeyboard} placeholder="Search this conversation" aria-label="Search this conversation" />
                  {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search">×</button>}
                </label>
                <select value={monthFilter} onChange={(event) => setMonthFilter(event.target.value)} aria-label="Filter by month">
                  <option value="all">Any date</option>
                  {months.map(([key, date]) => <option key={key} value={key}>{monthFormatter.format(date)}</option>)}
                </select>
              </>
            )}
          </div>

          {hasConversation && (
            <div className="archive-switcher" aria-label="Archive source">
              <span><small>Archive source{cacheStatusLabel}</small><strong>{sourceLabel}</strong></span>
            </div>
          )}

          {hasConversation && isDemo && (
            <div className="welcome-strip">
              <span className="welcome-lock">◇</span>
              <div>
                <strong>{restoringArchive ? "Restoring your saved archive…" : "This is a sample conversation"}</strong>
                <p>{restoringArchive ? "Checking this browser for locally saved archive files." : "Open your Telegram export folder to replace it. Nothing is uploaded."}</p>
              </div>
            </div>
          )}

          {needsMediaFolder && (
            <div className="media-connect-banner" role="status">
              <span>▧</span>
              <div><strong>Media folder isn’t connected</strong><p>Choose the complete ChatExport folder to display photos, GIFs, stickers, voice notes, and videos.</p></div>
              <button type="button" onClick={() => void chooseFolder()}>Connect media</button>
            </div>
          )}

          {error && <div className="error-banner" role="alert"><strong>Couldn’t open that export.</strong><span>{error}</span><button type="button" onClick={() => setError("")}>×</button></div>}

          {hasConversation && <div className="mobile-filter-bar" aria-label="Mobile message filters">
            <button className={senderFilter === "all" ? "active" : ""} type="button" onClick={() => selectSenderFilter("all")}>All</button>
            <button className={senderFilter === "me" ? "active" : ""} type="button" onClick={() => selectSenderFilter("me")}>You</button>
            <button className={senderFilter === "them" ? "active" : ""} type="button" onClick={() => selectSenderFilter("them")}>{otherName.split(" ")[0]}</button>
            <select value={mediaFilter} onChange={(event) => selectMediaFilter(event.target.value as MediaFilter)} aria-label="Filter media">
              <option value="all">All types</option>
              <option value="photos">Photos</option>
              <option value="videos">Videos</option>
              <option value="voice">Audio</option>
              <option value="files">Files</option>
              <option value="links">Links</option>
            </select>
          </div>}

          {hasConversation ? <div className="message-list" ref={messageListRef}>
            {hiddenCount > 0 && (
              <button className="load-older" type="button" onClick={() => setVisibleLimit((limit) => limit + messageLoadIncrement)}>
                Show {Math.min(messageLoadIncrement, hiddenCount).toLocaleString()} earlier messages
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
                const previewUrl = !message.photo && !message.file ? messagePreviewUrl(message) : undefined;
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
                            {previewUrl && <TelegramLinkPreview url={previewUrl} />}
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
          </div> : (
            <div className="no-chat-state">
              <div>
                <span aria-hidden="true">＋</span>
                <h2>No chat selected</h2>
                <p>Open a Telegram export folder to add a conversation.</p>
                <button type="button" onClick={() => void chooseFolder()}>Open export folder</button>
              </div>
            </div>
          )}
        </section>
      </section>

      {renamingConversation && (
        <div
          className="rename-chat-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rename-chat-title"
        >
          <button className="rename-chat-backdrop" type="button" onClick={cancelConversationRename} aria-label="Dismiss rename dialog" tabIndex={-1} />
          <form className="rename-chat-modal" onSubmit={(event) => {
            event.preventDefault();
            saveConversationName();
          }}>
            <header>
              <div className="rename-chat-avatar" aria-hidden="true">{conversationInitials}</div>
              <div><strong id="rename-chat-title">Rename chat</strong><small>Change how this conversation appears in Stillgram</small></div>
              <button type="button" onClick={cancelConversationRename} aria-label="Close rename dialog">×</button>
            </header>
            <label>
              <span>Chat name</span>
              <input
                ref={conversationNameInputRef}
                value={conversationNameDraft}
                onChange={(event) => setConversationNameDraft(event.target.value)}
                maxLength={80}
                aria-label="Chat name"
              />
            </label>
            <p>Participant names and sender filters stay unchanged.</p>
            <footer>
              <button type="button" className="rename-chat-cancel" onClick={cancelConversationRename} aria-label="Cancel renaming chat">Cancel</button>
              <button type="submit" className="rename-chat-save" aria-label="Save chat name" disabled={!conversationNameDraft.trim()}>Save</button>
            </footer>
          </form>
        </div>
      )}

      {mediaLibraryOpen && (
        <div
          className="media-library-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Shared media"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setMediaLibraryOpen(false);
          }}
        >
          <section className="media-library-panel">
            <header className="media-library-header">
              <button type="button" onClick={() => setMediaLibraryOpen(false)} aria-label="Close shared media" autoFocus>←</button>
              <div><strong>Shared media</strong><small>{sharedMedia.length.toLocaleString()} photos and videos</small></div>
            </header>
            <nav className="media-library-tabs" aria-label="Filter shared media">
              {(["all", "photos", "videos"] as const).map((filter) => {
                const count = filter === "all" ? sharedMedia.length : sharedMedia.filter((message) => mediaKind(message) === filter).length;
                return (
                  <button
                    className={mediaLibraryFilter === filter ? "active" : ""}
                    type="button"
                    key={filter}
                    onClick={() => {
                      setMediaLibraryFilter(filter);
                      setMediaLibraryLimit(120);
                    }}
                  >
                    {filter === "all" ? "Media" : filter === "photos" ? "Photos" : "Videos"}<span>{count.toLocaleString()}</span>
                  </button>
                );
              })}
            </nav>
            <div className="media-library-grid">
              {visibleLibraryMedia.map(renderLibraryMedia)}
              {visibleLibraryMedia.length === 0 && (
                <div className="media-library-empty">
                  <span>▦</span>
                  <strong>No media connected</strong>
                  <p>Choose the complete Telegram export folder to browse its photos and videos.</p>
                  <button type="button" onClick={() => void chooseFolder()}>Choose folder</button>
                </div>
              )}
              {visibleLibraryMedia.length < libraryMedia.length && (
                <button className="media-library-more" type="button" onClick={() => setMediaLibraryLimit((limit) => limit + 120)}>
                  Show older media
                </button>
              )}
            </div>
          </section>
        </div>
      )}

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
