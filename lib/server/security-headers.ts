export function createContentSecurityPolicy(
  nonce: string,
  supabaseUrl?: string,
): string {
  const sidebarBootstrapHash = "'sha256-8xbxR5xPidwDUIF/fTivUM6LpuRS92e4LDbeI0ihGOk='";
  const connectSources = ["'self'", "https://challenges.cloudflare.com"];
  if (supabaseUrl) {
    try {
      const url = new URL(supabaseUrl);
      if (url.protocol === "https:") {
        connectSources.push(url.origin, `wss://${url.host}`);
      }
    } catch {
      // Production env validation reports malformed URLs. Keep browser egress
      // fail-closed here rather than broadening the policy.
    }
  }

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "object-src 'none'",
    "img-src 'self' data: https://image.tmdb.org",
    "media-src 'self' https://www.youtube.com https://www.youtube-nocookie.com",
    `script-src 'self' 'nonce-${nonce}' ${sidebarBootstrapHash} 'strict-dynamic' https://challenges.cloudflare.com`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "frame-src https://challenges.cloudflare.com https://www.youtube.com https://www.youtube-nocookie.com",
    `connect-src ${connectSources.join(" ")}`,
    "upgrade-insecure-requests",
  ].join("; ");
}

export function applySecurityHeaders(
  response: Response,
  requestUrl: string,
  contentSecurityPolicy: string,
): Response {
  const headers = new Headers(response.headers);
  headers.set("content-security-policy", contentSecurityPolicy);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  headers.set("x-frame-options", "DENY");
  if (requestUrl.startsWith("https://")) {
    headers.set(
      "strict-transport-security",
      "max-age=31536000; includeSubDomains; preload",
    );
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
