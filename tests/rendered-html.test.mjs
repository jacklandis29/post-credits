import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the finished Post Credits product", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);

  const html = await response.text();
  assert.match(html, /<title>Post Credits<\/title>/i);
  assert.match(html, /Post Credits/);
  assert.match(html, /Loading|class="app-shell"/);
  const appSource = await readFile(
    new URL("../app/AfterCreditsApp.tsx", import.meta.url),
    "utf8",
  );
  const logFlowSource = await readFile(
    new URL("../app/components/LogFlow.tsx", import.meta.url),
    "utf8",
  );
  assert.match(appSource, /Diary/);
  assert.match(appSource, /onLog=\{openLogger\}/);
  assert.match(appSource, /\["home", "diary", "canon", "stats", "watchlist", "profile"\]/);
  assert.match(appSource, /InsightsView/);
  assert.doesNotMatch(appSource, /className="mobile-log"/);
  assert.match(logFlowSource, /Did not finish/);
  assert.match(logFlowSource, /dnf-action" disabled=\{!isValidLocalDate/);
  assert.doesNotMatch(html, /Your latest watch|There is no feed waiting underneath|class="eyebrow"/i);
});

test("production auth is visibly protected and returns to the canonical site", async () => {
  const [gate, turnstile, confirmation, magicLink] = await Promise.all([
    readFile(new URL("../app/SupabaseGate.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/Turnstile.tsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/templates/confirmation.html", import.meta.url), "utf8"),
    readFile(new URL("../supabase/templates/magic_link.html", import.meta.url), "utf8"),
  ]);

  assert.match(gate, /productionAuthRedirectUrl = "https:\/\/postcredits\.club\/"/);
  assert.match(turnstile, /appearance: "always"/);
  assert.doesNotMatch(turnstile, /interaction-only/);
  assert.match(confirmation, /\{\{ \.ConfirmationURL \}\}/);
  assert.match(magicLink, /\{\{ \.ConfirmationURL \}\}/);
});
