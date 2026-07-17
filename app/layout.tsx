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
  const configuredSiteUrl = process.env.SITE_URL?.trim();
  let metadataBase: URL;
  if (configuredSiteUrl) {
    metadataBase = new URL(configuredSiteUrl);
  } else if (process.env.NODE_ENV === "production") {
    // A fixed safe fallback prevents forwarded Host headers from controlling
    // canonical and social metadata if deployment configuration is lost.
    metadataBase = new URL("https://postcredits.club");
  } else {
    const requestHeaders = await headers();
    const host = requestHeaders.get("host") ?? "localhost:3000";
    metadataBase = new URL(`http://${host}`);
  }
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
      images: [{ url: "/og.png", width: 1200, height: 630, alt: "Post Credits film diary" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Post Credits",
      description: "Film diary with comparison-based ranking.",
      images: ["/og.png"],
    },
    manifest: "/manifest.webmanifest",
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`dark ${geistSans.variable} ${fraunces.variable}`} suppressHydrationWarning>
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
