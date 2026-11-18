# Product

<!-- impeccable:product-schema 1 -->

## Platform

web — used on phones and desktops equally (confirmed); neither viewport is secondary.

## Users

Neighbors on the same street or block. Two roles in one person:
- **Borrower:** has a one-off job (hang a shelf, prune a hedge, a camping weekend) and needs a tool for a few days without buying it.
- **Lender:** owns tools that sit idle and is willing to lend them; must answer requests promptly and get tools back.
- **Admin:** a neighborhood organizer who moderates listings, sees all loans, and marks reliable lenders as "Trusted Lender".

## Product Purpose

LendLoop (fictional company) lets neighbors list tools, request them for a date range, approve or decline requests, and mark loans returned. Automation (n8n) notifies people when a request is created or changes, and sends daily reminders for overdue loans. Success: tools move between neighbors and come back on time without awkward chasing.

## Positioning

Tagline: "Borrow what you need. Lend what you don't." Not a marketplace — no money changes hands. The loop is trust between neighbors, kept honest by automatic reminders and a visible activity trail on every loan ("Reminder sent 2 days ago").

## Operating Context

- A request moves pending → approved / declined / cancelled; approved → returned. Overdue = approved and past its end date.
- Handoff: once a request is approved, borrower and lender see each other's email to arrange pick-up; no contact details are shown before approval (confirmed).
- Public visitors see only tool names and categories; owners, conditions and availability are for signed-in neighbors.
- Categories: power tools, hand tools, garden, kitchen, camping, cleaning, other.

## Capabilities and Constraints

- Stack: Next.js App Router, Clerk auth, Convex backend, n8n automations, Tailwind.
- Role-based access is enforced server-side in Convex; the UI must never be the only gate.
- No tool photos exist yet (no upload feature); any imagery is authored/illustrative.
- Open: search, messaging, and photo upload are not built.
