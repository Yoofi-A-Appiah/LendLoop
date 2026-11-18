"use client";

import Link from "next/link";
import { SignInButton, SignedIn, SignedOut } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

export default function Home() {
  const tools = useQuery(api.tools.listPublic);

  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-4xl font-semibold tracking-tight">LendLoop</h1>
      <p className="mt-2 text-lg text-ink/70">Borrow what you need. Lend what you don&apos;t.</p>

      <div className="mt-6">
        <SignedOut>
          <SignInButton mode="modal" forceRedirectUrl="/dashboard">
            <button className="btn">Sign in to lend or borrow</button>
          </SignInButton>
        </SignedOut>
        <SignedIn>
          <Link href="/dashboard" className="btn inline-block">Go to your board →</Link>
        </SignedIn>
      </div>

      <h2 className="mt-12 mb-3 text-sm font-medium uppercase tracking-wide text-ink/60">Available in the neighborhood</h2>
      {tools === undefined ? (
        <p className="text-ink/60">Loading…</p>
      ) : tools.length === 0 ? (
        <p className="text-ink/60">No tools listed yet. Be the first.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {tools.map((t) => (
            <li key={t._id} className="card flex items-center justify-between">
              <span>{t.name}</span>
              <span className="pill">{t.category}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
