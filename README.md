# LendLoop

**Borrow what you need. Lend what you don't.**

LendLoop is a neighborhood tool-lending board. Neighbors list tools, request to borrow them for a date range, and approve or decline requests. n8n handles the notifications and the daily overdue reminders.

**Stack:** Next.js 15 (App Router), Clerk, Convex, n8n (self-hosted via Docker), TypeScript, Tailwind.

```
 Browser ──Clerk JWT──▶ Convex queries/mutations ── RBAC checks in every function
                              │ scheduler (on request create / status change)
                              ▼
                     internalAction n8n.notify ──HMAC-signed POST──▶ n8n "Request notification"
                              ▲                                      (verify → notify → {"ok":true})
                              │ records sent/failed on the loan
 n8n "Overdue reminders" ──HMAC-signed POST──▶ Convex HTTP /n8n/overdue-loans
   (daily 09:00)        ──HMAC-signed POST──▶ Convex HTTP /n8n/reminder-status (idempotent)
 n8n "Error handler"    ──HMAC-signed POST──▶ Convex HTTP /n8n/workflow-error  → admin view
```

## Project layout

| Path | What it does |
|---|---|
| `convex/schema.ts` | Tables: `users`, `tools`, `loans`, `automationEvents` |
| `convex/lib/auth.ts` | `requireUser` / `requireAdmin`, which every protected function calls |
| `convex/lib/hmac.ts` | One signing scheme for both directions, built on WebCrypto |
| `convex/tools.ts`, `convex/loans.ts`, `convex/users.ts` | All business rules and permission checks |
| `convex/n8n.ts` | Outbound signed webhook with retry and backoff |
| `convex/http.ts` | Inbound signed endpoints for n8n |
| `app/page.tsx` | Public page: tagline, read-only tool list, sign-in |
| `app/dashboard/page.tsx` | Signed-in app: Board, My listings, My requests, Incoming requests, Admin |
| `middleware.ts` | Clerk route protection for `/dashboard` |
| `n8n/workflows/*.json` | The three workflows, generated from `n8n/generate-workflows.mjs` |
| `n8n/docker-compose.yml`, `n8n/setup.sh` | Run n8n, import the workflows, wire the error workflow, activate |
| `tests/hmac.test.ts` | Checks the Convex signer against Node `crypto`, which n8n uses |

## Setup

### 1. App, Clerk and Convex

```bash
npm install
npx convex dev            # log in and create a deployment; writes NEXT_PUBLIC_CONVEX_URL to .env.local
```

1. In the Clerk dashboard, create an application and enable the **Convex integration**, or create a JWT template named `convex`. The preset includes the `name` and `email` claims LendLoop uses.
2. Add `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` to `.env.local` (see `.env.example`).
3. Set the Convex environment variables. They live in Convex, never in code.

```bash
npx convex env set CLERK_JWT_ISSUER_DOMAIN https://<your-app>.clerk.accounts.dev
npx convex env set LENDLOOP_TO_N8N_SECRET "$(openssl rand -hex 32)"   # Convex signs, n8n verifies
npx convex env set N8N_TO_LENDLOOP_SECRET "$(openssl rand -hex 32)"   # n8n signs, Convex verifies
npx convex env set N8N_REQUEST_WEBHOOK_URL https://<n8n-host>/webhook/lendloop-request
npm run dev
```

4. Sign in once, then make yourself an admin. `setRole` is an internal mutation, so only someone with deploy access can run it:

```bash
npx convex run users:setRole '{"email":"you@example.com","role":"admin"}'
```

### 2. n8n

```bash
cp n8n/.env.example n8n/.env   # fill in: same two secrets as Convex, plus CONVEX_SITE_URL (https://<deployment>.convex.site)
npm run n8n:up                 # docker compose up, then setup.sh imports, links the error workflow and activates
```

Convex runs in the cloud, so it needs a public URL to reach your n8n. Expose it with a tunnel, for example `cloudflared tunnel --url http://localhost:5678`, set `WEBHOOK_URL` in `n8n/.env`, and use that host in `N8N_REQUEST_WEBHOOK_URL`. n8n Cloud also works: set the same environment variables there.

The notifications are **mock notifications**. They log to stdout (`docker compose -f n8n/docker-compose.yml logs -f n8n`) and appear in each execution's output. To send real messages, replace the two "(mock)" Code nodes with an Email, Slack or Discord node that uses n8n credentials.

To trigger reminders on demand, open "LendLoop – Overdue reminders" in n8n and click **Run now**.

```bash
npm test   # HMAC sign/verify self-check
```

## Roles and access control

Permissions are enforced in Convex functions. The UI only hides buttons the user can't use. Every public query and mutation starts with `requireUser(ctx)` or `requireAdmin(ctx)`. These resolve the caller from the verified Clerk JWT (`tokenIdentifier`), never from client-supplied arguments, and then check the caller's relationship to the specific record.

| Action | Who | Where it's enforced |
|---|---|---|
| See tool names and categories | Anyone, signed out included | `tools.listPublic` returns only `name` and `category`. Owner fields never leave the server. |
| See the full board, owners and availability | Signed-in users | `tools.list` |
| Create a listing | Signed-in users | `tools.create`. The owner is always the caller. |
| Edit a listing | Owner only, including admins on their own listings | `tools.update` |
| Delete a listing | Owner or admin | `tools.remove`. Blocked while an approved loan is active. Pending requests are cancelled and the borrowers notified. |
| Request to borrow | Signed-in users, not on their own tool | `loans.request`. Validates dates and rejects overlaps with approved loans. |
| Approve or decline | The tool's owner, on pending requests only | `loans.decide`. Re-checks for overlaps on approve. |
| Withdraw a request | The borrower, on pending requests only | `loans.cancel` |
| Mark returned | The tool's owner, on approved loans only | `loans.markReturned` |
| View all loans and users, set Trusted Lender | Admin | `loans.all`, `users.list`, `users.setTrusted` |
| Grant the admin role | Deployment operator only | `users.setRole` is an internal mutation and can't be called from the client |

Other decisions:
- **Roles live in the Convex `users` table, not in Clerk metadata.** The authorization data then sits next to the data it protects. `users.store`, which the client calls after sign-in, can create a profile or refresh the name and email, but can never change `role` or `trusted`.
- **Admins can remove any listing but not edit it.** Editing someone else's listing was not in the brief, and leaving it out keeps the admin's power to moderation.
- **Status transitions are explicit:** pending to approved, declined or cancelled, and approved to returned. Acting on a loan in the wrong state returns a clear error.
- Inputs are validated at the boundary: lengths, `YYYY-MM-DD` dates, start no earlier than today, end no earlier than start, and category against a fixed list.

## n8n integration

### Workflows

1. **LendLoop – Request notification.** Webhook, then *Verify signature*, then a check. A valid request goes to *Send notification (mock)* and then *Respond 200* `{"ok":true}`. An invalid one gets *Respond 401*.
   - Convex fires it on `request.created`, `request.approved`, `request.declined`, `request.cancelled` and `loan.returned`.
   - The payload carries only what a notification needs: `eventId`, `event`, `loanId`, one recipient's `name` and `email`, `toolName`, the dates and the status. It never includes the other party's details, user ids or internal fields.
2. **LendLoop – Overdue reminders.** A daily 09:00 schedule (or *Run now*) runs: sign, then `POST /n8n/overdue-loans`, then split into one item per loan, then send the reminder, then sign, then `POST /n8n/reminder-status`.
3. **LendLoop – Error handler.** An Error Trigger logs the failure and posts it, signed, to `POST /n8n/workflow-error`. Failures then appear under **Admin → Automation failures** in the app. `setup.sh` sets this as the `errorWorkflow` of the other two.

### Signing in both directions

Every request carries `x-lendloop-signature: t=<unix>,v1=hex(HMAC_SHA256(secret, "<t>.<raw body>"))`. This is the same scheme Stripe uses.
- **Separate secrets per direction.** If n8n leaks, an attacker still can't forge Convex-to-n8n events, and the reverse also holds.
- **Replay window of 5 minutes** on the timestamp.
- **Constant-time comparison:** `crypto.subtle.verify` in Convex and `timingSafeEqual` in n8n.
- The Convex HTTP endpoints verify the raw body before parsing it. They also check that `loanId` is a real loan id and that the idempotency key belongs to that loan.
- **No secrets in code or in exported workflow JSON.** Convex reads them from `process.env`, set with `npx convex env set`. n8n reads them from container environment variables (`$env.*`) supplied by the gitignored `n8n/.env`. The n8n credential store is encrypted with `N8N_ENCRYPTION_KEY`, and a real email or Slack node would use it. A `grep` of `n8n/workflows/` finds only the variable *names*.

### Idempotency

- **Reminders.** Each reminder has the key `reminder:<loanId>:<YYYY-MM-DD>`. `recordEvent` upserts on that key, so a retried write-back updates the same row and returns `duplicate: true`. A success is never downgraded to a failure. `/n8n/overdue-loans` also leaves out loans already reminded today, so a re-run or retry of the workflow sends no second reminder.
- **Notifications.** Convex sends a stable `eventId` (`<loanId>:<event>`). n8n records delivered ids in workflow static data and acknowledges duplicates without re-sending. Convex records the notification under the key `notify:<loanId>:<event>`.

### Retries and failure visibility

- **Convex to n8n.** The notifier is a scheduled action, so it never slows down the user's mutation. It retries up to 5 times with exponential backoff (30s, 1m, 2m, 4m).
  - Delivery counts only when n8n replies with `{"ok":true}`. This matters: n8n returns an empty 200 if a workflow crashes before its Respond node.
  - After the last attempt, the failure is recorded on the loan and shows in red in the app.
  - A missing webhook configuration is also recorded as a failure instead of being skipped silently.
- **n8n to Convex.** Every HTTP node retries 3 times, 5 seconds apart. If retries run out, the run fails and the Error handler reports it to Convex. Failed executions are kept in n8n (`saveDataErrorExecution: all`) and logged to stdout.
- **One bad reminder doesn't stop the batch.** A send failure for one borrower is written back as `status: "failed"` for that loan, and the other reminders still go out.

### Automation activity in the app (bonus)

Each loan card shows its latest automation events, for example "⏰ Overdue reminder sent (3d late), 2 days ago" or "✉️ Notified Alice (request.created), 5 minutes ago". Failures appear in red. Admins also get a feed of recent automation failures.

## What was verified

These checks ran against a local Convex backend and n8n 1.114.4 in Docker:
- **RBAC, exercised as different users through `npx convex run --identity`.** Each of these was rejected by the right check:
  - non-owner edit
  - borrowing your own tool
  - past dates
  - borrower approving their own request
  - overlapping booking
  - non-admin calling `loans.all` or `setTrusted`
  - deleting a tool that's out on loan
- **Convex HTTP endpoints.** Unsigned, stale (10 minutes old) and tampered requests return 401. A duplicate write-back returns `duplicate: true`, and the overdue list is empty once a loan has been reminded.
- **Full loop through n8n.**
  - A borrow request and an approval triggered signed webhooks. n8n verified them, logged the notifications, and Convex recorded "Notified Alice/Bob".
  - A forged call to n8n returned 401.
  - A signed but malformed event fired the error workflow, which recorded the failure in Convex.
  - The overdue workflow, run twice: the first run sent the reminder and wrote back `sent`, and the second run sent nothing.
- `npm test`, `tsc --noEmit`, `npm run lint` and `next build` all pass.

## Known limits and next steps

- **n8n notification dedupe has a narrow race.** Static data is saved when a run *finishes*, which is after the webhook has already responded. Two identical deliveries less than about a second apart could both send. Convex retries are at least 30 seconds apart, so this only matters for duplicates sent by hand. If it ever matters, move the dedupe to Convex or to a database node.
- **"Today" is UTC** for overdue checks and the minimum start date. A per-neighborhood timezone would be the upgrade.
- **The n8n side signs the re-serialized JSON body.** This matches because Convex signs `JSON.stringify` output, which round-trips byte for byte. For non-Convex senders, switch the Webhook node to raw-body mode.
- **Board queries load each tool's owner and loans separately,** which is fine at neighborhood scale. Add pagination and denormalized availability if listings grow into the thousands.
- **Reminders don't escalate.** A loan gets one reminder per day for as long as it's overdue, and there is no escalation to the lender or admin after N days.
