import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const resizeObserverGuard = `
  (() => {
    const ignoredMessages = new Set([
      "ResizeObserver loop completed with undelivered notifications.",
      "ResizeObserver loop limit exceeded",
    ]);
    window.addEventListener("error", (event) => {
      if (!ignoredMessages.has(event.message)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
  })();
`;

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;

  return {
    title: "Telegram History Viewer — Private archive viewer",
    description:
      "Browse and search Telegram chat exports locally. Your messages and media never leave your device.",
    openGraph: {
      title: "Telegram History Viewer",
      description: "Your Telegram archive, quietly kept.",
      type: "website",
      images: [{ url: `${origin}/og.png`, width: 1734, height: 907, alt: "Telegram History Viewer private archive interface" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Telegram History Viewer",
      description: "Your Telegram archive, quietly kept.",
      images: [`${origin}/og.png`],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: resizeObserverGuard }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
