"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { CATEGORIES } from "@/convex/schema";
import {
  ago, chipCode, DayGrid, dateRange, daysBetween, family, IconAlert, IconArrow, IconBell, IconClose, IconMail,
  IconSearch, IconShield, shortDate, Swatch, todayIso, ToastProvider, useToast, Wordmark, type Stage,
} from "../_components/world";

type Category = (typeof CATEGORIES)[number];
type ToolView = FunctionReturnType<typeof api.tools.list>[number];
type LoanView = FunctionReturnType<typeof api.loans.mine>[number];
type View = "rack" | "requests" | "tools" | "admin";

// Server errors are the source of truth for permissions; show them as written.
function useRun() {
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, success?: string) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
      if (success) toast(success);
      return true;
    } catch (e) {
      setError(e instanceof ConvexError ? String(e.data) : "That didn't go through. Check your connection and try again.");
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { error, busy, run };
}

const ErrorText = ({ error }: { error: string | null }) =>
  error ? (
    <p role="alert" className="mt-3 flex items-start gap-2 text-sm font-semibold text-alarm">
      <IconAlert className="mt-0.5 size-4 flex-none" /> {error}
    </p>
  ) : null;

export default function Dashboard() {
  return (
    <ToastProvider>
      <App />
    </ToastProvider>
  );
}

function App() {
  const { isAuthenticated } = useConvexAuth();
  const store = useMutation(api.users.store);
  const me = useQuery(api.users.me, isAuthenticated ? {} : "skip");
  const incoming = useQuery(api.loans.incoming, me ? {} : "skip");
  const [view, setView] = useState<View>("rack");

  useEffect(() => {
    if (isAuthenticated) store();
  }, [isAuthenticated, store]);

  const waiting = incoming?.filter((l) => l.status === "pending").length ?? 0;
  const overdueLent = incoming?.filter((l) => l.overdue).length ?? 0;
  const nav: { id: View; label: string; count?: number }[] = [
    { id: "rack", label: "Rack" },
    { id: "requests", label: "Requests", count: waiting + overdueLent },
    { id: "tools", label: "My tools" },
    ...(me?.role === "admin" ? [{ id: "admin" as View, label: "Admin" }] : []),
  ];

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 bg-ink text-stock">
        <div className="mx-auto flex max-w-[84rem] items-center gap-6 px-4 sm:px-8">
          <Link href="/" className="py-3.5" aria-label="LendLoop home"><Wordmark /></Link>
          <nav aria-label="Sections" className="hidden h-full items-stretch gap-1 md:flex">
            {nav.map((n) => <NavItem key={n.id} item={n} active={view === n.id} onClick={() => setView(n.id)} />)}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            {me?.trusted && (
              <span className="hidden items-center gap-1.5 text-xs font-bold sm:inline-flex"><IconShield className="size-4" /> Trusted Lender</span>
            )}
            <UserButton />
          </div>
        </div>
        <nav aria-label="Sections" className="flex gap-1 overflow-x-auto px-2 md:hidden">
          {nav.map((n) => <NavItem key={n.id} item={n} active={view === n.id} onClick={() => setView(n.id)} />)}
        </nav>
      </header>

      <main className="mx-auto max-w-[84rem] px-4 py-8 sm:px-8 sm:py-10">
        {!me ? (
          <div className="space-y-4" aria-busy>
            <div className="skeleton h-12 w-64" />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton h-44" />)}
            </div>
          </div>
        ) : (
          <>
            {view === "rack" && <Rack me={me} waiting={waiting} overdueLent={overdueLent} goTo={setView} />}
            {view === "requests" && <Requests goTo={setView} />}
            {view === "tools" && <MyTools />}
            {view === "admin" && me.role === "admin" && <Admin />}
          </>
        )}
      </main>
    </div>
  );
}

function NavItem({ item, active, onClick }: { item: { label: string; count?: number }; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`relative flex flex-none items-center gap-2 px-3 py-3.5 text-sm font-bold transition-colors ${active ? "text-stock" : "text-stock/65 hover:text-stock"}`}
    >
      {item.label}
      {!!item.count && (
        <span className="grid min-w-5 place-items-center rounded-[2px] bg-stock px-1 text-xs font-extrabold text-ink" aria-label={`${item.count} need attention`}>
          {item.count}
        </span>
      )}
      {active && <span data-family="power" className="absolute inset-x-3 bottom-0 h-1 rounded-t-[1px] bg-f2" aria-hidden />}
    </button>
  );
}

function PageTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <h1 className="display text-[2.5rem] sm:text-[3.25rem]">{children}</h1>
      {action}
    </div>
  );
}

// ---------------- Rack ----------------

function Rack({ me, waiting, overdueLent, goTo }: { me: Doc<"users">; waiting: number; overdueLent: number; goTo: (v: View) => void }) {
  const tools = useQuery(api.tools.list, {});
  const [query, setQuery] = useState("");
  const [cats, setCats] = useState<Category[]>([]);
  const [availableOnly, setAvailableOnly] = useState(false);
  const [openId, setOpenId] = useState<Id<"tools"> | null>(null);

  const q = query.trim().toLowerCase();
  const shown = (tools ?? []).filter(
    (t) =>
      (!cats.length || cats.includes(t.category)) &&
      (!availableOnly || (!t.onLoanUntil && !t.isMine)) &&
      (!q || `${t.name} ${t.description} ${t.ownerName}`.toLowerCase().includes(q)),
  );
  const open = tools?.find((t) => t._id === openId) ?? null;
  const filtered = !!(q || cats.length || availableOnly);

  return (
    <>
      {(waiting > 0 || overdueLent > 0) && (
        <button onClick={() => goTo("requests")} className="mb-8 flex w-full items-center gap-4 rounded-[3px] bg-stock p-4 text-left shadow-[0_10px_24px_-18px_rgb(0_0_0/.5)] hover:shadow-[0_14px_28px_-16px_rgb(0_0_0/.5)] sm:p-5">
          <IconBell className="size-6 flex-none" />
          <span className="flex-1">
            <span className="block font-extrabold">
              {waiting > 0 && `${waiting} ${waiting === 1 ? "neighbor is" : "neighbors are"} waiting for your answer`}
              {waiting > 0 && overdueLent > 0 && " · "}
              {overdueLent > 0 && `${overdueLent} of your tools ${overdueLent === 1 ? "is" : "are"} overdue`}
            </span>
            <span className="text-sm text-ink-soft">Answer quickly and people keep borrowing from you.</span>
          </span>
          <IconArrow className="size-5 flex-none" />
        </button>
      )}

      <PageTitle>The rack</PageTitle>

      <div className="mb-6 space-y-4">
        <label className="relative block max-w-md">
          <span className="sr-only">Search tools</span>
          <IconSearch className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-soft" />
          <input className="input !mt-0 pl-9" placeholder="Search drills, tents, ladders…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by category">
          {CATEGORIES.map((c) => {
            const on = cats.includes(c);
            return (
              <button
                key={c}
                data-family={family(c)}
                aria-pressed={on}
                onClick={() => setCats(on ? cats.filter((x) => x !== c) : [...cats, c])}
                className={`flex items-center gap-2 rounded-[3px] py-1.5 pr-3 pl-1.5 text-sm font-semibold transition-colors ${on ? "bg-f1 text-stock" : "bg-stock text-ink hover:bg-f4"}`}
              >
                <span className={`size-4 rounded-[2px] ${on ? "bg-stock/90" : "bg-f1"}`} aria-hidden />
                {c}
              </button>
            );
          })}
          <label className="ml-1 flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" className="size-4 accent-[var(--ink)]" checked={availableOnly} onChange={(e) => setAvailableOnly(e.target.checked)} />
            Available to borrow
          </label>
        </div>
      </div>

      {tools === undefined ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton h-44" />)}</div>
      ) : tools.length === 0 ? (
        <Empty title="The rack is empty" body="Nobody has listed a tool yet. Be the first, and your neighbors will see it here.">
          <button className="tab-btn" onClick={() => goTo("tools")}>List a tool</button>
        </Empty>
      ) : shown.length === 0 ? (
        <Empty title="Nothing matches" body={filtered ? "Try another word or clear the filters." : ""}>
          <button className="ghost-btn" onClick={() => { setQuery(""); setCats([]); setAvailableOnly(false); }}>Clear filters</button>
        </Empty>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {shown.map((t) => (
            <li key={t._id}><ToolChip tool={t} onOpen={() => setOpenId(t._id)} /></li>
          ))}
        </ul>
      )}

      <ToolSheet tool={open} isAdmin={me.role === "admin"} onClose={() => setOpenId(null)} goTo={goTo} />
    </>
  );
}

function ToolChip({ tool, onOpen }: { tool: ToolView; onOpen: () => void }) {
  const out = !!tool.onLoanUntil;
  return (
    <button
      onClick={onOpen}
      data-family={family(tool.category)}
      className="group block w-full overflow-hidden rounded-[3px] bg-stock text-left shadow-[0_10px_24px_-20px_rgb(0_0_0/.6)] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_28px_-18px_rgb(0_0_0/.55)]"
    >
      <span className="relative flex h-16 items-end justify-between bg-f1 px-3 pb-2 text-stock">
        {out && <span className="hatched absolute inset-0" aria-hidden />}
        <span className="code relative">{chipCode(tool._id)}</span>
        <span className="code relative opacity-85">{tool.category}</span>
      </span>
      <span className="block p-3">
        <span className="line-clamp-2 block font-extrabold leading-snug">{tool.name}</span>
        <span className="mt-1 flex items-center gap-1 text-xs text-ink-soft">
          {tool.condition} · {tool.isMine ? "yours" : tool.ownerName}
          {tool.ownerTrusted && <IconShield className="size-3.5 text-ink" />}
        </span>
        <span className={`mt-3 block text-xs font-bold ${out ? "text-ink-soft" : "text-f0"}`}>
          {tool.isMine ? "Your listing" : out ? `Out until ${shortDate(tool.onLoanUntil!)}` : "Available"}
        </span>
      </span>
    </button>
  );
}

/** Side sheet on desktop, bottom sheet on phones. Native <dialog> handles focus and Esc. */
function ToolSheet({ tool, isAdmin, onClose, goTo }: { tool: ToolView | null; isAdmin: boolean; onClose: () => void; goTo: (v: View) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (tool && !d.open) d.showModal();
    if (!tool && d.open) d.close();
  }, [tool]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-y-auto rounded-t-[6px] bg-stock p-0 text-ink backdrop:bg-ink/45 sm:mr-0 sm:ml-auto sm:h-dvh sm:max-h-none sm:w-[30rem] sm:rounded-none"
    >
      {tool && <SheetBody key={tool._id} tool={tool} isAdmin={isAdmin} onClose={onClose} goTo={goTo} />}
    </dialog>
  );
}

function SheetBody({ tool, isAdmin, onClose, goTo }: { tool: ToolView; isAdmin: boolean; onClose: () => void; goTo: (v: View) => void }) {
  const request = useMutation(api.loans.request);
  const remove = useMutation(api.tools.remove);
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const { error, busy, run } = useRun();
  const days = start && end ? daysBetween(start, end) + 1 : 0;

  return (
    <div data-family={family(tool.category)}>
      <div className="relative bg-f1 px-5 pt-4 pb-5 text-stock sm:px-6">
        {tool.onLoanUntil && <span className="hatched absolute inset-0" aria-hidden />}
        <div className="relative flex items-start justify-between">
          <span className="code">{chipCode(tool._id)} · {tool.category}</span>
          <button onClick={onClose} className="-mt-1 -mr-2 rounded-[3px] p-2 hover:bg-stock/15" aria-label="Close"><IconClose className="size-5" /></button>
        </div>
        <h2 className="display relative mt-6 text-[2.25rem]">{tool.name}</h2>
      </div>

      <div className="space-y-6 px-5 py-6 sm:px-6">
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div><dt className="code text-ink-soft">Condition</dt><dd className="mt-1 font-semibold">{tool.condition}</dd></div>
          <div>
            <dt className="code text-ink-soft">Lender</dt>
            <dd className="mt-1 flex items-center gap-1.5 font-semibold">
              {tool.isMine ? "You" : tool.ownerName}
              {tool.ownerTrusted && <span className="inline-flex items-center gap-1 text-xs"><IconShield className="size-3.5" /> Trusted</span>}
            </dd>
          </div>
        </dl>
        {tool.description && <p className="leading-relaxed">{tool.description}</p>}

        {tool.isMine ? (
          <div className="rounded-[3px] bg-f4 p-4 text-sm">
            This is your listing.{" "}
            <button className="font-bold underline" onClick={() => { onClose(); goTo("tools"); }}>Edit it in My tools</button>
          </div>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!start || !end) return;
              if (await run(() => request({ toolId: tool._id, startDate: start, endDate: end }), `Request sent to ${tool.ownerName}`)) onClose();
            }}
          >
            <h3 className="mb-3 font-extrabold">Pick your days</h3>
            <DayGrid category={tool.category} booked={tool.booked} start={start} end={end} onChange={(s, e) => { setStart(s); setEnd(e); }} />
            <p className="mt-4 min-h-6 text-sm font-semibold" aria-live="polite">
              {!start ? "Tap the first day you need it." : !end ? `From ${shortDate(start)}. Now tap the day you'll bring it back (or the same day again).` : `${dateRange(start, end)} · ${days} ${days === 1 ? "day" : "days"}`}
            </p>
            <button className="tab-btn mt-4 w-full justify-center sm:w-auto" disabled={!start || !end || busy}>
              {busy ? "Sending…" : "Request these days"}
            </button>
            <p className="mt-3 text-xs text-ink-soft">{tool.ownerName} gets a notification. Once they approve, you&apos;ll both see each other&apos;s email to arrange pick-up.</p>
            <ErrorText error={error} />
          </form>
        )}

        {isAdmin && !tool.isMine && (
          <div className="border-t border-rule pt-5">
            <ConfirmButton label="Remove listing (admin)" confirm="Remove this listing for everyone?" onConfirm={() => run(() => remove({ toolId: tool._id }), "Listing removed").then((ok) => ok && onClose())} />
          </div>
        )}
      </div>
    </div>
  );
}

function ConfirmButton({ label, confirm, onConfirm }: { label: string; confirm: string; onConfirm: () => void }) {
  const [asking, setAsking] = useState(false);
  if (!asking) return <button type="button" className="ghost-btn danger" onClick={() => setAsking(true)}>{label}</button>;
  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-sm font-semibold">
      {confirm}
      <button type="button" className="ghost-btn danger" onClick={() => { setAsking(false); onConfirm(); }}>Yes, remove</button>
      <button type="button" className="ghost-btn" onClick={() => setAsking(false)}>Keep it</button>
    </span>
  );
}

function Empty({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-[3px] border border-dashed border-ink/25 bg-stock/60 px-6 py-12 text-center">
      <p className="text-xl font-extrabold">{title}</p>
      {body && <p className="mx-auto mt-2 max-w-sm text-ink-soft">{body}</p>}
      {children && <div className="mt-5">{children}</div>}
    </div>
  );
}

// ---------------- Requests ----------------

function stageOf(l: LoanView): Stage {
  if (l.status === "pending") return "pending";
  if (l.status === "approved") return l.overdue ? "overdue" : l.startDate <= todayIso() ? "out" : "booked";
  if (l.status === "returned") return "returned";
  return "closed";
}

function statusText(l: LoanView, as: "owner" | "borrower" | "admin") {
  const late = daysBetween(l.endDate, todayIso());
  switch (stageOf(l)) {
    case "pending": return as === "owner" ? "Needs your answer" : as === "borrower" ? `Waiting for ${l.ownerName}` : "Pending";
    case "booked": return as === "borrower" ? `Approved · pick up from ${shortDate(l.startDate)}` : `Booked from ${shortDate(l.startDate)}`;
    case "out": return as === "borrower" ? `Due back ${shortDate(l.endDate)}` : `Out until ${shortDate(l.endDate)}`;
    case "overdue": return `Overdue by ${late} ${late === 1 ? "day" : "days"}${as === "borrower" ? ". Please return it" : ""}`;
    case "returned": return "Returned";
    default: return l.status === "declined" ? (as === "owner" ? "You declined" : "Declined") : as === "borrower" ? "You withdrew this" : "Withdrawn";
  }
}

function LoanRow({ loan, as, children }: { loan: LoanView; as: "owner" | "borrower" | "admin"; children?: React.ReactNode }) {
  const stage = stageOf(loan);
  const who = as === "owner" ? loan.borrowerName : as === "borrower" ? `from ${loan.ownerName}` : `${loan.borrowerName} borrowing from ${loan.ownerName}`;
  const days = daysBetween(loan.startDate, loan.endDate) + 1;
  return (
    <li className="flex flex-col gap-4 bg-stock p-4 sm:flex-row sm:items-start sm:p-5">
      <div className="flex flex-1 gap-4">
        <Swatch category={loan.category} stage={stage} label={statusText(loan, as)} />
        <div className="min-w-0 flex-1">
          <p className="font-extrabold">{loan.toolName}</p>
          <p className="text-sm text-ink-soft">{who} · {dateRange(loan.startDate, loan.endDate)} · {days} {days === 1 ? "day" : "days"}</p>
          <p className={`mt-1 text-sm font-bold ${stage === "overdue" ? "text-alarm" : ""}`}>{statusText(loan, as)}</p>
          {loan.contactEmail && (
            <a href={`mailto:${loan.contactEmail}?subject=${encodeURIComponent(`LendLoop: ${loan.toolName}`)}`} className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold underline">
              <IconMail className="size-4" /> {loan.contactEmail}
            </a>
          )}
          {loan.activity.length > 0 && (
            <ul className="mt-3 space-y-1 border-t border-dashed border-rule pt-2 text-xs text-ink-soft" aria-label="Automation activity">
              {loan.activity.map((a, i) => (
                <li key={i} className={`flex items-center gap-1.5 ${a.status === "failed" ? "font-semibold text-alarm" : ""}`}>
                  {a.status === "failed" ? <IconAlert className="size-3.5" /> : a.kind === "reminder" ? <IconBell className="size-3.5" /> : <IconMail className="size-3.5" />}
                  {a.detail}, {ago(a.at)}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {children && <div className="flex flex-wrap gap-2 sm:justify-end">{children}</div>}
    </li>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="mb-3 flex items-baseline gap-2 text-lg font-extrabold">
        {title} {count !== undefined && <span className="text-sm font-semibold text-ink-soft">{count}</span>}
      </h2>
      {children}
    </section>
  );
}

const List = ({ children }: { children: React.ReactNode }) => (
  <ul className="divide-y divide-rule overflow-hidden rounded-[3px] shadow-[0_10px_24px_-20px_rgb(0_0_0/.6)]">{children}</ul>
);

function Requests({ goTo }: { goTo: (v: View) => void }) {
  const incoming = useQuery(api.loans.incoming);
  const mine = useQuery(api.loans.mine);
  const decide = useMutation(api.loans.decide);
  const markReturned = useMutation(api.loans.markReturned);
  const cancel = useMutation(api.loans.cancel);
  const { error, busy, run } = useRun();

  if (!incoming || !mine) return <div className="space-y-3"><div className="skeleton h-12 w-64" /><div className="skeleton h-28" /><div className="skeleton h-28" /></div>;

  const waiting = incoming.filter((l) => l.status === "pending");
  const lentOut = incoming.filter((l) => l.status === "approved").sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.endDate.localeCompare(b.endDate));
  const borrowing = mine.filter((l) => l.status === "pending" || l.status === "approved").sort((a, b) => Number(b.overdue) - Number(a.overdue));
  const history = [...incoming.map((l) => ({ l: l, as: "owner" as const })), ...mine.map((l) => ({ l: l, as: "borrower" as const }))]
    .filter(({ l }) => ["returned", "declined", "cancelled"].includes(l.status))
    .sort((a, b) => b.l._creationTime - a.l._creationTime);

  if (!incoming.length && !mine.length)
    return (
      <>
        <PageTitle>Requests</PageTitle>
        <Empty title="No requests yet" body="When you ask to borrow something, or a neighbor asks for one of your tools, it shows up here.">
          <button className="tab-btn" onClick={() => goTo("rack")}>Browse the rack</button>
        </Empty>
      </>
    );

  return (
    <>
      <PageTitle>Requests</PageTitle>
      <ErrorText error={error} />

      {waiting.length > 0 && (
        <Section title="Waiting for your answer" count={waiting.length}>
          <List>
            {waiting.map((l) => (
              <LoanRow key={l._id} loan={l} as="owner">
                <button className="tab-btn small" disabled={busy} onClick={() => run(() => decide({ loanId: l._id, approve: true }), `Approved. ${l.borrowerName} has been told`)}>Approve</button>
                <button className="ghost-btn" disabled={busy} onClick={() => run(() => decide({ loanId: l._id, approve: false }), "Declined")}>Decline</button>
              </LoanRow>
            ))}
          </List>
        </Section>
      )}

      {lentOut.length > 0 && (
        <Section title="Lent out" count={lentOut.length}>
          <List>
            {lentOut.map((l) => (
              <LoanRow key={l._id} loan={l} as="owner">
                <button className="tab-btn small" disabled={busy} onClick={() => run(() => markReturned({ loanId: l._id }), "Marked as returned")}>It&apos;s back</button>
              </LoanRow>
            ))}
          </List>
        </Section>
      )}

      {borrowing.length > 0 && (
        <Section title="Your borrowing" count={borrowing.length}>
          <List>
            {borrowing.map((l) => (
              <LoanRow key={l._id} loan={l} as="borrower">
                {l.status === "pending" && <button className="ghost-btn" disabled={busy} onClick={() => run(() => cancel({ loanId: l._id }), "Request withdrawn")}>Withdraw</button>}
              </LoanRow>
            ))}
          </List>
        </Section>
      )}

      {history.length > 0 && (
        <details className="group">
          <summary className="mb-3 flex cursor-pointer list-none items-center gap-2 text-lg font-extrabold">
            <IconArrow className="size-4 transition-transform group-open:rotate-90" /> History <span className="text-sm font-semibold text-ink-soft">{history.length}</span>
          </summary>
          <List>{history.map(({ l, as }) => <LoanRow key={l._id} loan={l} as={as} />)}</List>
        </details>
      )}
    </>
  );
}

// ---------------- My tools ----------------

const CONDITIONS = ["Like new", "Good", "Fair", "Well used"];

function MyTools() {
  const tools = useQuery(api.tools.mine);
  const [editing, setEditing] = useState<Doc<"tools"> | null>(null);
  return (
    <>
      <PageTitle>My tools</PageTitle>
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <ToolForm key={editing?._id ?? "new"} tool={editing} onDone={() => setEditing(null)} />
        {tools === undefined ? (
          <div className="space-y-2"><div className="skeleton h-20" /><div className="skeleton h-20" /></div>
        ) : tools.length === 0 ? (
          <Empty title="Nothing listed yet" body="Your first listing takes a minute. The drill in the shed counts." />
        ) : (
          <List>
            {tools.map((t) => <ListingRow key={t._id} tool={t} editing={editing?._id === t._id} onEdit={() => setEditing(t)} />)}
          </List>
        )}
      </div>
    </>
  );
}

function ListingRow({ tool, editing, onEdit }: { tool: Doc<"tools">; editing: boolean; onEdit: () => void }) {
  const remove = useMutation(api.tools.remove);
  const { error, run } = useRun();
  return (
    <li className={`bg-stock p-4 sm:p-5 ${editing ? "outline-2 outline-ink -outline-offset-2" : ""}`}>
      <div className="flex flex-wrap items-center gap-4">
        <Swatch category={tool.category} />
        <div className="min-w-0 flex-1">
          <p className="font-extrabold">{tool.name}</p>
          <p className="text-sm text-ink-soft">{tool.category} · {tool.condition}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="ghost-btn" onClick={onEdit}>Edit</button>
          <ConfirmButton label="Delete" confirm="Delete this listing?" onConfirm={() => run(() => remove({ toolId: tool._id }), "Listing deleted")} />
        </div>
      </div>
      <ErrorText error={error} />
    </li>
  );
}

function ToolForm({ tool, onDone }: { tool: Doc<"tools"> | null; onDone: () => void }) {
  const create = useMutation(api.tools.create);
  const update = useMutation(api.tools.update);
  const blank = { name: "", category: "power tools" as Category, condition: "Good", description: "" };
  const [f, setF] = useState(tool ? { name: tool.name, category: tool.category, condition: tool.condition, description: tool.description } : blank);
  const { error, busy, run } = useRun();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <form
      data-family={family(f.category)}
      className="overflow-hidden rounded-[3px] bg-stock shadow-[0_10px_24px_-20px_rgb(0_0_0/.6)]"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await run(() => (tool ? update({ toolId: tool._id, ...f }) : create(f)), tool ? "Changes saved" : `${f.name} is on the rack`);
        if (ok) { if (!tool) setF(blank); onDone(); }
      }}
    >
      <div className="bg-f1 px-5 py-4 text-stock transition-colors">
        <p className="code">{tool ? chipCode(tool._id) : "New chip"} · {f.category}</p>
        <p className="mt-2 truncate text-xl font-extrabold">{f.name || (tool ? "Edit listing" : "List a tool")}</p>
      </div>
      <div className="space-y-4 p-5">
        <label className="field">Name<input required maxLength={80} className="input" placeholder="Cordless drill" value={f.name} onChange={set("name")} /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="field">Category
            <select className="input" value={f.category} onChange={set("category")}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
          </label>
          <label className="field">Condition
            <select className="input" value={f.condition} onChange={set("condition")}>{CONDITIONS.map((c) => <option key={c}>{c}</option>)}</select>
          </label>
        </div>
        <label className="field">Short description <span className="font-normal text-ink-soft">(optional)</span>
          <textarea maxLength={500} rows={3} className="input" placeholder="18V, two batteries, comes with a bit set." value={f.description} onChange={set("description")} />
        </label>
        <div className="flex flex-wrap gap-2">
          <button className="tab-btn" disabled={busy}>{busy ? "Saving…" : tool ? "Save changes" : "Put it on the rack"}</button>
          {tool && <button type="button" className="ghost-btn" onClick={onDone}>Cancel</button>}
        </div>
        <ErrorText error={error} />
      </div>
    </form>
  );
}

// ---------------- Admin ----------------

function Admin() {
  const loans = useQuery(api.loans.all);
  const users = useQuery(api.users.list);
  const failures = useQuery(api.loans.automationFailures);
  const setTrusted = useMutation(api.users.setTrusted);
  const { error, run } = useRun();
  return (
    <>
      <PageTitle>Admin</PageTitle>
      <ErrorText error={error} />

      {failures && failures.length > 0 && (
        <Section title="Automation failures" count={failures.length}>
          <ul className="divide-y divide-rule overflow-hidden rounded-[3px] bg-alarm-tint">
            {failures.map((f) => (
              <li key={f._id} className="flex items-start gap-3 p-4 text-sm">
                <IconAlert className="mt-0.5 size-4 flex-none text-alarm" />
                <span className="flex-1"><span className="font-bold">{f.kind.replace("_", " ")}</span> · {f.detail}</span>
                <span className="text-ink-soft">{ago(f.at)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Neighbors" count={users?.length}>
        <List>
          {users?.map((u) => (
            <li key={u._id} className="flex flex-wrap items-center gap-3 bg-stock p-4">
              <div className="min-w-0 flex-1">
                <p className="font-bold">{u.name} {u.role === "admin" && <span className="code ml-1 text-ink-soft">admin</span>}</p>
                <p className="truncate text-sm text-ink-soft">{u.email}</p>
              </div>
              <button
                aria-pressed={u.trusted}
                onClick={() => run(() => setTrusted({ userId: u._id, trusted: !u.trusted }), u.trusted ? `${u.name} is no longer a Trusted Lender` : `${u.name} is now a Trusted Lender`)}
                className={u.trusted ? "tab-btn small" : "ghost-btn"}
              >
                <IconShield className="size-4" /> {u.trusted ? "Trusted Lender" : "Mark as trusted"}
              </button>
            </li>
          ))}
        </List>
      </Section>

      <Section title="All loans" count={loans?.length}>
        {loans === undefined ? <div className="skeleton h-28" /> : loans.length === 0 ? (
          <Empty title="No loans yet" body="Loans appear here as soon as someone requests a tool." />
        ) : (
          <List>{loans.map((l) => <LoanRow key={l._id} loan={l} as="admin" />)}</List>
        )}
      </Section>
    </>
  );
}
