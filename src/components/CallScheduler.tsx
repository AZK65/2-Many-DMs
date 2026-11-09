"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { buildCallInvite, type CallInvite } from "@/lib/call-invite";
import { CalendarIcon, CheckIcon, ClockIcon, CloseIcon, LinkIcon, MailIcon } from "./icons";
import { OverlayPortal } from "./OverlayPortal";

const DURATIONS = [15, 30, 45, 60] as const;
const TIME_SLOTS = Array.from({ length: 26 }, (_, index) => 8 * 60 + index * 30);
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const GUEST_TIME_ZONES = [
  { value: "Europe/London", label: "United Kingdom (London)" },
  { value: "America/New_York", label: "Eastern time (New York)" },
  { value: "America/Toronto", label: "Eastern time (Toronto)" },
  { value: "America/Chicago", label: "Central time (Chicago)" },
  { value: "America/Denver", label: "Mountain time (Denver)" },
  { value: "America/Los_Angeles", label: "Pacific time (Los Angeles)" },
  { value: "Europe/Paris", label: "Central Europe (Paris)" },
  { value: "Asia/Dubai", label: "Gulf time (Dubai)" },
  { value: "Asia/Kolkata", label: "India (Kolkata)" },
  { value: "Asia/Singapore", label: "Singapore" },
  { value: "Australia/Sydney", label: "Australia (Sydney)" },
] as const;

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function nextStart(): Date {
  const date = new Date();
  date.setSeconds(0, 0);
  const minutes = date.getMinutes();
  date.setMinutes(minutes < 30 ? 30 : 60);
  if (date.getHours() >= 19) {
    date.setDate(date.getDate() + 1);
    date.setHours(9, 0, 0, 0);
  }
  return date;
}

function timeKey(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function timeMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function timeFromMinutes(value: number): string {
  const wrapped = (value + 24 * 60) % (24 * 60);
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

function formatClockValue(value: string): string {
  const minutes = timeMinutes(value);
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(
    new Date(2026, 0, 1, Math.floor(minutes / 60), minutes % 60),
  );
}

function monthGrid(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1, 12);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

function upcomingDays(): Date[] {
  const start = new Date();
  start.setHours(12, 0, 0, 0);
  return Array.from({ length: 5 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

function zonedDateParts(date: Date, timeZone: string): Record<string, number> {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, Number(part.value)]));
}

function zoneOffsetMinutes(date: Date, timeZone: string): number {
  const parts = zonedDateParts(date, timeZone);
  return Math.round((Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - date.getTime()) / 60_000);
}

function timeDifferenceLabel(date: Date, localTimeZone: string, guestTimeZone: string): string {
  const difference = zoneOffsetMinutes(date, guestTimeZone) - zoneOffsetMinutes(date, localTimeZone);
  if (difference === 0) return "same time";
  const absolute = Math.abs(difference);
  const hours = Math.floor(absolute / 60);
  const minutes = absolute % 60;
  const amount = [hours ? `${hours} hr` : "", minutes ? `${minutes} min` : ""].filter(Boolean).join(" ");
  return `${amount} ${difference > 0 ? "ahead" : "behind"}`;
}

function formatZonedTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function formatZonedClock(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

export function CallScheduler({
  contactName,
  contactEmail,
  initialInvite,
  onClose,
  onInsert,
}: {
  contactName: string;
  contactEmail?: string | null;
  initialInvite?: CallInvite | null;
  onClose: () => void;
  onInsert: (body: string) => void;
}) {
  const initial = useMemo(
    () => initialInvite ? new Date(initialInvite.startsAt) : nextStart(),
    [initialInvite],
  );
  const days = useMemo(upcomingDays, []);
  const initialMinutes = initialInvite
    ? Math.round((new Date(initialInvite.endsAt).getTime() - new Date(initialInvite.startsAt).getTime()) / 60_000)
    : 30;
  const [title, setTitle] = useState(initialInvite?.title || `Call with ${contactName}`);
  const [date, setDate] = useState(dateKey(initial));
  const [time, setTime] = useState(timeKey(initial));
  const [duration, setDuration] = useState<(typeof DURATIONS)[number]>(
    DURATIONS.includes(initialMinutes as (typeof DURATIONS)[number])
      ? initialMinutes as (typeof DURATIONS)[number]
      : 30,
  );
  const [meetingUrl, setMeetingUrl] = useState(initialInvite?.meetingUrl || "");
  const localTimeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const [guestTimeZone, setGuestTimeZone] = useState(initialInvite?.guestTimeZone || "Europe/London");
  const [guests, setGuests] = useState<string[]>(() => {
    if (initialInvite?.guests.length) return initialInvite.guests;
    const email = contactEmail?.trim().toLowerCase() || "";
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? [email] : [];
  });
  const [guestInput, setGuestInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date(initial.getFullYear(), initial.getMonth(), 1, 12));

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (calendarOpen) setCalendarOpen(false);
      else if (timeOpen) setTimeOpen(false);
      else onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [calendarOpen, onClose, timeOpen]);

  function addGuestEmails(value: string): boolean {
    const additions = value.split(/[\s,;]+/).map(email => email.trim().toLowerCase()).filter(Boolean);
    if (!additions.length) return true;
    if (additions.some(email => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      setError("Check the guest email address.");
      return false;
    }
    setGuests(current => [...new Set([...current, ...additions])].slice(0, 20));
    setGuestInput("");
    setError(null);
    return true;
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const startsAt = new Date(`${date}T${time}:00`);
    if (!title.trim()) {
      setError("Add a call title.");
      return;
    }
    if (Number.isNaN(startsAt.getTime()) || startsAt.getTime() <= Date.now()) {
      setError("Choose a time in the future.");
      return;
    }
    if (meetingUrl.trim()) {
      try {
        const url = new URL(/^https?:\/\//i.test(meetingUrl.trim()) ? meetingUrl.trim() : `https://${meetingUrl.trim()}`);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error("scheme");
      } catch {
        setError("Enter a valid Meet or Zoom link.");
        return;
      }
    }
    const pendingGuests = guestInput.trim()
      ? guestInput.split(/[\s,;]+/).map(email => email.trim().toLowerCase()).filter(Boolean)
      : [];
    if (pendingGuests.some(email => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      setError("Check the guest email address.");
      return;
    }
    const allGuests = [...new Set([...guests, ...pendingGuests])].slice(0, 20);
    onInsert(buildCallInvite({ title, startsAt, durationMinutes: duration, meetingUrl, guests: allGuests, guestTimeZone }));
  }

  const selectedStart = useMemo(() => new Date(`${date}T${time}:00`), [date, time]);
  const hasValidStart = !Number.isNaN(selectedStart.getTime());
  const timezone = localTimeZone.replace(/_/g, " ");
  const guestDifference = hasValidStart ? timeDifferenceLabel(selectedStart, localTimeZone, guestTimeZone) : "";
  const calendarDays = useMemo(() => monthGrid(calendarMonth), [calendarMonth]);
  const today = dateKey(new Date());
  const selectedDate = new Date(`${date}T12:00:00`);
  const selectedDateLabel = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "long", day: "numeric" }).format(selectedDate);
  const monthLabel = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(calendarMonth);
  const previousMonthDisabled = calendarMonth.getFullYear() === new Date().getFullYear() && calendarMonth.getMonth() === new Date().getMonth();

  function chooseDate(day: Date) {
    setDate(dateKey(day));
    setCalendarMonth(new Date(day.getFullYear(), day.getMonth(), 1, 12));
    setCalendarOpen(false);
    setError(null);
  }

  function adjustTime(minutes: number) {
    setTime(current => timeFromMinutes(timeMinutes(current) + minutes));
    setTimeOpen(false);
    setError(null);
  }

  return (
    <OverlayPortal onClose={onClose}>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="call-scheduler-title"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <motion.form
          initial={{ opacity: 0, scale: 0.96, y: 14 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 14 }}
          transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
          onSubmit={submit}
          className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200 dark:bg-[#181818] dark:ring-neutral-700"
        >
          <div className="flex items-start gap-3 border-b border-slate-100 px-5 py-4 dark:border-neutral-800">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent">
              <ClockIcon className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id="call-scheduler-title" className="text-base font-semibold text-slate-950 dark:text-white">Schedule a call</h2>
              <p className="mt-0.5 text-sm text-slate-500 dark:text-neutral-400">Add an invite to your draft for review.</p>
            </div>
            <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-neutral-800 dark:hover:text-white" aria-label="Close call scheduler">
              <CloseIcon className="h-4 w-4" />
            </button>
          </div>

          <div className="max-h-[70vh] space-y-5 overflow-y-auto px-5 py-5">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-neutral-300">Title</span>
              <input autoFocus value={title} onChange={(event) => { setTitle(event.target.value); setError(null); }} maxLength={120} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20 dark:border-neutral-700 dark:bg-[#1F1F1F] dark:text-white" />
            </label>

            <fieldset>
              <legend className="mb-2 text-xs font-semibold text-slate-600 dark:text-neutral-300">Date</legend>
              <div className="grid grid-cols-5 gap-1.5">
                {days.map((day) => {
                  const key = dateKey(day);
                  const selected = date === key;
                  return (
                    <button key={key} type="button" onClick={() => chooseDate(day)} aria-pressed={selected} className={`rounded-xl px-1 py-2 text-center transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${selected ? "bg-accent text-accent-fg shadow-sm" : "bg-slate-50 text-slate-600 hover:bg-slate-100 dark:bg-[#1F1F1F] dark:text-neutral-300 dark:hover:bg-neutral-700"}`}>
                      <span className="block text-[10px] font-semibold uppercase tracking-wide opacity-70">{new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(day)}</span>
                      <span className="mt-0.5 block text-sm font-semibold">{day.getDate()}</span>
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => { setCalendarOpen(open => !open); setTimeOpen(false); }}
                aria-expanded={calendarOpen}
                aria-controls="call-calendar"
                className="mt-2 flex w-full items-center gap-3 rounded-xl border border-transparent bg-slate-50 px-3 py-2.5 text-left transition hover:border-slate-200 hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:bg-[#1F1F1F] dark:hover:border-neutral-700 dark:hover:bg-[#272727]"
              >
                <CalendarIcon className="h-4 w-4 shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1 text-xs text-slate-500 dark:text-neutral-400">Choose another date</span>
                <span className="truncate text-sm font-semibold text-slate-800 dark:text-neutral-100">{selectedDateLabel}</span>
              </button>
              <AnimatePresence initial={false}>
                {calendarOpen && (
                  <motion.div
                    id="call-calendar"
                    initial={{ opacity: 0, height: 0, y: -4 }}
                    animate={{ opacity: 1, height: "auto", y: 0 }}
                    exit={{ opacity: 0, height: 0, y: -4 }}
                    className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white p-3 shadow-lg dark:border-neutral-700 dark:bg-[#202020]"
                    role="group"
                    aria-label="Choose call date"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <button type="button" onClick={() => setCalendarMonth(month => new Date(month.getFullYear(), month.getMonth() - 1, 1, 12))} disabled={previousMonthDisabled} aria-label="Previous month" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 disabled:opacity-25 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:text-neutral-300 dark:hover:bg-neutral-700">←</button>
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">{monthLabel}</p>
                      <button type="button" onClick={() => setCalendarMonth(month => new Date(month.getFullYear(), month.getMonth() + 1, 1, 12))} aria-label="Next month" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:text-neutral-300 dark:hover:bg-neutral-700">→</button>
                    </div>
                    <div className="mt-3 grid grid-cols-7 gap-1" aria-hidden="true">
                      {WEEKDAYS.map(day => <span key={day} className="py-1 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">{day.slice(0, 1)}</span>)}
                    </div>
                    <div className="grid grid-cols-7 gap-1">
                      {calendarDays.map(day => {
                        const key = dateKey(day);
                        const selected = key === date;
                        const disabled = key < today;
                        const outsideMonth = day.getMonth() !== calendarMonth.getMonth();
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => chooseDate(day)}
                            disabled={disabled}
                            aria-pressed={selected}
                            aria-label={new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(day)}
                            className={`grid aspect-square min-h-8 place-items-center rounded-lg text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${selected ? "bg-accent text-accent-fg shadow-sm" : disabled ? "cursor-not-allowed text-slate-200 dark:text-neutral-700" : outsideMonth ? "text-slate-300 hover:bg-slate-50 dark:text-neutral-600 dark:hover:bg-neutral-800" : "text-slate-700 hover:bg-slate-100 dark:text-neutral-200 dark:hover:bg-neutral-700"}`}
                          >
                            {day.getDate()}
                          </button>
                        );
                      })}
                    </div>
                    <button type="button" onClick={() => chooseDate(new Date())} className="mt-2 w-full rounded-lg py-2 text-xs font-semibold text-accent transition hover:bg-accent/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">Jump to today</button>
                  </motion.div>
                )}
              </AnimatePresence>
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <span className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-neutral-300">Time</span>
                <div className="relative">
                  <div className="flex rounded-xl border border-slate-200 bg-white p-1 dark:border-neutral-700 dark:bg-[#1F1F1F]">
                    <button type="button" onClick={() => adjustTime(-15)} aria-label="15 minutes earlier" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-neutral-700 dark:hover:text-white">−</button>
                    <button
                      type="button"
                      onClick={() => { setTimeOpen(open => !open); setCalendarOpen(false); }}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowUp") { event.preventDefault(); adjustTime(-15); }
                        if (event.key === "ArrowDown") { event.preventDefault(); adjustTime(15); }
                      }}
                      aria-expanded={timeOpen}
                      aria-controls="call-time-slots"
                      aria-label={`Call time, ${formatClockValue(time)}`}
                      className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-lg px-2 text-sm font-semibold text-slate-900 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:text-white dark:hover:bg-neutral-800"
                    >
                      <ClockIcon className="h-4 w-4 text-accent" /> {formatClockValue(time)}
                    </button>
                    <button type="button" onClick={() => adjustTime(15)} aria-label="15 minutes later" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-neutral-700 dark:hover:text-white">+</button>
                  </div>
                  <AnimatePresence initial={false}>
                    {timeOpen && (
                      <motion.div id="call-time-slots" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="absolute left-0 right-0 top-full z-10 mt-2 max-h-44 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-xl dark:border-neutral-700 dark:bg-[#202020]" role="group" aria-label="Choose a time">
                        <div className="grid grid-cols-2 gap-1.5">
                          {TIME_SLOTS.map(minutes => {
                            const value = timeFromMinutes(minutes);
                            const selected = value === time;
                            return <button key={value} type="button" onClick={() => { setTime(value); setTimeOpen(false); setError(null); }} aria-pressed={selected} className={`rounded-lg px-2 py-2 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${selected ? "bg-accent text-accent-fg" : "bg-slate-50 text-slate-600 hover:bg-slate-100 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"}`}>{formatClockValue(value)}</button>;
                          })}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                <span className="mt-1 block text-[11px] text-slate-400 dark:text-neutral-500">{timezone} · 15-minute steps</span>
              </div>
              <fieldset>
                <legend className="mb-1.5 text-xs font-semibold text-slate-600 dark:text-neutral-300">Duration</legend>
                <div className="grid grid-cols-4 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-[#1F1F1F]">
                  {DURATIONS.map((minutes) => (
                    <button key={minutes} type="button" onClick={() => setDuration(minutes)} aria-pressed={duration === minutes} className={`rounded-lg px-1 py-2 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${duration === minutes ? "bg-white text-slate-900 shadow-sm dark:bg-neutral-700 dark:text-white" : "text-slate-500 hover:text-slate-800 dark:text-neutral-400 dark:hover:text-white"}`}>{minutes}</button>
                  ))}
                </div>
                <span className="mt-1 block text-[11px] text-slate-400 dark:text-neutral-500">minutes</span>
              </fieldset>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-neutral-700 dark:bg-[#1F1F1F]">
              <label htmlFor="call-guest-timezone" className="flex items-center justify-between gap-3">
                <span className="text-xs font-semibold text-slate-600 dark:text-neutral-300">Guest time zone</span>
                <select
                  id="call-guest-timezone"
                  value={guestTimeZone}
                  onChange={(event) => { setGuestTimeZone(event.target.value); setError(null); }}
                  className="min-w-0 max-w-64 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-800 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20 dark:border-neutral-700 dark:bg-[#272727] dark:text-neutral-100"
                >
                  {GUEST_TIME_ZONES.map(zone => <option key={zone.value} value={zone.value}>{zone.label}</option>)}
                </select>
              </label>
              {hasValidStart && (
                <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2" role="status" aria-live="polite">
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">Your time</p>
                    <p className="mt-0.5 text-xs font-semibold leading-5 text-slate-800 dark:text-neutral-100">{formatZonedTime(selectedStart, localTimeZone)}</p>
                  </div>
                  <span aria-hidden="true" className="text-sm text-slate-300 dark:text-neutral-600">→</span>
                  <div className="min-w-0 text-right">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-accent">Guest · {guestDifference}</p>
                    <p className="mt-0.5 text-xs font-semibold leading-5 text-slate-800 dark:text-neutral-100">{formatZonedTime(selectedStart, guestTimeZone)}</p>
                  </div>
                </div>
              )}
            </div>

            <div>
              <label htmlFor="call-guests" className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-neutral-300">
                <MailIcon className="h-3.5 w-3.5" /> Guests <span className="font-normal text-slate-400">optional</span>
              </label>
              {guests.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5" aria-label="Call guests">
                  {guests.map(email => (
                    <span key={email} className="inline-flex min-w-0 items-center gap-1 rounded-lg bg-accent/10 px-2 py-1 text-xs font-medium text-accent">
                      <span className="max-w-48 truncate">{email}</span>
                      <button type="button" onClick={() => setGuests(current => current.filter(item => item !== email))} className="grid h-4 w-4 place-items-center rounded hover:bg-accent/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent" aria-label={`Remove ${email}`}>
                        <CloseIcon className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <input
                id="call-guests"
                type="email"
                multiple
                value={guestInput}
                onChange={(event) => { setGuestInput(event.target.value); setError(null); }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === ",") {
                    event.preventDefault();
                    addGuestEmails(guestInput);
                  }
                }}
                onBlur={() => { if (guestInput.trim()) addGuestEmails(guestInput); }}
                placeholder="guest@company.com — press Enter"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-accent focus:ring-2 focus:ring-accent/20 dark:border-neutral-700 dark:bg-[#1F1F1F] dark:text-white dark:placeholder:text-neutral-600"
              />
              <p className="mt-1 text-[11px] text-slate-400 dark:text-neutral-500">The first email is the attendee; the rest receive guest invites.</p>
            </div>

            <label className="block">
              <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-neutral-300"><LinkIcon className="h-3.5 w-3.5" /> Meet or Zoom link <span className="font-normal text-slate-400">optional</span></span>
              <input type="url" value={meetingUrl} onChange={(event) => { setMeetingUrl(event.target.value); setError(null); }} placeholder="meet.google.com/…" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-accent focus:ring-2 focus:ring-accent/20 dark:border-neutral-700 dark:bg-[#1F1F1F] dark:text-white dark:placeholder:text-neutral-600" />
            </label>

            {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/70 px-5 py-4 dark:border-neutral-800 dark:bg-[#1F1F1F]">
            <p className="max-w-56 text-xs leading-5 text-slate-400 dark:text-neutral-500">Nothing is sent until you review and press Send.</p>
            <button type="submit" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition hover:opacity-90 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#1F1F1F]">
              <CheckIcon className="h-4 w-4" /> Add to draft
            </button>
          </div>
        </motion.form>
      </motion.div>
    </OverlayPortal>
  );
}

export function CallInviteCard({
  invite,
  onOpen,
  draftActions,
}: {
  invite: CallInvite;
  onOpen: (url: string, label: string) => void;
  draftActions?: { onEdit: () => void; onRemove: () => void };
}) {
  const startsAt = new Date(invite.startsAt);
  const endsAt = new Date(invite.endsAt);
  const when = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(startsAt);
  const endTime = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(endsAt);
  const minutes = Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000);
  const localTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const guestWhen = invite.guestTimeZone ? formatZonedTime(startsAt, invite.guestTimeZone) : null;
  const guestEndTime = invite.guestTimeZone ? formatZonedClock(endsAt, invite.guestTimeZone) : null;
  const guestDifference = invite.guestTimeZone ? timeDifferenceLabel(startsAt, localTimeZone, invite.guestTimeZone) : null;

  return (
    <section aria-label={`Call invite: ${invite.title}`} className="w-full min-w-64 max-w-sm overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-900 shadow-sm dark:border-neutral-700 dark:bg-[#272727] dark:text-white">
      <div className="flex items-start gap-3 px-3.5 py-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent"><ClockIcon className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-accent">Call invite</p>
          <h3 className="mt-0.5 truncate text-sm font-semibold">{invite.title}</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-neutral-400">{when}–{endTime} · {minutes} min</p>
          {guestWhen && <p className="mt-0.5 text-xs leading-5 text-accent">Guest · {guestWhen}–{guestEndTime} · {guestDifference}</p>}
          {invite.guests.length > 0 && <p className="mt-0.5 truncate text-xs text-slate-400 dark:text-neutral-500">{invite.guests.length} {invite.guests.length === 1 ? "guest" : "guests"} · {invite.guests.join(", ")}</p>}
        </div>
      </div>
      <div className="flex gap-2 border-t border-slate-100 px-3 py-2.5 dark:border-neutral-700">
        {draftActions ? <>
          <button type="button" onClick={draftActions.onRemove} className="flex min-h-9 flex-1 items-center justify-center rounded-lg bg-slate-100 px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-200 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700">Remove</button>
          <button type="button" onClick={draftActions.onEdit} className="flex min-h-9 flex-1 items-center justify-center rounded-lg bg-accent px-3 text-xs font-semibold text-accent-fg transition hover:opacity-90 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">Edit invite</button>
        </> : <>
          <button type="button" onClick={() => onOpen(invite.calendarUrl, "Add call to calendar")} className="flex min-h-9 flex-1 items-center justify-center rounded-lg bg-slate-100 px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-200 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700">Add to calendar</button>
          {invite.meetingUrl && <button type="button" onClick={() => onOpen(invite.meetingUrl!, "Join call")} className="flex min-h-9 flex-1 items-center justify-center rounded-lg bg-accent px-3 text-xs font-semibold text-accent-fg transition hover:opacity-90 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">Join call</button>}
        </>}
      </div>
    </section>
  );
}
