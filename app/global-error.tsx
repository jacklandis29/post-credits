"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body><main className="route-error"><p>Post Credits hit a snag.</p><h1>Please reload and try again.</h1><button onClick={reset}>Try again</button></main></body>
    </html>
  );
}
