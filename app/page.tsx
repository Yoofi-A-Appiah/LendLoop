"use client";

import Link from "next/link";
import { Show, SignInButton } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { CATEGORIES } from "@/convex/schema";
import { chipCode, family, Wordmark } from "./_components/world";

const PER_STRIP = 5;
// Chip text: white on the two deep steps, ink on the light ones.
const STEP_BG = ["bg-f0 text-stock", "bg-f1 text-stock", "bg-f2 text-ink", "bg-f3 text-ink", "bg-f4 text-ink"];

function PrimaryAction({ className = "" }: { className?: string }) {
  return (
    <>
      <Show when="signed-out">
        <SignInButton mode="modal" forceRedirectUrl="/dashboard">
          <button className={`tab-btn ${className}`}>Sign in to lend or borrow</button>
        </SignInButton>
      </Show>
      <Show when="signed-in">
        <Link href="/dashboard" className={`tab-btn ${className}`}>Open your rack</Link>
      </Show>
    </>
  );
}

// Shown only while nobody has listed anything, and labelled as examples.
const EXAMPLES: Record<string, string[]> = {
  "power tools": ["Cordless drill", "Jigsaw", "Orbital sander", "Circular saw"],
  "hand tools": ["Socket set", "Spirit level", "Tile cutter"],
  garden: ["Hedge trimmer", "Wheelbarrow", "Loppers", "Leaf blower", "Lawn rake"],
  kitchen: ["Stand mixer", "Pasta machine"],
  camping: ["4-person tent", "Camp stove", "Cool box", "Lantern"],
  cleaning: ["Pressure washer", "Carpet cleaner", "Steam mop"],
  other: ["3m ladder", "Sack truck", "Gazebo"],
};

export default function Home() {
  const tools = useQuery(api.tools.listPublic);
  const examples = tools?.length === 0;
  const byCategory = CATEGORIES.map((c) => ({
    category: c,
    items: examples ? EXAMPLES[c].map((name) => ({ _id: `example-${name}`, name })) : (tools ?? []).filter((t) => t.category === c),
  }));
  // Fullest strips first so the rack leads with real tools.
  const strips = [...byCategory].sort((a, b) => b.items.length - a.items.length);

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-[84rem] items-center justify-between px-4 py-5 sm:px-8">
        <Wordmark />
        <Show when="signed-out">
          <SignInButton mode="modal" forceRedirectUrl="/dashboard">
            <button className="ghost-btn">Sign in</button>
          </SignInButton>
        </Show>
        <Show when="signed-in">
          <Link href="/dashboard" className="ghost-btn">Your rack</Link>
        </Show>
      </header>

      <main>
        <section className="mx-auto grid max-w-[84rem] grid-cols-[minmax(0,1fr)] items-center gap-10 px-4 pt-6 pb-16 sm:px-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:pt-10 lg:pb-24">
          <div className="max-w-xl">
            <h1 className="display text-[3.5rem] sm:text-[5rem] lg:text-[5.75rem]">
              Borrow what you need. Lend what you don&apos;t.
            </h1>
            <p className="mt-6 max-w-md text-lg leading-relaxed text-ink-soft">
              Every tool on your street, on one rack. Pick a tool, pick your days, pick it up from a neighbor. No money changes hands.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <PrimaryAction className="py-4 pr-6 text-base" />
              <p className="code text-ink-soft">
                {tools === undefined ? " " : tools.length === 1 ? "1 tool available now" : `${tools.length} tools available now`}
              </p>
            </div>
          </div>

          <div className="min-w-0">
            <Rack strips={strips} loading={tools === undefined} />
            {examples && <p className="mt-2 text-sm text-ink-soft lg:mt-8 lg:text-right">Example tools. Real listings replace them as neighbors add theirs.</p>}
          </div>
        </section>

        <section className="border-t border-rule bg-stock">
          <div className="mx-auto max-w-[84rem] px-4 py-16 sm:px-8 lg:py-20">
            <h2 className="display text-[2.5rem] sm:text-[3.25rem]">How the loop works</h2>
            <ol className="mt-10 grid gap-px overflow-hidden rounded-[3px] bg-rule md:grid-cols-3">
              {[
                ["List it", "Add the drill gathering dust in your shed. Name, category, condition, a line about it."],
                ["Book the days", "Neighbors pick dates on the tool's calendar. You approve or decline, and once you approve you both see each other's email to sort out pick-up."],
                ["Bring it back", "The lender marks it returned. Running late? LendLoop sends the reminder, so nobody has to chase."],
              ].map(([title, body], i) => (
                <li key={title} data-family={["hand", "camping", "garden"][i]} className="bg-stock p-6 sm:p-8">
                  <span className="block h-2 w-16 rounded-[1px] bg-f1" aria-hidden />
                  <h3 className="mt-5 text-xl font-extrabold">{title}</h3>
                  <p className="mt-2 max-w-[38ch] leading-relaxed text-ink-soft">{body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="bg-ink text-stock">
          <div className="mx-auto flex max-w-[84rem] flex-col items-start gap-6 px-4 py-14 sm:px-8 md:flex-row md:items-center md:justify-between">
            <p className="display text-[2.25rem] sm:text-[2.75rem]">Your street&apos;s shed, shared.</p>
            <PrimaryAction className="bg-stock py-4 pr-6 text-base !text-ink before:!bg-ink" />
          </div>
        </section>
      </main>
    </div>
  );
}

function Rack({ strips, loading }: { strips: { category: string; items: { _id: string; name: string }[] }[]; loading: boolean }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-6 sm:-mx-8 sm:px-8 lg:mx-0 lg:overflow-visible lg:px-0" aria-label="Tools on the rack, by category">
      <ul className="fan flex w-max gap-3 pt-2 lg:w-auto lg:justify-end lg:gap-3.5 lg:pt-12">
        {strips.map(({ category, items }, i) => (
          <li
            key={category}
            data-family={family(category)}
            style={{ "--i": i, "--r": `${(i - 3) * 1.6}deg`, "--y": `${i % 2 ? -1.75 : 0}rem` } as React.CSSProperties}
            className="strip w-[8.25rem] flex-none lg:w-auto lg:flex-1 lg:[transform:translateY(var(--y))_rotate(var(--r))]"
          >
            <p className="px-1.5 pt-1 pb-2 text-[0.6875rem] font-extrabold tracking-[0.12em] uppercase">{category}</p>
            <ul className="space-y-1">
              {Array.from({ length: PER_STRIP }, (_, step) => {
                const t = items[step];
                if (loading) return <li key={step} className="skeleton h-[4.5rem]" />;
                if (!t)
                  return (
                    <li key={step} className="flex h-[4.5rem] items-end rounded-[2px] border border-dashed border-f2 p-2 text-xs font-semibold text-ink-soft">
                      {step === items.length ? "Your tool here" : ""}
                    </li>
                  );
                return (
                  <li key={t._id} className={`flex h-[4.5rem] flex-col justify-end rounded-[2px] p-2 ${STEP_BG[step]}`}>
                    <span className="code opacity-80">{chipCode(t._id)}</span>
                    <span className="line-clamp-2 text-[0.8125rem] leading-tight font-bold">{t.name}</span>
                  </li>
                );
              })}
            </ul>
            {items.length > PER_STRIP && <p className="px-1.5 pt-2 pb-0.5 text-xs font-semibold text-ink-soft">+{items.length - PER_STRIP} more</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
