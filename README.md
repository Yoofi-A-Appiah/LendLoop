# LendLoop

**Borrow what you need. Lend what you don't.**

LendLoop is a neighborhood tool-lending board. Neighbors list tools, request to borrow them for a date range, and approve or decline requests. n8n handles the notifications and the daily overdue reminders.

**Stack:** Next.js 15 (App Router), Clerk 7, Convex, n8n 1.114 (self-hosted via Docker), TypeScript, Tailwind 4.

## Architecture

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

- **Convex is the only place business rules live.** The Next.js app is a client: it calls Convex queries and mutations with the user's Clerk token, and every function checks who is calling.
- **Convex calls n8n through a scheduled action, never inside the user's mutation.** The user's action commits immediately, and delivery, retries and failure recording happen in the background.
- **n8n calls Convex through three HTTP endpoints,** each verifying an HMAC signature before doing anything.

### Project layout

| Path | What it does |
|---|---|
| `convex/schema.ts` | Tables: `users`, `tools`, `loans`, `automationEvents` |
| `convex/lib/auth.ts` | `requireUser` / `requireAdmin`, which every protected function calls |
| `convex/lib/hmac.ts` | One signing scheme for both directions, built on WebCrypto |
| `convex/tools.ts`, `convex/loans.ts`, `convex/users.ts` | All business rules and permission checks |
| `convex/n8n.ts` | Outbound signed webhook with retry and backoff |
| `convex/http.ts` | Inbound signed endpoints for n8n |
| `convex/seed.ts` | Internal-only demo data (`seed:run` / `seed:clear`) |
| `app/page.tsx` | Public page: tagline, live rack of available tools, sign-in |
| `app/dashboard/page.tsx` | Signed-in app: Rack, My listings, My requests, Incoming requests, Admin |
| `app/dashboard/layout.tsx` | Server-side sign-in check for the dashboard (Clerk `auth.protect()`) |
| `app/_components/world.tsx` | Shared UI: category colour families, status swatch, availability calendar, icons, toast |
| `middleware.ts` | Attaches Clerk auth to requests |
| `n8n/workflows/*.json` | The three exported workflows, generated from `n8n/generate-workflows.mjs` |
| `n8n/docker-compose.yml`, `n8n/setup.sh` | Run n8n, import the workflows, wire the error workflow, activate |
| `tests/hmac.test.ts` | Checks the Convex signer against Node `crypto`, which n8n uses |

## Setup

You need Node 20+, Docker, a Clerk account, a Convex account, and ngrok (or any tunnel) so Convex's cloud can reach your local n8n.

### 1. App, Clerk and Convex

```bash
npm install
npx convex dev            # log in and create a deployment; writes CONVEX_DEPLOYMENT and NEXT_PUBLIC_CONVEX_URL to .env.local
```

1. In the Clerk dashboard, create an application. Under **JWT templates**, add one from the **Convex** preset and keep the name `convex`. The preset includes the `name` and `email` claims LendLoop uses.
2. Copy the keys from Clerk's **API keys** page into `.env.local` (see `.env.example`).
3. Set the Clerk issuer in Convex. It's the "Frontend API URL" on Clerk's API keys page:

```bash
npx convex env set CLERK_JWT_ISSUER_DOMAIN https://<your-app>.clerk.accounts.dev
npm run dev               # http://localhost:3000
```

4. Sign in once, then make yourself an admin. `setRole` is an internal mutation, so only someone with deploy access can run it:

```bash
npx convex run users:setRole '{"email":"you@example.com","role":"admin"}'
```

5. Optional: fill the rack with demo data. This adds five fictional neighbors (`example.com` emails with `seed|` identities, so they can never sign in), 24 tools, and loans in every state, including one overdue. Passing your email also adds a request for one of your tools and a loan you're borrowing.

```bash
npx convex run seed:run '{"you":"you@example.com"}'
npx convex run seed:clear   # removes only what seed:run created
```

### 2. n8n

```bash
cp n8n/.env.example n8n/.env
```

Fill in `n8n/.env`. Generate each secret with `openssl rand -hex 32`, then set the same two signing secrets in Convex:

```bash
npx convex env set LENDLOOP_TO_N8N_SECRET <value from n8n/.env>
npx convex env set N8N_TO_LENDLOOP_SECRET <value from n8n/.env>
npm run n8n:up            # docker compose up, then setup.sh imports, links the error workflow and activates
```

1. Open http://localhost:5678 and create the n8n owner account **before** opening a tunnel. Until an owner exists, anyone who reaches the instance can claim it.
2. Convex runs in the cloud and can't reach `localhost`. Start a tunnel and point Convex at it:

```bash
ngrok http 5678
npx convex env set N8N_REQUEST_WEBHOOK_URL https://<subdomain>.ngrok-free.app/webhook/lendloop-request
```

The n8n-to-Convex direction needs no tunnel, because n8n calls Convex's public `https://<deployment>.convex.site` URL.

- **Notifications are mock notifications.** They log to stdout (`docker compose -f n8n/docker-compose.yml logs -f n8n`) and appear in each execution's output. To send real messages, replace the two "(mock)" Code nodes with an Email, Slack or Discord node that uses n8n credentials.
- **To run reminders on demand,** open "LendLoop – Overdue reminders" in n8n and click **Run now**.

```bash
npm test   # HMAC sign/verify self-check
```

### Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_CONVEX_URL` | `.env.local` | Convex client URL, written by `npx convex dev` |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | `.env.local` | Clerk |
| `CLERK_JWT_ISSUER_DOMAIN` | Convex env | Lets Convex verify Clerk tokens |
| `N8N_REQUEST_WEBHOOK_URL` | Convex env | n8n webhook for request notifications |
| `LENDLOOP_TO_N8N_SECRET` | Convex env **and** `n8n/.env` | Convex signs, n8n verifies |
| `N8N_TO_LENDLOOP_SECRET` | Convex env **and** `n8n/.env` | n8n signs, Convex verifies |
| `CONVEX_SITE_URL` | `n8n/.env` | `https://<deployment>.convex.site`, base URL for n8n's calls |
| `N8N_ENCRYPTION_KEY` | `n8n/.env` | Encrypts n8n's credential store |
| `WEBHOOK_URL` | `n8n/.env` | n8n's public base URL (your tunnel) |

`.env.local` and `n8n/.env` are gitignored. Convex variables live in the deployment, not in any file.

## Roles and access control

Permissions are enforced in Convex functions. The UI only hides buttons the user can't use. Every public query and mutation starts with `requireUser(ctx)` or `requireAdmin(ctx)`. These resolve the caller from the verified Clerk JWT (`tokenIdentifier`), never from client-supplied arguments, and then check the caller's relationship to the specific record.

| Action | Who | Where it's enforced |
|---|---|---|
| See available tools (name and category) | Anyone, signed out included | `tools.listPublic`. Only `name` and `category` are returned, and tools out on loan are left out. |
| See the full rack, owners and availability | Signed-in users | `tools.list` |
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
- **Inputs are validated at the boundary:** lengths, `YYYY-MM-DD` dates, start no earlier than today, end no earlier than start, and category against a fixed list.
- **The dashboard is gated twice.** `app/dashboard/layout.tsx` redirects signed-out visitors, and every Convex function refuses them anyway.

## Data minimization

- **Public visitors** get the name and category of tools available right now. No owner, condition or loan data is exposed.
- **Contact details are revealed only after approval.** A borrower sees the lender's email, and the lender sees the borrower's, only once a request is approved (`contactEmail` in `loans.mine` and `loans.incoming`). Before that, neighbors see names only.
- **The availability calendar shows booked date ranges only** (`tools.list → booked`), never who booked them.
- **n8n gets one recipient per event:** `eventId`, `event`, `loanId`, the recipient's name and email, the tool name, the dates and the status. It never receives the other party's details, user ids or internal fields. Overdue reminders carry only the borrower's name and email plus the loan facts.
- **Write-backs from n8n can only touch a reminder for the loan they name.** The idempotency key must start with `reminder:<that loanId>:`.

## n8n integration

### Workflows

1. **LendLoop – Request notification.** Webhook, then *Verify signature*, then a check. A valid request goes to *Send notification (mock)* and then *Respond 200* `{"ok":true}`. An invalid one gets *Respond 401*. Convex fires it on `request.created`, `request.approved`, `request.declined`, `request.cancelled` and `loan.returned`.
2. **LendLoop – Overdue reminders.** A daily 09:00 schedule (or *Run now*) runs: sign, then `POST /n8n/overdue-loans`, then split into one item per loan, then send the reminder, then sign, then `POST /n8n/reminder-status`.
3. **LendLoop – Error handler.** An Error Trigger logs the failure and posts it, signed, to `POST /n8n/workflow-error`. Failures then appear under **Admin → Automation failures** in the app. `setup.sh` sets this as the `errorWorkflow` of the other two.

### Signing in both directions

Every request carries `x-lendloop-signature: t=<unix>,v1=hex(HMAC_SHA256(secret, "<t>.<raw body>"))`. This is the same scheme Stripe uses.
- **Separate secrets per direction.** If n8n leaks, an attacker still can't forge Convex-to-n8n events, and the reverse also holds.
- **Replay window of 5 minutes** on the timestamp.
- **Constant-time comparison:** `crypto.subtle.verify` in Convex and `timingSafeEqual` in n8n.
- **Verify before parse.** The Convex HTTP endpoints verify the raw body before parsing it, and they check that `loanId` is a real loan id.
- **No secrets in code or in exported workflow JSON.** Convex reads them from `process.env`, set with `npx convex env set`. n8n reads them from container environment variables (`$env.*`) supplied by the gitignored `n8n/.env`. A `grep` of `n8n/workflows/` finds only the variable *names*.
- **Why environment variables rather than n8n credentials for the signing secrets:** n8n Code nodes can't read the credential store, and HMAC signing needs the raw secret in code. Credentials are still the right home for anything a built-in node uses. A real Email, Slack or Discord node would take its API key from n8n credentials, encrypted with `N8N_ENCRYPTION_KEY`.

### Idempotency

- **Reminders.** Each reminder has the key `reminder:<loanId>:<YYYY-MM-DD>`. `recordEvent` upserts on that key, so a retried write-back updates the same row and returns `duplicate: true`. A success is never downgraded to a failure. `/n8n/overdue-loans` also leaves out loans already reminded today, so a re-run or retry of the workflow sends no second reminder.
- **Notifications.** Convex sends a stable `eventId` (`<loanId>:<event>`). n8n records delivered ids in workflow static data and acknowledges duplicates without re-sending. Convex records the notification under the key `notify:<loanId>:<event>`.

### Retries and failure visibility

- **Convex to n8n.** The notifier retries up to 5 times with exponential backoff (30s, 1m, 2m, 4m).
  - Delivery counts only when n8n replies with `{"ok":true}`. This matters: n8n returns an empty 200 if a workflow crashes before its Respond node.
  - After the last attempt, the failure is recorded on the loan and shows in red in the app.
  - A missing webhook configuration is also recorded as a failure instead of being skipped silently.
- **n8n to Convex.** Every HTTP node retries 3 times, 5 seconds apart. If retries run out, the run fails and the Error handler reports it to Convex. Failed executions are kept in n8n (`saveDataErrorExecution: all`) and logged to stdout.
- **One bad reminder doesn't stop the batch.** A send failure for one borrower is written back as `status: "failed"` for that loan, and the other reminders still go out.

### Automation activity in the app (bonus)

Each loan shows its latest automation events under it, for example "Overdue reminder sent (3d late), 2 days ago" or "Notified Kwesi Boateng (request.created), 5 minutes ago". Failures appear in red. Admins also get a feed of recent automation failures.

## UX notes

- **The visual idea is a hardware-store paint-chip rack.** Each category is a colour family, and each tool is a named chip. A tool out on loan is hatched.
- **Loan status adds colour layers.** Pending is a light tint, booked adds a band, out is full colour, overdue is hatched red, and returned is stripped back to an outline.
- **What needs you comes first.** A banner on the Rack and a count on **Incoming requests** show pending requests and overdue tools, because a waiting borrower is the most time-sensitive thing in the app.
- **You book on a calendar, not blind.** You pick days on the tool's four-week calendar, where booked days are crossed out and can't be picked or spanned. Clashes are caught before you submit, and the server still re-checks.
- **The basics are covered.** Statuses are plain language ("Due back 22 Nov", "Overdue by 3 days"). Deletes are confirmed inside the page. Every action shows a confirmation message, and server errors show as written. The app has loading placeholders and empty states that say what to do next, and works on phones and desktops alike.

## What was verified

**Locally, against a Convex backend and n8n 1.114.4 in Docker:**
- **RBAC, exercised as different users through `npx convex run --identity`.** Each of these was rejected by the right check: non-owner edit, borrowing your own tool, past dates, a borrower approving their own request, an overlapping booking, a non-admin calling `loans.all` or `setTrusted`, and deleting a tool that's out on loan.
- **Convex HTTP endpoints.** Unsigned, stale (10 minutes old) and tampered requests return 401. A duplicate write-back returns `duplicate: true`, and the overdue list is empty once a loan has been reminded.
- **n8n.** A forged call returned 401, and a signed but malformed event fired the error workflow, which recorded the failure in Convex. The overdue workflow run twice sent one reminder, not two.

**Live, against a cloud Convex deployment and n8n through an ngrok tunnel:**
- **A full loan cycle:** request, then approve, then mark returned. Each step produced a signed webhook, a verified mock notification to the right person, and "Notified …" recorded on the loan.
- **The overdue workflow** reminded the borrower and wrote `sent` back to Convex.

`npm test`, `tsc --noEmit`, `npm run lint` and `next build` all pass.

## Running this in production

What I would change before real neighbors used it:

**Infrastructure**
- **Production instances:** a Convex production deployment and a Clerk production instance, each with its own keys.
- **A permanently hosted n8n** (n8n Cloud, or a container behind TLS on a stable domain) instead of a laptop and a tunnel.
- **Lock down n8n:**
  - Expose only `/webhook/*` publicly and keep the editor behind SSO or a VPN.
  - Run it on Postgres instead of SQLite, with backups.
  - Enable task runners.
- **Pin and update dependencies** (n8n image, Convex, Clerk, Next.js), with Dependabot or Renovate.

**Secrets**
- **Keep secrets in a secret manager** (Doppler, 1Password, AWS Secrets Manager) and inject them into Convex and n8n. Rotate signing secrets on a schedule.
- **Rotate without downtime:** let the verifier accept both the current and the previous secret during a rotation.

**Reliability**
- **Move notification dedupe into Convex** (an `n8nDeliveries` table keyed by `eventId`) instead of n8n static data. That closes the sub-second race noted below and survives an n8n reinstall.
- **Use a queue for outbound events** if volume grows. A Convex table of pending events drained by a cron is an outbox pattern: it gives ordering and an audit trail, and lets n8n be down for hours without losing anything.
- **Alert on failures.** Send the error workflow's output to Slack or PagerDuty as well as the admin view. Alert when `automationEvents` failures cross a threshold, or when the daily reminder run doesn't happen.

**Product and safety**
- **Real notifications:** an email provider (Postmark, Resend) through an n8n credential, with unsubscribe and per-user notification preferences.
- **Timezones:** a per-neighborhood timezone instead of UTC for "today", overdue checks and the 09:00 run.
- **Abuse controls:**
  - rate limits on `loans.request` and `tools.create` (the Convex rate-limiter component)
  - a limit on open requests per user
  - reporting for bad listings
  - an audit log of admin actions (removals, Trusted Lender changes)
- **Privacy:**
  - A data-retention policy, so old loans and automation events are archived after a set period.
  - Account deletion that removes or anonymizes a user's loans.
  - A privacy notice explaining that emails are shared on approval.
- **Escalation for overdue loans:** remind the borrower daily, then notify the lender and finally an admin after N days.
- **Scale:** paginate `tools.list` and `loans.all`, and denormalize current availability onto the tool instead of looking it up per tool.

**Engineering**
- **CI:** type-check, lint and `npm test` on every PR. Add Convex function tests (`convex-test`) for every RBAC rule, plus a Playwright smoke test of the request → approve → return flow.
- **Error tracking** (Sentry) on the Next.js app and Convex actions.

## Known limits

- **n8n notification dedupe has a narrow race.** Static data is saved when a run *finishes*, which is after the webhook has already responded. Two identical deliveries less than about a second apart could both send. Convex retries are at least 30 seconds apart, so this only matters for duplicates sent by hand.
- **"Today" is UTC** for overdue checks and the minimum start date.
- **The n8n side signs the re-serialized JSON body.** This matches because Convex signs `JSON.stringify` output, which round-trips byte for byte. For non-Convex senders, switch the Webhook node to raw-body mode.
- **The booking calendar shows four weeks ahead.**
- **Tools have no photos.** There's no upload feature yet.
