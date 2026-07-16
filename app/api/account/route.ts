type JsonObject = Record<string, unknown>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

async function safeJson(response: Response): Promise<JsonObject | null> {
  try {
    return object(await response.json());
  } catch {
    return null;
  }
}

export async function DELETE(request: Request) {
  let requestUrl: URL;
  try {
    requestUrl = new URL(request.url);
  } catch {
    return json({ error: "Invalid request" }, 400);
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== requestUrl.origin) {
    return json({ error: "Invalid request origin" }, 403);
  }

  const authorization = request.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(\S+)$/.exec(authorization);
  if (!bearer || bearer[1].length > 8_192) {
    return json({ error: "Authentication required" }, 401);
  }
  const forwardedAuthorization = `Bearer ${bearer[1]}`;

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 512) {
    return json({ error: "Invalid request" }, 400);
  }

  let body: JsonObject | null = null;
  try {
    body = object(await request.json());
  } catch {
    return json({ error: "Invalid request" }, 400);
  }
  const username = typeof body?.username === "string"
    ? body.username.trim().toLowerCase()
    : "";
  if (
    !body ||
    Object.keys(body).length !== 1 ||
    !/^[a-z0-9][a-z0-9_]{1,28}[a-z0-9]$/.test(username)
  ) {
    return json({ error: "Enter your username to confirm deletion" }, 400);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serverKey =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !publishableKey || !serverKey) {
    return json({ error: "Account deletion is not configured" }, 503);
  }

  let userUrl: URL;
  let profileUrl: URL;
  let logoutUrl: URL;
  let adminUserUrl: URL;
  try {
    userUrl = new URL("/auth/v1/user", supabaseUrl);
    profileUrl = new URL("/rest/v1/profiles", supabaseUrl);
    profileUrl.searchParams.set("select", "username");
    profileUrl.searchParams.set("limit", "1");
    logoutUrl = new URL("/auth/v1/logout", supabaseUrl);
    logoutUrl.searchParams.set("scope", "global");
    adminUserUrl = new URL("/auth/v1/admin/users/placeholder", supabaseUrl);
  } catch {
    return json({ error: "Account deletion is not configured" }, 503);
  }

  try {
    const userResponse = await fetch(userUrl, {
      headers: {
        apikey: publishableKey,
        authorization: forwardedAuthorization,
      },
      signal: AbortSignal.timeout(7_000),
    });
    if (userResponse.status === 401 || userResponse.status === 403) {
      return json({ error: "Authentication required" }, 401);
    }
    if (!userResponse.ok) {
      return json({ error: "Authentication is temporarily unavailable" }, 502);
    }
    const authenticatedUser = await safeJson(userResponse);
    const userId = typeof authenticatedUser?.id === "string"
      ? authenticatedUser.id
      : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
      return json({ error: "Authentication required" }, 401);
    }

    const profileResponse = await fetch(profileUrl, {
      headers: {
        accept: "application/json",
        apikey: publishableKey,
        authorization: forwardedAuthorization,
      },
      signal: AbortSignal.timeout(7_000),
    });
    if (!profileResponse.ok) {
      return json({ error: "Could not verify account ownership" }, 502);
    }
    const profiles = await profileResponse.json();
    const storedUsername = Array.isArray(profiles) && profiles.length === 1
      ? object(profiles[0])?.username
      : null;
    if (typeof storedUsername !== "string" || storedUsername.toLowerCase() !== username) {
      return json({ error: "Username does not match this account" }, 400);
    }

    const logoutResponse = await fetch(logoutUrl, {
      method: "POST",
      headers: {
        apikey: publishableKey,
        authorization: forwardedAuthorization,
      },
      signal: AbortSignal.timeout(7_000),
    });
    if (!logoutResponse.ok) {
      return json({ error: "Could not revoke active sessions" }, 502);
    }

    adminUserUrl.pathname = `/auth/v1/admin/users/${userId}`;
    const deleteResponse = await fetch(adminUserUrl, {
      method: "DELETE",
      headers: {
        apikey: serverKey,
        ...(serverKey.startsWith("sb_secret_")
          ? {}
          : { authorization: `Bearer ${serverKey}` }),
      },
      signal: AbortSignal.timeout(7_000),
    });
    if (!deleteResponse.ok) {
      return json({ error: "Could not delete the account" }, 502);
    }

    return json({ deleted: true });
  } catch {
    return json({ error: "Account deletion is temporarily unavailable" }, 502);
  }
}
