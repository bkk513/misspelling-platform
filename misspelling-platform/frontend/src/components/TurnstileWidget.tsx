/* 文件说明：Turnstile 组件，负责在前端页面中嵌入 Cloudflare 验证控件。 */

import { Alert } from "antd";
import { useEffect, useRef } from "react";

let turnstileScriptPromise: Promise<void> | null = null;

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      theme?: 'light' | 'dark' | 'auto';
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    }
  ) => string | number;
  remove: (id: string | number) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (turnstileScriptPromise) return turnstileScriptPromise;
  turnstileScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>("script[data-turnstile='true']");
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Failed to load Turnstile script")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.dataset.turnstile = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Turnstile script"));
    document.head.appendChild(script);
  });
  return turnstileScriptPromise;
}

export function TurnstileWidget({
  siteKey,
  refreshKey,
  onTokenChange,
  theme = 'light'
}: {
  siteKey: string;
  refreshKey: number;
  onTokenChange: (token: string) => void;
  theme?: 'light' | 'dark' | 'auto';
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | number | null>(null);

  useEffect(() => {
    onTokenChange("");
  }, [refreshKey, onTokenChange]);

  useEffect(() => {
    if (!siteKey || !containerRef.current) return;
    let cancelled = false;
    void loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        containerRef.current.innerHTML = "";
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme: theme,
          callback: (token: string) => onTokenChange(token || ""),
          "expired-callback": () => onTokenChange(""),
          "error-callback": () => onTokenChange("")
        });
      })
      .catch(() => onTokenChange(""));
    return () => {
      cancelled = true;
      if (window.turnstile && widgetIdRef.current !== null) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // ignore cleanup failures
        }
      }
      widgetIdRef.current = null;
    };
  }, [siteKey, refreshKey, onTokenChange, theme]);

  if (!siteKey) {
    return <Alert type="info" showIcon message="Turnstile is not enabled on this deployment." />;
  }
  return <div ref={containerRef} />;
}
