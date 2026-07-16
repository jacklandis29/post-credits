import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "";

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);

export type SupabaseAuthCapabilities = {
  email: boolean;
  google: boolean;
};

let authCapabilitiesPromise: Promise<SupabaseAuthCapabilities> | null = null;

export function loadSupabaseAuthCapabilities(): Promise<SupabaseAuthCapabilities> {
  if (!isSupabaseConfigured) return Promise.resolve({ email: false, google: false });
  if (authCapabilitiesPromise) return authCapabilitiesPromise;

  authCapabilitiesPromise = fetch(new URL("/auth/v1/settings", supabaseUrl), {
    headers: { apikey: supabaseKey },
    cache: "no-store",
  })
    .then(async (response) => {
      if (!response.ok) throw new Error("Could not load auth settings");
      const payload = await response.json() as {
        external?: Record<string, unknown>;
      };
      return {
        email: payload.external?.email === true,
        google: payload.external?.google === true,
      };
    })
    .catch(() => ({ email: true, google: false }));

  return authCapabilitiesPromise;
}

let browserClient: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient {
  if (!isSupabaseConfigured) {
    throw new Error("Supabase is not configured");
  }
  browserClient ??= createClient(supabaseUrl, supabaseKey, {
    auth: {
      flowType: "pkce",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return browserClient;
}
