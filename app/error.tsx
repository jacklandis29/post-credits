"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="route-error">
      <p>Post Credits hit a snag.</p>
      <h1>Your diary is still safe.</h1>
      <button className="primary-action" onClick={reset}>Try again</button>
    </main>
  );
}
