/** Cloudflare Worker entry point for Post Credits. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { applySecurityHeaders, createContentSecurityPolicy } from "../lib/server/security-headers";

interface AssetFetcher {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  ASSETS: AssetFetcher;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const randomBytes = new Uint8Array(18);
    crypto.getRandomValues(randomBytes);
    const nonce = btoa(String.fromCharCode(...randomBytes));
    const contentSecurityPolicy = createContentSecurityPolicy(
      nonce,
      process.env.NEXT_PUBLIC_SUPABASE_URL,
    );

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      const response = await handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
      return applySecurityHeaders(response, request.url, contentSecurityPolicy);
    }

    // Vinext reads a nonce from the request CSP and applies it to its dynamic
    // hydration scripts. The same policy is then returned to the browser.
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("content-security-policy", contentSecurityPolicy);
    const securedRequest = new Request(request, { headers: requestHeaders });
    const response = await handler.fetch(securedRequest, env, ctx);
    return applySecurityHeaders(response, request.url, contentSecurityPolicy);
  },
};

export default worker;
