import type { Metadata } from "next";
import { Fraunces, Geist } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["opsz"],
  style: ["normal", "italic"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https");
  const metadataBase = new URL(`${protocol}://${host}`);
  return {
    metadataBase,
    title: {
      default: "Post Credits",
      template: "%s · Post Credits",
    },
    description:
      "Log films, write notes, and maintain a comparison-based personal ranking.",
    applicationName: "Post Credits",
    category: "entertainment",
    keywords: ["film diary", "movie ranking", "personal canon", "cinema"],
    openGraph: {
      title: "Post Credits",
      description: "Film diary with comparison-based ranking.",
      type: "website",
      siteName: "Post Credits",
    },
    twitter: {
      card: "summary_large_image",
      title: "Post Credits",
      description: "Film diary with comparison-based ranking.",
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`dark ${geistSans.variable} ${fraunces.variable}`}>
      <head>
        <link rel="preconnect" href="https://image.tmdb.org" />
        <link rel="dns-prefetch" href="https://image.tmdb.org" />
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem("after-credits-sidebar-collapsed")==="true")document.documentElement.classList.add("sidebar-collapsed-initial")}catch{}`,
          }}
        />
      </head>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
