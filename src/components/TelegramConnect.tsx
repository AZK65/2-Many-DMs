"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { PlatformGlyph } from "./PlatformIcon";

type Step = "phone" | "code" | "password" | "done";

export function TelegramConnect({
  onClose,
  onConnected,
}: {
  onClose: () => void;
  onConnected?: () => void;
}) {
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [loginId, setLoginId] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [doneLabel, setDoneLabel] = useState("");
  const [region, setRegion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/telegram/login/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't send the code.");
      setLoginId(data.loginId);
      setStep("code");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function verify(withPassword: boolean) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/telegram/login/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          loginId,
          code,
          ...(withPassword ? { password } : {}),
        }),
      });
      const data = await res.json();
      if (data.needsPassword) {
        setStep("password");
        return;
      }
      if (!res.ok) throw new Error(data.error || "Verification failed.");
      setDoneLabel(data.label || phone);
      setRegion(data.proxyRegion ?? null);
      setStep("done");
      onConnected?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center gap-3">
          <span
            className="grid h-10 w-10 place-items-center rounded-full text-white"
            style={{ backgroundColor: "#229ed9" }}
          >
            <PlatformGlyph platform="telegram" className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-neutral-100">
              Connect Telegram
            </h2>
            <p className="text-xs text-slate-500 dark:text-neutral-400">
              {step === "phone" && "Sign in with your phone number"}
              {step === "code" && "Enter the code Telegram just sent you"}
              {step === "password" && "Two-step verification"}
              {step === "done" && "All set"}
            </p>
          </div>
        </div>

        {step === "phone" && (
          <Field
            label="Phone number"
            value={phone}
            onChange={setPhone}
            placeholder="+1 555 123 4567"
            type="tel"
            autoFocus
            onEnter={sendCode}
            hint="Include your country code. We'll text you a login code in Telegram."
          />
        )}

        {step === "code" && (
          <Field
            label="Login code"
            value={code}
            onChange={(v) => setCode(v.replace(/\D/g, ""))}
            placeholder="12345"
            type="text"
            autoFocus
            onEnter={() => verify(false)}
            hint={`Sent to ${phone} via the Telegram app.`}
          />
        )}

        {step === "password" && (
          <Field
            label="Two-step password"
            value={password}
            onChange={setPassword}
            placeholder="Your Telegram password"
            type="password"
            autoFocus
            onEnter={() => verify(true)}
            hint="This account has two-step verification turned on."
          />
        )}

        {step === "done" && (
          <div className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
            <div className="font-medium">Connected {doneLabel} ✓</div>
            <div className="mt-1 text-xs opacity-90">
              {region
                ? `Routing through a ${region} proxy to keep the account safe.`
                : "Your messages will start syncing shortly."}
            </div>
          </div>
        )}

        {error && (
          <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-500/15 dark:text-red-400">
            {error}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            {step === "done" ? "Close" : "Cancel"}
          </button>
          {step === "phone" && (
            <Primary busy={busy} disabled={!phone.trim()} onClick={sendCode}>
              Send code
            </Primary>
          )}
          {step === "code" && (
            <Primary busy={busy} disabled={!code.trim()} onClick={() => verify(false)}>
              Verify
            </Primary>
          )}
          {step === "password" && (
            <Primary
              busy={busy}
              disabled={!password.trim()}
              onClick={() => verify(true)}
            >
              Verify
            </Primary>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  autoFocus,
  onEnter,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  autoFocus?: boolean;
  onEnter?: () => void;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">
        {label}
      </span>
      <input
        autoFocus={autoFocus}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onEnter?.();
        }}
        className="w-full rounded-lg bg-slate-100 px-3 py-2.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-inset focus:ring-[#1FE88A]/40 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:bg-neutral-800 dark:focus:ring-[#1FE88A]/40"
      />
      {hint && (
        <span className="mt-1.5 block text-[11px] text-slate-400 dark:text-neutral-500">
          {hint}
        </span>
      )}
    </label>
  );
}

function Primary({
  busy,
  disabled,
  onClick,
  children,
}: {
  busy: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      disabled={busy || disabled}
      className="rounded-lg bg-[#1FE88A] px-4 py-2 text-sm font-medium text-[#04140d] transition hover:bg-[#16d579] disabled:opacity-40"
    >
      {busy ? "…" : children}
    </motion.button>
  );
}
