"use client";

import type { Session, SupabaseClient } from "@supabase/supabase-js";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  createProfile,
  loadProfile,
  loadUserState,
  type UserProfile,
} from "@/lib/supabase/data";
import {
  getSupabaseBrowserClient,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import type { AppState } from "@/lib/types";

export type ConnectedSupabase = {
  client: SupabaseClient;
  userId: string;
  profile: UserProfile;
  initialState: AppState;
  refresh: () => Promise<AppState>;
  signOut: () => Promise<void>;
};

type GatePhase =
  | { name: "loading" }
  | { name: "signed_out" }
  | { name: "profile_setup"; userId: string }
  | { name: "ready"; connection: ConnectedSupabase }
  | { name: "schema_missing" }
  | { name: "error"; message: string };

type SupabaseGateProps = {
  children: (connection: ConnectedSupabase | null) => ReactNode;
  signedOut?: (
    openSignIn: () => void,
    client: SupabaseClient,
  ) => ReactNode;
};

function errorCode(error: unknown): string {
  if (!error || typeof error !== "object" || !("code" in error)) return "";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : "";
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Something went wrong.";
}

function friendlyAuthError(error: unknown): string {
  const message = errorMessage(error);
  const normalized = message.toLowerCase();
  if (normalized.includes("rate limit") || normalized.includes("too many requests")) {
    return "Supabase has temporarily paused email links for this project. Continue with Google now, or try email again after the cooldown.";
  }
  return message;
}

function isMissingSchema(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return (
    errorCode(error) === "PGRST205" ||
    errorCode(error) === "PGRST202" ||
    message.includes("schema cache") ||
    (message.includes("could not find the table") && message.includes("public."))
  );
}

function AuthCard({
  client,
  onBack,
  onLocalMode,
}: {
  client: SupabaseClient;
  onBack?: () => void;
  onLocalMode?: () => void;
}) {
  const [email, setEmail] = useState("");
  const [pendingAction, setPendingAction] = useState<"email" | "google" | null>(
    null,
  );
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function sendMagicLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError("Enter your email address.");
      return;
    }

    setPendingAction("email");
    setError("");
    setSent(false);
    const { error: authError } = await client.auth.signInWithOtp({
      email: normalizedEmail,
      options: { emailRedirectTo: `${window.location.origin}${window.location.pathname}` },
    });
    setPendingAction(null);
    if (authError) {
      setError(friendlyAuthError(authError));
      return;
    }
    setSent(true);
  }

  async function signInWithGoogle() {
    setPendingAction("google");
    setError("");
    const { error: authError } = await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (authError) {
      setPendingAction(null);
      setError(friendlyAuthError(authError));
    }
  }

  return (
    <div className="supabase-auth-shell supabase-auth-overlay" role="dialog" aria-modal="true" aria-labelledby="sign-in-title">
      <section className="supabase-auth-card">
        <div className="supabase-auth-topbar">
          <span className="supabase-auth-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M8 4.75h8" strokeWidth="1.9" strokeLinecap="round" opacity="0.28" /><path d="M5.5 9.25h13" strokeWidth="1.9" strokeLinecap="round" opacity="0.52" /><path d="M7 13.75h10" strokeWidth="1.9" strokeLinecap="round" opacity="0.78" /><circle cx="12" cy="19" r="1.7" fill="currentColor" stroke="none" /></svg></span>
          {onBack ? <button className="supabase-auth-back" type="button" onClick={onBack}>Close</button> : null}
        </div>
        <p className="supabase-auth-kicker">Your private film journal</p>
        <h1 id="sign-in-title">Sign in</h1>
        <p className="supabase-auth-intro">No password to remember. We’ll email you a secure sign-in link, or you can continue with Google.</p>
        <form className="supabase-auth-form" onSubmit={sendMagicLink}>
          <label>
            <span>Email</span>
            <input
              type="email"
              name="email"
              autoComplete="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setSent(false);
                setError("");
              }}
              disabled={pendingAction !== null}
              required
            />
          </label>
          <button
            className="supabase-auth-primary"
            type="submit"
            disabled={pendingAction !== null || sent}
          >
            {pendingAction === "email" ? "Sending…" : sent ? "Link sent" : "Send magic link"}
          </button>
        </form>
        <div className="supabase-auth-divider"><span>or</span></div>
        <button
          className="supabase-auth-secondary"
          type="button"
          onClick={() => void signInWithGoogle()}
          disabled={pendingAction !== null}
        >
          {pendingAction === "google" ? "Redirecting…" : "Continue with Google"}
        </button>
        {onLocalMode ? (
          <button className="supabase-auth-local" type="button" onClick={onLocalMode} disabled={pendingAction !== null}>
            Continue locally on this device
          </button>
        ) : null}
        {sent ? (
          <p className="supabase-auth-status" role="status">
            Link sent to <strong>{email.trim().toLowerCase()}</strong>. You can close this after opening it.
          </p>
        ) : null}
        {error ? (
          <p className="supabase-auth-error" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    </div>
  );
}

function ProfileSetup({
  client,
  userId,
  onComplete,
  onSchemaMissing,
}: {
  client: SupabaseClient;
  userId: string;
  onComplete: () => Promise<void>;
  onSchemaMissing: () => void;
}) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedUsername = username.trim().toLowerCase();
    const normalizedDisplayName = displayName.trim();

    if (!/^[a-z0-9][a-z0-9_]{1,28}[a-z0-9]$/.test(normalizedUsername)) {
      setError("Username must be 3–30 characters and start and end with a letter or number.");
      return;
    }
    if (!normalizedDisplayName) {
      setError("Enter a display name.");
      return;
    }

    setPending(true);
    setError("");
    try {
      await createProfile(client, {
        id: userId,
        username: normalizedUsername,
        displayName: normalizedDisplayName,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      });
      await onComplete();
    } catch (profileError) {
      if (isMissingSchema(profileError)) {
        onSchemaMissing();
        return;
      }
      if (errorCode(profileError) === "23505") {
        setError("Username is already taken.");
      } else {
        setError(errorMessage(profileError));
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="supabase-auth-shell">
      <section className="supabase-auth-card" aria-labelledby="profile-title">
        <div className="supabase-auth-topbar"><span className="supabase-auth-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M8 4.75h8" strokeWidth="1.9" strokeLinecap="round" opacity="0.28" /><path d="M5.5 9.25h13" strokeWidth="1.9" strokeLinecap="round" opacity="0.52" /><path d="M7 13.75h10" strokeWidth="1.9" strokeLinecap="round" opacity="0.78" /><circle cx="12" cy="19" r="1.7" fill="currentColor" stroke="none" /></svg></span></div>
        <h1 id="profile-title">Create profile</h1>
        <form className="supabase-auth-form" onSubmit={saveProfile}>
          <label>
            <span>Username</span>
            <input
              type="text"
              name="username"
              autoComplete="username"
              minLength={3}
              maxLength={30}
              pattern="[a-z0-9][a-z0-9_]{1,28}[a-z0-9]"
              value={username}
              onChange={(event) => setUsername(event.target.value.toLowerCase())}
              disabled={pending}
              required
            />
          </label>
          <label>
            <span>Display name</span>
            <input
              type="text"
              name="display-name"
              autoComplete="name"
              maxLength={80}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              disabled={pending}
              required
            />
          </label>
          <button
            className="supabase-auth-primary"
            type="submit"
            disabled={pending}
          >
            {pending ? "Saving…" : "Create profile"}
          </button>
        </form>
        {error ? (
          <p className="supabase-auth-error" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    </main>
  );
}

function SupabaseStatus({
  title,
  detail,
}: {
  title: string;
  detail?: string;
}) {
  return (
    <main className="supabase-auth-shell">
      <section className="supabase-auth-card" role="status">
        <h1>{title}</h1>
        {detail ? <p className="supabase-auth-detail">{detail}</p> : null}
      </section>
    </main>
  );
}

function ConfiguredSupabaseGate({ children, signedOut }: SupabaseGateProps) {
  const client = useMemo(() => getSupabaseBrowserClient(), []);
  const [phase, setPhase] = useState<GatePhase>({ name: "loading" });
  const [showSignIn, setShowSignIn] = useState(false);
  const [localMode, setLocalMode] = useState(false);
  const generation = useRef(0);

  const loadAccount = useCallback(
    async (userId: string) => {
      const requestGeneration = ++generation.current;
      setPhase({ name: "loading" });
      try {
        const profile = await loadProfile(client, userId);
        if (requestGeneration !== generation.current) return;
        if (!profile) {
          setPhase({ name: "profile_setup", userId });
          return;
        }

        const initialState = await loadUserState(client, userId);
        if (requestGeneration !== generation.current) return;
        const connection: ConnectedSupabase = {
          client,
          userId,
          profile,
          initialState,
          refresh: () => loadUserState(client, userId),
          signOut: async () => {
            const { error } = await client.auth.signOut();
            if (error) throw error;
          },
        };
        setPhase({ name: "ready", connection });
      } catch (accountError) {
        if (requestGeneration !== generation.current) return;
        if (isMissingSchema(accountError)) {
          setPhase({ name: "schema_missing" });
        } else {
          setPhase({ name: "error", message: errorMessage(accountError) });
        }
      }
    },
    [client],
  );

  useEffect(() => {
    let disposed = false;
    let resolvedUserId: string | null | undefined;

    function applySession(session: Session | null) {
      if (disposed) return;
      const userId = session?.user.id ?? null;
      if (resolvedUserId === userId) return;
      resolvedUserId = userId;
      if (!userId) {
        generation.current += 1;
        setShowSignIn(false);
        setPhase({ name: "signed_out" });
        return;
      }
      void loadAccount(userId);
    }

    void client.auth.getSession().then(({ data, error }) => {
      if (disposed) return;
      if (error) {
        setPhase({ name: "error", message: error.message });
        return;
      }
      applySession(data.session);
    });

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, session) => {
      queueMicrotask(() => applySession(session));
    });

    return () => {
      disposed = true;
      generation.current += 1;
      subscription.unsubscribe();
    };
  }, [client, loadAccount]);

  if (localMode) return <>{children(null)}</>;
  if (phase.name === "loading") {
    return <SupabaseStatus title="Loading…" />;
  }
  if (phase.name === "signed_out") {
    if (!showSignIn && signedOut) {
      return <>{signedOut(() => setShowSignIn(true), client)}</>;
    }
    return (
      <>
        {signedOut ? signedOut(() => setShowSignIn(true), client) : null}
        <AuthCard
          client={client}
          onBack={signedOut ? () => setShowSignIn(false) : undefined}
          onLocalMode={process.env.NODE_ENV !== "production" ? () => setLocalMode(true) : undefined}
        />
      </>
    );
  }
  if (phase.name === "profile_setup") {
    return (
      <ProfileSetup
        client={client}
        userId={phase.userId}
        onComplete={() => loadAccount(phase.userId)}
        onSchemaMissing={() => setPhase({ name: "schema_missing" })}
      />
    );
  }
  if (phase.name === "schema_missing") {
    return (
      <SupabaseStatus
        title="Database schema is not installed"
        detail="Run supabase/migrations/0001_after_credits.sql in this Supabase project."
      />
    );
  }
  if (phase.name === "error") {
    return <SupabaseStatus title="Could not load After Credits" detail={phase.message} />;
  }
  return <>{children(phase.connection)}</>;
}

export default function SupabaseGate({ children, signedOut }: SupabaseGateProps) {
  if (!isSupabaseConfigured) return <>{children(null)}</>;
  return <ConfiguredSupabaseGate signedOut={signedOut}>{children}</ConfiguredSupabaseGate>;
}
