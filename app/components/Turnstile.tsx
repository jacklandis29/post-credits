"use client";

import { useEffect, useRef } from "react";

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      appearance: "interaction-only";
      theme: "dark";
      size: "flexible";
      callback: (token: string) => void;
      "error-callback": () => void;
      "expired-callback": () => void;
      "timeout-callback": () => void;
    },
  ) => string;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let turnstileLoader: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (turnstileLoader) return turnstileLoader;

  const loader = new Promise<TurnstileApi>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-post-credits-turnstile="true"]',
    );
    const script = existing ?? document.createElement("script");

    const finish = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error("Turnstile did not initialize"));
    };
    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", () => reject(new Error("Turnstile failed to load")), {
      once: true,
    });

    if (!existing) {
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.dataset.postCreditsTurnstile = "true";
      document.head.appendChild(script);
    }
  }).catch((error) => {
    turnstileLoader = null;
    throw error;
  });

  turnstileLoader = loader;
  return loader;
}

export function Turnstile({
  siteKey,
  onToken,
  onUnavailable,
}: {
  siteKey: string;
  onToken: (token: string) => void;
  onUnavailable: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    let widgetId = "";

    void loadTurnstile()
      .then((turnstile) => {
        if (disposed || !container.current) return;
        widgetId = turnstile.render(container.current, {
          sitekey: siteKey,
          appearance: "interaction-only",
          theme: "dark",
          size: "flexible",
          callback: onToken,
          "error-callback": onUnavailable,
          "expired-callback": () => onToken(""),
          "timeout-callback": () => onToken(""),
        });
      })
      .catch(() => {
        if (!disposed) onUnavailable();
      });

    return () => {
      disposed = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [onToken, onUnavailable, siteKey]);

  return <div className="turnstile-slot" ref={container} aria-label="Security check" />;
}
