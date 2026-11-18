"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

// ---------------- categories → colour families ----------------

export const FAMILY: Record<string, string> = {
  "power tools": "power",
  "hand tools": "hand",
  garden: "garden",
  kitchen: "kitchen",
  camping: "camping",
  cleaning: "cleaning",
  other: "other",
};
export const family = (category: string) => FAMILY[category] ?? "other";

/** Stable chip code from an id, e.g. "LL-0412". */
export function chipCode(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 9973;
  return `LL-${String(h).padStart(4, "0")}`;
}

export function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span className="flex" aria-hidden>
        {["power", "garden", "camping"].map((f, i) => (
          <span key={f} data-family={f} className="-ml-1.5 block h-6 w-3.5 rounded-[2px] bg-f1 first:ml-0" style={{ transform: `rotate(${(i - 1) * 9}deg)` }} />
        ))}
      </span>
      <span className="text-[1.375rem] font-black tracking-tight" style={{ fontStretch: "112%" }}>LendLoop</span>
    </span>
  );
}

// ---------------- dates ----------------

export const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const todayIso = () => isoDay(new Date());
const parse = (s: string) => new Date(`${s}T00:00:00`);
const fmt = new Intl.DateTimeFormat("en", { day: "numeric", month: "short" });
const fmtWeekday = new Intl.DateTimeFormat("en", { weekday: "short", day: "numeric", month: "short" });
export const shortDate = (s: string) => fmt.format(parse(s));
export const dateRange = (a: string, b: string) => (a === b ? shortDate(a) : `${shortDate(a)} – ${shortDate(b)}`);
export const daysBetween = (a: string, b: string) => Math.round((parse(b).getTime() - parse(a).getTime()) / 86_400_000);

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
export function ago(ms: number) {
  const mins = Math.round((ms - Date.now()) / 60_000);
  if (Math.abs(mins) < 60) return rtf.format(mins, "minute");
  if (Math.abs(mins) < 1440) return rtf.format(Math.round(mins / 60), "hour");
  return rtf.format(Math.round(mins / 1440), "day");
}

// ---------------- swatch: status as layers of colour ----------------

export type Stage = "available" | "pending" | "booked" | "out" | "overdue" | "returned" | "closed";

/**
 * The chip itself. Each stage pulls one more layer:
 * pending = light tint, booked = tint + full band, out = full colour,
 * overdue = alarm hatching over full colour, returned/closed = stripped to outline.
 */
export function Swatch({ category, stage = "available", size = 44, label }: { category: string; stage?: Stage; size?: number; label?: string }) {
  const layers: Record<Stage, string> = {
    available: "bg-f1",
    pending: "bg-f4",
    booked: "bg-f4",
    out: "bg-f1",
    overdue: "bg-f1",
    returned: "bg-stock border-2 border-f1",
    closed: "bg-stock border-2 border-rule",
  };
  return (
    <span
      data-family={family(category)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={`relative block flex-none overflow-hidden rounded-[2px] ${layers[stage]}`}
      style={{ width: size, height: size }}
    >
      {stage === "booked" && <span className="absolute inset-x-0 bottom-0 h-1/2 bg-f1" />}
      {stage === "overdue" && <span className="hatched-alarm absolute inset-0 opacity-80" />}
      {stage === "out" && <span className="hatched absolute inset-0" />}
    </span>
  );
}

// ---------------- icons: one 1.75 stroke, 20px grid ----------------

function Icon({ d, className = "size-4" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={d} />
    </svg>
  );
}
export const IconMail = (p: { className?: string }) => <Icon {...p} d="M3 5.5h14v9H3zM3.5 6l6.5 5 6.5-5" />;
export const IconBell = (p: { className?: string }) => <Icon {...p} d="M5 13.5V9a5 5 0 0 1 10 0v4.5l1.5 1.5h-13zM8.5 17h3" />;
export const IconAlert = (p: { className?: string }) => <Icon {...p} d="M10 3 2.5 16.5h15zM10 8.5v3.5M10 14.4v.1" />;
export const IconSearch = (p: { className?: string }) => <Icon {...p} d="M8.5 14a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM12.5 12.5 17 17" />;
export const IconClose = (p: { className?: string }) => <Icon {...p} d="M5 5l10 10M15 5 5 15" />;
export const IconCheck = (p: { className?: string }) => <Icon {...p} d="M4 10.5 8 14.5 16 5.5" />;
export const IconArrow = (p: { className?: string }) => <Icon {...p} d="M4 10h12M11 5l5 5-5 5" />;
export const IconShield = (p: { className?: string }) => <Icon {...p} d="M10 2.5 4 5v4.5c0 4 2.6 6.6 6 8 3.4-1.4 6-4 6-8V5zM7.5 10l2 2 3.5-4" />;

// ---------------- day grid: dates measured on one strict grid ----------------

type Range = { startDate: string; endDate: string };

/** 4 weeks from this Monday. Tap a start day, then an end day. Booked days can't be picked or spanned. */
export function DayGrid({
  category,
  booked,
  start,
  end,
  onChange,
  weeks = 4,
}: {
  category: string;
  booked: Range[];
  start: string | null;
  end: string | null;
  onChange: (start: string | null, end: string | null) => void;
  weeks?: number;
}) {
  const today = todayIso();
  const days = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
    return Array.from({ length: weeks * 7 }, (_, i) => {
      const x = new Date(d);
      x.setDate(d.getDate() + i);
      return isoDay(x);
    });
  }, [weeks]);
  const isBooked = (day: string) => booked.some((b) => day >= b.startDate && day <= b.endDate);
  const spansBooked = (a: string, b: string) => booked.some((r) => !(r.endDate < a || r.startDate > b));

  function pick(day: string) {
    if (!start || end || day < start) return onChange(day, null);
    if (spansBooked(start, day)) return onChange(day, null);
    onChange(start, day);
  }

  return (
    <div data-family={family(category)}>
      <div className="grid grid-cols-7 gap-1 text-center">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <span key={d} className="code pb-1 text-ink-soft">{d}</span>
        ))}
        {days.map((day) => {
          const past = day < today;
          const taken = isBooked(day);
          const inRange = start && (end ? day >= start && day <= end : day === start);
          const n = parse(day).getDate();
          return (
            <button
              key={day}
              type="button"
              disabled={past || taken}
              onClick={() => pick(day)}
              aria-pressed={!!inRange}
              aria-label={`${fmtWeekday.format(parse(day))}${taken ? ", already booked" : ""}`}
              className={[
                "relative h-11 rounded-[2px] text-sm font-semibold transition-colors",
                inRange ? "bg-f1 text-stock" : taken ? "bg-f4 text-ink-soft line-through" : past ? "text-ink/30" : "bg-stock hover:bg-f4",
                day === today && !inRange ? "ring-2 ring-ink ring-inset" : "",
              ].join(" ")}
            >
              {taken && <span className="hatched absolute inset-0 opacity-60" aria-hidden />}
              <span className="relative">{n === 1 ? fmt.format(parse(day)) : n}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 flex items-center gap-3 text-xs text-ink-soft">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block size-3 rounded-[2px] bg-f1" /> Your days</span>
        <span className="inline-flex items-center gap-1.5"><span className="hatched inline-block size-3 rounded-[2px] bg-f4" /> Booked</span>
      </p>
    </div>
  );
}

// ---------------- toast ----------------

const ToastCtx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = useState<{ text: string; id: number } | null>(null);
  const show = useCallback((text: string) => {
    const id = Date.now();
    setMsg({ text, id });
    setTimeout(() => setMsg((m) => (m?.id === id ? null : m)), 3200);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex justify-center px-4">
        {msg && (
          <p key={msg.id} className="flex items-center gap-2 rounded-[3px] bg-ink px-4 py-3 text-sm font-semibold text-stock shadow-[0_10px_24px_-10px_rgb(0_0_0/.6)]" style={{ animation: "toast-in 260ms cubic-bezier(.16,1,.3,1)" }}>
            <IconCheck className="size-4" /> {msg.text}
          </p>
        )}
      </div>
    </ToastCtx.Provider>
  );
}
