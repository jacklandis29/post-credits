import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function importTypeScript(path) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString("base64")}`
  );
}

const securityHeaders = await importTypeScript("../lib/server/security-headers.ts");
const limiter = await importTypeScript("../lib/tmdb/limit.ts");
const requestReader = await importTypeScript("../lib/server/request.ts");

test("CSP uses a nonce and pins browser egress to one Supabase project", () => {
  const policy = securityHeaders.createContentSecurityPolicy(
    "test-nonce",
    "https://project-ref.supabase.co",
  );
  assert.match(policy, /script-src[^;]*'nonce-test-nonce'/);
  assert.match(policy, /script-src[^;]*'sha256-8xbxR5xPidwDUIF\/fTivUM6LpuRS92e4LDbeI0ihGOk='/);
  assert.doesNotMatch(policy, /script-src[^;]*'unsafe-inline'/);
  assert.match(policy, /https:\/\/project-ref\.supabase\.co/);
  assert.match(policy, /wss:\/\/project-ref\.supabase\.co/);
  assert.doesNotMatch(policy, /\*\.supabase\.co/);
  assert.doesNotMatch(policy, /api\.themoviedb\.org/);
});

test("HTTPS responses receive preload-ready HSTS and the CSP", () => {
  const response = securityHeaders.applySecurityHeaders(
    new Response("ok"),
    "https://postcredits.club/",
    "default-src 'self'",
  );
  assert.equal(response.headers.get("content-security-policy"), "default-src 'self'");
  assert.match(response.headers.get("strict-transport-security"), /preload/);
  assert.equal(response.headers.get("x-frame-options"), "DENY");
});

test("request identity trusts Cloudflare and ignores spoofable forwarding headers", () => {
  const spoofed = new Request("https://postcredits.club", {
    headers: { "x-forwarded-for": "203.0.113.10" },
  });
  assert.equal(limiter.tmdbRequestIdentity(spoofed), "unknown");

  const cloudflare = new Request("https://postcredits.club", {
    headers: { "cf-connecting-ip": "2001:db8::1" },
  });
  assert.equal(limiter.tmdbRequestIdentity(cloudflare), "2001:db8::1");
});

test("in-process budgets fail closed after their configured limit", () => {
  const key = `test:${crypto.randomUUID()}`;
  assert.equal(limiter.consumeTmdbBudget(key, { limit: 1 }), true);
  assert.equal(limiter.consumeTmdbBudget(key, { limit: 1 }), false);
});

test("bounded JSON parsing rejects oversized and non-object bodies", async () => {
  const oversized = new Request("https://postcredits.club/api/test", {
    method: "POST",
    body: JSON.stringify({ value: "x".repeat(128) }),
  });
  assert.equal(await requestReader.readBoundedJsonObject(oversized, 32), null);

  const arrayBody = new Request("https://postcredits.club/api/test", {
    method: "POST",
    body: "[]",
  });
  assert.equal(await requestReader.readBoundedJsonObject(arrayBody, 32), null);

  const valid = new Request("https://postcredits.club/api/test", {
    method: "POST",
    body: '{"value":"ok"}',
  });
  assert.deepEqual(await requestReader.readBoundedJsonObject(valid, 32), { value: "ok" });
});

test("personal-expression tables and avatar uploads stay owner-scoped", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/20260717160743_add_social_diary_details.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /alter table public\.film_likes enable row level security/);
  assert.match(migration, /alter table public\.profile_favorites enable row level security/);
  assert.match(migration, /user_id = \(select auth\.uid\(\)\)/);
  assert.match(migration, /avatars_insert_own_folder/);
  assert.match(migration, /avatars_select_own_folder/);
  assert.match(migration, /avatars_delete_own_folder/);
  assert.match(migration, /file_size_limit[\s\S]*5242880/);
  assert.doesNotMatch(migration, /service_role/);
});
