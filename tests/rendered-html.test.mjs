import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
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
  assert.match(html, /Loading/);
  const appSource = await readFile(
    new URL("../app/AfterCreditsApp.tsx", import.meta.url),
    "utf8",
  );
  const logFlowSource = await readFile(
    new URL("../app/components/LogFlow.tsx", import.meta.url),
    "utf8",
  );
  assert.match(appSource, /Diary/);
  assert.match(appSource, /Log a film/);
  assert.match(logFlowSource, /Did not finish/);
  assert.match(logFlowSource, /dnf-action" disabled=\{!isValidLocalDate/);
  assert.doesNotMatch(html, /Your latest watch|There is no feed waiting underneath|class="eyebrow"/i);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("removes starter-only preview infrastructure and metadata", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
  assert.match(page, /AfterCreditsApp/);
  assert.match(layout, /default: "Post Credits"/);
  assert.doesNotMatch(layout, /Starter Project|codex-preview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
