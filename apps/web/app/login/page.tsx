"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

function TelegramLoginWidget({ botUsername }: { botUsername: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    const s = document.createElement("script");
    s.async = true;
    s.src = "https://telegram.org/js/telegram-widget.js?22";
    s.setAttribute("data-telegram-login", botUsername);
    s.setAttribute("data-size", "large");
    s.setAttribute("data-onauth", "onTelegramAuth(user)");
    s.setAttribute("data-request-access", "write");
    ref.current.replaceChildren(s);
    return () => {
      ref.current?.replaceChildren();
    };
  }, [botUsername]);
  return <div ref={ref} />;
}

declare global {
  interface Window {
    onTelegramAuth?: (user: TelegramUser) => void;
  }
}

interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.onTelegramAuth = async (u: TelegramUser) => {
      const res = await fetch("/api/auth/telegram", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(u),
      });
      if (res.ok) {
        router.replace("/");
      } else {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `auth failed (${res.status})`);
      }
    };
  }, [router]);

  const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? "";

  return (
    <section className="mx-auto max-w-md py-12 text-center">
      <h1 className="mb-2 text-3xl font-semibold">lifeagent</h1>
      <p className="mb-8 text-muted">sign in with the same Telegram account that owns the bot.</p>
      {botUsername ? (
        <TelegramLoginWidget botUsername={botUsername} />
      ) : (
        <p className="text-red-400">
          NEXT_PUBLIC_TELEGRAM_BOT_USERNAME is not set; the login widget cannot render.
        </p>
      )}
      {error ? <p className="mt-4 text-sm text-red-400">{error}</p> : null}
    </section>
  );
}
