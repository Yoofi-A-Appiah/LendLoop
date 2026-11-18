"use client";

import { useEffect, useState } from "react";
import { UserButton } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { CATEGORIES } from "@/convex/schema";

type Category = (typeof CATEGORIES)[number];
type LoanView = FunctionReturnType<typeof api.loans.mine>[number];
const TABS = ["Board", "My listings", "My requests", "Incoming requests", "Admin"] as const;
type Tab = (typeof TABS)[number];

// Server errors are the source of truth for permissions; surface them as-is.
function useAction() {
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(e instanceof ConvexError ? String(e.data) : "Something went wrong. Please try again.");
      return false;
    }
  };
  return { error, run };
}

const ErrorText = ({ error }: { error: string | null }) =>
  error ? <p role="alert" className="mt-2 text-sm text-clay">{error}</p> : null;

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
function ago(ms: number) {
  const mins = Math.round((ms - Date.now()) / 60_000);
  if (Math.abs(mins) < 60) return rtf.format(mins, "minute");
  if (Math.abs(mins) < 1440) return rtf.format(Math.round(mins / 60), "hour");
  return rtf.format(Math.round(mins / 1440), "day");
}

export default function Dashboard() {
  const { isAuthenticated } = useConvexAuth();
  const store = useMutation(api.users.store);
  const me = useQuery(api.users.me, isAuthenticated ? {} : "skip");
  const [tab, setTab] = useState<Tab>("Board");

  useEffect(() => {
    if (isAuthenticated) store();
  }, [isAuthenticated, store]);

  if (!me) return <p className="p-8 text-ink/60">Loading…</p>;
  const tabs = TABS.filter((t) => t !== "Admin" || me.role === "admin");

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">LendLoop</h1>
          <p className="text-sm text-ink/60">
            Hi {me.name}
            {me.trusted && <span className="pill ml-2 bg-moss/10 text-moss">Trusted Lender</span>}
            {me.role === "admin" && <span className="pill ml-2">admin</span>}
          </p>
        </div>
        <UserButton />
      </header>

      <nav className="mt-6 flex flex-wrap gap-1 border-b border-black/10">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === t ? "border-moss font-medium" : "border-transparent text-ink/60"}`}
          >
            {t}
          </button>
        ))}
      </nav>

      <section className="mt-6">
        {tab === "Board" && <Board isAdmin={me.role === "admin"} />}
        {tab === "My listings" && <MyListings />}
        {tab === "My requests" && <MyRequests />}
        {tab === "Incoming requests" && <Incoming />}
        {tab === "Admin" && <Admin />}
      </section>
    </main>
  );
}

// ---------------- Board ----------------

function Board({ isAdmin }: { isAdmin: boolean }) {
  const [category, setCategory] = useState<Category | "">("");
  const tools = useQuery(api.tools.list, category ? { category } : {});
  const remove = useMutation(api.tools.remove);
  const { error, run } = useAction();

  return (
    <div>
      <label className="text-sm">
        Category{" "}
        <select className="input ml-2 inline-block w-auto" value={category} onChange={(e) => setCategory(e.target.value as Category | "")}>
          <option value="">All</option>
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
      </label>
      <ErrorText error={error} />
      {tools === undefined ? <p className="mt-4 text-ink/60">Loading…</p> : tools.length === 0 ? (
        <p className="mt-4 text-ink/60">Nothing here yet.</p>
      ) : (
        <ul className="mt-4 grid gap-3 md:grid-cols-2">
          {tools.map((t) => (
            <li key={t._id} className="card">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-medium">{t.name}</h3>
                  <p className="text-xs text-ink/60">
                    {t.category} · {t.condition} · by {t.isMine ? "you" : t.ownerName}
                    {t.ownerTrusted && <span className="ml-1 text-moss">✓ Trusted</span>}
                  </p>
                </div>
                <span className={`pill ${t.onLoanUntil ? "bg-clay/10 text-clay" : "bg-moss/10 text-moss"}`}>
                  {t.onLoanUntil ? `On loan until ${t.onLoanUntil}` : "Available"}
                </span>
              </div>
              {t.description && <p className="mt-2 text-sm text-ink/80">{t.description}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                {!t.isMine && <RequestForm toolId={t._id} />}
                {isAdmin && !t.isMine && (
                  <button className="btn-ghost text-clay" onClick={() => confirm(`Remove "${t.name}"?`) && run(() => remove({ toolId: t._id }))}>
                    Remove (admin)
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RequestForm({ toolId }: { toolId: Id<"tools"> }) {
  const request = useMutation(api.loans.request);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const { error, run } = useAction();

  if (done) return <p className="text-sm text-moss">Request sent. Track it under “My requests”.</p>;
  if (!open) return <button className="btn" onClick={() => setOpen(true)}>Request to borrow</button>;
  return (
    <form
      className="w-full"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await run(() => request({ toolId, startDate: start, endDate: end }))) setDone(true);
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs">From<input type="date" required min={today} className="input" value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label className="text-xs">To<input type="date" required min={start} className="input" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
        <button className="btn">Send</button>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      <ErrorText error={error} />
    </form>
  );
}

// ---------------- My listings ----------------

function MyListings() {
  const tools = useQuery(api.tools.mine);
  const [editing, setEditing] = useState<Doc<"tools"> | null>(null);
  return (
    <div className="grid gap-6 md:grid-cols-[1fr_1.3fr]">
      <ToolForm key={editing?._id ?? "new"} tool={editing} onDone={() => setEditing(null)} />
      <ul className="space-y-2">
        {tools?.length === 0 && <p className="text-ink/60">You haven&apos;t listed anything yet.</p>}
        {tools?.map((t) => <ListingRow key={t._id} tool={t} onEdit={() => setEditing(t)} />)}
      </ul>
    </div>
  );
}

function ListingRow({ tool, onEdit }: { tool: Doc<"tools">; onEdit: () => void }) {
  const remove = useMutation(api.tools.remove);
  const { error, run } = useAction();
  return (
    <li className="card">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="font-medium">{tool.name}</p>
          <p className="text-xs text-ink/60">{tool.category} · {tool.condition}</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={onEdit}>Edit</button>
          <button className="btn-ghost text-clay" onClick={() => confirm(`Delete "${tool.name}"?`) && run(() => remove({ toolId: tool._id }))}>Delete</button>
        </div>
      </div>
      <ErrorText error={error} />
    </li>
  );
}

function ToolForm({ tool, onDone }: { tool: Doc<"tools"> | null; onDone: () => void }) {
  const create = useMutation(api.tools.create);
  const update = useMutation(api.tools.update);
  const [f, setF] = useState({
    name: tool?.name ?? "",
    category: tool?.category ?? ("power tools" as Category),
    condition: tool?.condition ?? "Good",
    description: tool?.description ?? "",
  });
  const { error, run } = useAction();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.value });

  return (
    <form
      className="card space-y-3 self-start"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await run(() => (tool ? update({ toolId: tool._id, ...f }) : create(f)));
        if (ok) { if (!tool) setF({ ...f, name: "", description: "" }); onDone(); }
      }}
    >
      <h3 className="font-medium">{tool ? "Edit listing" : "List a tool"}</h3>
      <label className="block text-sm">Name<input required maxLength={80} className="input" value={f.name} onChange={set("name")} /></label>
      <label className="block text-sm">Category
        <select className="input" value={f.category} onChange={set("category")}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
      </label>
      <label className="block text-sm">Condition
        <select className="input" value={f.condition} onChange={set("condition")}>
          {["Like new", "Good", "Fair", "Well used"].map((c) => <option key={c}>{c}</option>)}
        </select>
      </label>
      <label className="block text-sm">Short description<textarea maxLength={500} rows={3} className="input" value={f.description} onChange={set("description")} /></label>
      <div className="flex gap-2">
        <button className="btn">{tool ? "Save" : "List tool"}</button>
        {tool && <button type="button" className="btn-ghost" onClick={onDone}>Cancel</button>}
      </div>
      <ErrorText error={error} />
    </form>
  );
}

// ---------------- Loans ----------------

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-moss/10 text-moss",
  returned: "bg-black/5",
  declined: "bg-clay/10 text-clay",
  cancelled: "bg-black/5 text-ink/50",
};

function LoanCard({ loan, perspective, children }: { loan: LoanView; perspective: "borrower" | "owner" | "admin"; children?: React.ReactNode }) {
  const who =
    perspective === "borrower" ? `from ${loan.ownerName}` :
    perspective === "owner" ? `requested by ${loan.borrowerName}` :
    `${loan.borrowerName} ← ${loan.ownerName}`;
  return (
    <li className="card">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium">{loan.toolName}</p>
          <p className="text-xs text-ink/60">{who} · {loan.startDate} → {loan.endDate}</p>
        </div>
        <span className={`pill ${loan.overdue ? "bg-clay text-white" : STATUS_STYLE[loan.status]}`}>{loan.overdue ? "overdue" : loan.status}</span>
      </div>
      {loan.activity.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-ink/60">
          {loan.activity.map((a, i) => (
            <li key={i} className={a.status === "failed" ? "text-clay" : ""}>
              {a.kind === "reminder" ? "⏰" : "✉️"} {a.detail}, {ago(a.at)}
            </li>
          ))}
        </ul>
      )}
      {children && <div className="mt-3 flex gap-2">{children}</div>}
    </li>
  );
}

function LoanList({ loans, empty, render }: { loans: LoanView[] | undefined; empty: string; render: (l: LoanView) => React.ReactNode }) {
  if (loans === undefined) return <p className="text-ink/60">Loading…</p>;
  if (loans.length === 0) return <p className="text-ink/60">{empty}</p>;
  return <ul className="grid gap-3 md:grid-cols-2">{loans.map(render)}</ul>;
}

function MyRequests() {
  const loans = useQuery(api.loans.mine);
  const cancel = useMutation(api.loans.cancel);
  const { error, run } = useAction();
  return (
    <>
      <ErrorText error={error} />
      <LoanList loans={loans} empty="You haven't requested anything yet." render={(l) => (
        <LoanCard key={l._id} loan={l} perspective="borrower">
          {l.status === "pending" && <button className="btn-ghost" onClick={() => run(() => cancel({ loanId: l._id }))}>Withdraw</button>}
        </LoanCard>
      )} />
    </>
  );
}

function Incoming() {
  const loans = useQuery(api.loans.incoming);
  const decide = useMutation(api.loans.decide);
  const markReturned = useMutation(api.loans.markReturned);
  const { error, run } = useAction();
  return (
    <>
      <ErrorText error={error} />
      <LoanList loans={loans} empty="No one has asked to borrow your tools yet." render={(l) => (
        <LoanCard key={l._id} loan={l} perspective="owner">
          {l.status === "pending" && (
            <>
              <button className="btn" onClick={() => run(() => decide({ loanId: l._id, approve: true }))}>Approve</button>
              <button className="btn-ghost" onClick={() => run(() => decide({ loanId: l._id, approve: false }))}>Decline</button>
            </>
          )}
          {l.status === "approved" && <button className="btn" onClick={() => run(() => markReturned({ loanId: l._id }))}>Mark returned</button>}
        </LoanCard>
      )} />
    </>
  );
}

// ---------------- Admin ----------------

function Admin() {
  const loans = useQuery(api.loans.all);
  const users = useQuery(api.users.list);
  const failures = useQuery(api.loans.automationFailures);
  const setTrusted = useMutation(api.users.setTrusted);
  const { error, run } = useAction();
  return (
    <div className="space-y-8">
      {failures && failures.length > 0 && (
        <div>
          <h2 className="mb-3 font-medium text-clay">Automation failures</h2>
          <ul className="card space-y-1 text-sm">
            {failures.map((f) => <li key={f._id}><span className="pill">{f.kind}</span> {f.detail} <span className="text-ink/50">· {ago(f.at)}</span></li>)}
          </ul>
        </div>
      )}
      <div>
        <h2 className="mb-3 font-medium">Lenders</h2>
        <ErrorText error={error} />
        <ul className="divide-y divide-black/5 card p-0">
          {users?.map((u) => (
            <li key={u._id} className="flex items-center justify-between px-4 py-2 text-sm">
              <span>{u.name} <span className="text-ink/50">{u.email}</span> {u.role === "admin" && <span className="pill">admin</span>}</span>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={u.trusted} onChange={(e) => run(() => setTrusted({ userId: u._id, trusted: e.target.checked }))} />
                Trusted Lender
              </label>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h2 className="mb-3 font-medium">All loans</h2>
        <LoanList loans={loans} empty="No loans yet." render={(l) => <LoanCard key={l._id} loan={l} perspective="admin" />} />
      </div>
    </div>
  );
}
