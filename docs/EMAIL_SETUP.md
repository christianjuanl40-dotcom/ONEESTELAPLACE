# Email and Firebase Verification Setup

This guide covers the server-controlled email outbox, Gmail SMTP notifications, server-verified email OTP, and the optional Firebase link fallback in One Estela Place. No production credentials are stored in the repository. Transactional email, OTP delivery, and verification enforcement are **disabled by default**.

## 1. Gmail account and App Password

1. Create or select a dedicated Gmail account owned by One Estela Place. Do not use a staff member's personal mailbox.
2. Enable Google 2-Step Verification for that account.
3. In the Google Account security settings, create a Google **App Password** for this application.
4. Keep the generated App Password in the deployment secret store only. Never put it in Firestore, source code, a browser bundle, Markdown, or a log.

The application uses Gmail submission over TLS:

```text
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=<dedicated Gmail address>
SMTP_APP_PASSWORD=<Google App Password>
EMAIL_FROM=One Estela Place <same Gmail address>
```

Nodemailer is server-only. Browser components never receive these values.

## 2. Firebase Authentication

In Firebase Console:

1. Enable **Email/Password** under Authentication → Sign-in method.
2. Confirm the production domain, Vercel preview domain used for testing, and local development host are in Authentication → Settings → Authorized domains.
3. Review Authentication → Templates → Email address verification only if the owner deliberately enables the compatibility link fallback. The primary signup flow uses the server OTP endpoint, not Firebase's automatic verification-mail delivery.
4. Do not add arbitrary redirect destinations. If the fallback is enabled, the application calls Firebase `sendEmailVerification()` without accepting a browser-supplied redirect URL.

Firebase `emailVerified` is authoritative. New signup first creates only a server-side pending registration challenge; it does not create Firebase Auth, a Client profile, or persist the password. The original password remains only in the globally mounted client `AuthProvider` ref during the active client-side transition. After the OTP succeeds, the browser automatically creates Firebase Auth and calls the protected finalizer. The Admin SDK marks Auth verified and atomically creates the Client profile with an immutable `emailVerificationRequired` onboarding marker. A refreshed or interrupted flow loses the password and safely requires signup restart. The marker classifies the mandatory flow but is not proof of verification. Existing authenticated accounts use the separate OTP route, and protected server mutations validate the Firebase ID token plus the marker and, for unmarked legacy password accounts, the optional rollout policy.

## 3. Environment variables

Copy `.env.example` to `.env.local` for local work. The following values are server-only unless marked otherwise:

```text
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=
SMTP_APP_PASSWORD=
EMAIL_FROM=
APP_BASE_URL=http://localhost:3000
EMAIL_SENDING_ENABLED=false
EMAIL_TEST_RECIPIENT_ALLOWLIST=
# Production accepts real recipients unless this is explicitly true.
EMAIL_TEST_RECIPIENT_ALLOWLIST_ONLY=false
EMAIL_MAX_ATTEMPTS=5
EMAIL_OTP_SENDING_ENABLED=false
EMAIL_OTP_STAGING_APPROVED=false
EMAIL_OTP_SECRET=
EMAIL_OTP_EXPIRY_SECONDS=600
EMAIL_OTP_RESEND_COOLDOWN_SECONDS=60
EMAIL_OTP_PRODUCTION_APPROVED=false
NEXT_PUBLIC_EMAIL_VERIFICATION_LINK_FALLBACK_ENABLED=false
EMAIL_VERIFICATION_ENFORCEMENT_ENABLED=false
EMAIL_VERIFICATION_ENFORCEMENT_START_AT=
CRON_SECRET=
```

`EMAIL_MAX_ATTEMPTS` is optional and defaults to 5. `EMAIL_TEST_RECIPIENT_ALLOWLIST_ONLY` is an explicit production smoke-test restriction; when true, production worker/OTP recipients must be in the normalized allowlist. It is false by default, so production delivery is not silently limited by a leftover test allowlist. `EMAIL_OTP_SECRET` is server-only and must be a strong random secret of at least 32 characters; it is used only for HMAC digests and is never sent to the browser. OTP expiry is bounded to 60–3600 seconds and resend cooldown to 30–900 seconds; invalid values use safe defaults of 600 and 60. `APP_BASE_URL` must be an HTTPS origin outside local development. It is used only to build fixed portal links in transactional email templates.

### Local `.env.local`

Keep `EMAIL_SENDING_ENABLED=false`, `EMAIL_OTP_SENDING_ENABLED=false`, and `EMAIL_OTP_STAGING_APPROVED=false` for ordinary development. Unit tests use fake transports and do not make SMTP connections. For a real owner-authorized delivery, use the isolated staging OTP steps below; never enable OTP against a `.env.local` that contains production Firebase or SMTP values. OTP does not use `emailOutbox`; transactional notifications remain disabled unless separately enabled.

### Vercel Preview

Add the SMTP values, `APP_BASE_URL` for the preview origin, `CRON_SECRET`, a random `EMAIL_OTP_SECRET`, and an allowlist containing only the controlled disposable test inbox. Set `EMAIL_OTP_SENDING_ENABLED=true` only for the owner-authorized OTP smoke test; keep `EMAIL_SENDING_ENABLED=false`, `EMAIL_OTP_PRODUCTION_APPROVED=false`, and verification enforcement disabled. Preview is treated as non-production by `VERCEL_ENV`, but the allowlist is still required for controlled delivery.

### Vercel Production

Add the dedicated Gmail secrets, the HTTPS production `APP_BASE_URL`, a strong `CRON_SECRET`, and a separate strong `EMAIL_OTP_SECRET` through Vercel's encrypted environment-variable UI. Do not paste values into deploy logs. Keep `EMAIL_SENDING_ENABLED=false`, `EMAIL_OTP_SENDING_ENABLED=false`, `EMAIL_OTP_PRODUCTION_APPROVED=false`, and verification enforcement disabled until the owner completes staging/preview smoke tests and explicitly approves any production activation. This worktree does not activate production.

## 4. OTP-first signup and verification flow

New email/password Client registration:

1. Sends only sanitized profile fields to unauthenticated `/api/auth/register/otp`. No password, Firebase Auth identity, or `users/{uid}` profile exists at this point.
2. Stores the pending registration server-side with a normalized-email digest, OTP HMAC digest, expiry, resend/IP/email limits, delivery state, and the profile fields needed after verification. The code is sent directly through the server-only Gmail transport.
3. Opens `/verify-email` with the registered address displayed in a privacy-safe form. The page provides six-slot numeric entry, complete-code paste support, resend cooldown, status/error announcements, and Cancel Signup.
4. A successful code claim sets a short-lived, single-use HttpOnly authorization cookie. Replaying the code cannot mint another authorization.
5. After the code is accepted, the browser uses the original password from the temporary in-memory `AuthProvider` handoff to create the Firebase Auth email/password identity, then sends its ID token and the HttpOnly authorization to `/api/auth/register/finalize`. No password form appears on this page.
6. The Admin SDK verifies the email-bound authorization, marks Firebase Auth `emailVerified`, and atomically creates/acknowledges the Client profile. The finalizer is idempotent for the same UID and clears the cookies after success. The page signs out the newly created identity and requires a manual login. If the in-memory handoff was lost, the page does not request or persist a replacement password; it directs the user to restart signup.

The pending-registration server stores only an HMAC digest of the OTP bound to normalized email and registration ID; it never stores the password or plaintext code. Pending challenges expire, can be resent only after cooldown, are limited by email/IP issuance windows, lock after five incorrect attempts, record delivery failures without creating an account, and clear the code digest after success. The authenticated legacy path stores an HMAC digest bound to UID, normalized email, code, and challenge ID, and invalidates it if the Auth email changes. Successful legacy verification updates Firebase Auth `emailVerified` and re-reads Auth before returning. OTP delivery is direct Gmail SMTP and is intentionally separate from `emailOutbox`.

The compatibility Firebase link is available only when `NEXT_PUBLIC_EMAIL_VERIFICATION_LINK_FALLBACK_ENABLED=true`. It retains the existing Firebase action-handler behavior and is never selected by a browser-supplied redirect. A verified user can continue to `/portal`.

Existing users are not globally gated by default. New finalized email/password Client signups are verification-gated on protected mutations immediately; the authenticated OTP issue/verify route remains available for the legacy account path. When enforcement is activated, the server additionally requires verification only for unmarked email/password Client accounts created at or after `EMAIL_VERIFICATION_ENFORCEMENT_START_AT`. Admin, Staff, Google/provider-authenticated users, already-verified users, and legacy Clients retain their existing role and access behavior.

## 5. Transactional email architecture

The dedicated server-only Firestore collection is `emailOutbox`. It is not readable or writable by browser clients. Jobs contain:

- event type and deterministic event ID
- booking ID and recipient Firebase UID
- template version, status, attempt count, lease timestamps, and safe error code
- a small sanitized business snapshot (no password, proof image, token, or internal audit log)

The job is created in the same Firestore transaction as the successful business transition when `EMAIL_SENDING_ENABLED=true`. A disabled environment does not enqueue or replay historical events. The worker resolves the destination address from Firebase Auth using `recipientUid`; browser-submitted recipient addresses are ignored.

Current event mappings:

| Event | Subject | Source |
| --- | --- | --- |
| Booking submitted | Booking Request Received | `/api/bookings` commit |
| Booking approved | Booking Confirmed | lifecycle approval/contract commit |
| Booking rejected | Booking Rejected | guarded lifecycle `status=declined` commit |
| Booking schedule updated | Booking Schedule Updated | Admin update or approved Client modification |
| Booking cancelled | Booking Cancellation Notice | Admin/direct or approved cancellation commit |
| Payment submitted | Payment Submitted for Review | Client payment submission commit |
| Payment verified | Payment Verified | payment review or trusted onsite payment commit |
| Payment rejected | Payment Rejected | payment review commit |
| Payment incomplete | Payment Requires Attention | payment review commit |
| Balance reminder | Remaining Balance Reminder | existing lifecycle reminder commit |

Booking rejection is deliberately narrower than payment rejection or modification decline. The lifecycle API and Admin Booking Details action accept `status=declined` only for an unsecured `pending`/`verifying` booking with no received or pending payment activity. The transaction records the reason/actor, releases the booking, writes the client notification, and creates the deterministic `booking_rejected` outbox job. Paid, secured, cancellation-review, modification-review, and released bookings are rejected by the server.

The worker uses a five-minute claim lease, bounded exponential retry, terminal failure after the configured attempt limit, and deterministic event IDs. A timeout after Gmail may have accepted a message is treated as an uncertain transient result; SMTP cannot provide universal exactly-once inbox delivery, so a later retry may duplicate a message. The system does not claim inbox delivery—only Gmail submission acceptance.

## 6. Worker and scheduler

The protected Node.js endpoint is:

```text
GET or POST /api/internal/email-worker?limit=10
Authorization: Bearer <CRON_SECRET>
```

The deployed route accepts both methods; the prepared GitHub Actions workflow uses `POST`. It returns 404 for missing/incorrect secrets, returns `status=disabled` without processing when `EMAIL_SENDING_ENABLED=false`, and returns a safe configuration error if SMTP or `APP_BASE_URL` is incomplete. The worker resolves only server-side Auth recipient addresses and never accepts a recipient from the scheduler request.

The protected readiness endpoint is:

```text
GET or POST /api/internal/email-diagnostics
Authorization: Bearer <CRON_SECRET>
```

`GET` is preferred because the request has no body and does not process email. The route accepts either `Authorization: Bearer <CRON_SECRET>` or `x-cron-secret: <CRON_SECRET>`. Missing or incorrect authentication deliberately returns HTTP `404` with `{ "error": "Not found." }`; this does not disclose whether the route exists. A valid request returns HTTP `200` when OTP readiness and the production Firebase project check pass, otherwise HTTP `503`.

It returns only safe booleans, counts, an OTP gate reason, and a Firebase project-match result. It never returns SMTP credentials, the OTP secret, recipient addresses, or the project credential. Use it to diagnose a deployed `503` without pulling encrypted Vercel values:

```powershell
Invoke-WebRequest `
  -Uri "https://oneestelaplace.vercel.app/api/internal/email-diagnostics" `
  -Headers @{ Authorization = "Bearer $env:CRON_SECRET" }
```

For the shortest owner check, inject `CRON_SECRET` into the current process from a password manager or other secret store without putting the value in shell history, then run:

```powershell
curl.exe --silent --show-error --fail-with-body --request GET `
  --header "Authorization: Bearer $env:CRON_SECRET" `
  "https://oneestelaplace.vercel.app/api/internal/email-diagnostics"
Remove-Item Env:CRON_SECRET -ErrorAction SilentlyContinue
```

This prints the sanitized response only; never replace `$env:CRON_SECRET` with a literal value, use `curl -v`, or capture the command in a screenshot. If the secret is not already injected, use hidden input rather than a command-line argument.

The authenticated response contains only these fields:

- `status`: `ready` or `not_ready`.
- `email`: `environment`, `isProduction`, `isStaging`, `emailSendingEnabled`, `otpSendingEnabled`, `otpStagingApproved`, `otpProductionApproved`, `otpSecretConfigured`, `smtpConfigured`, `appBaseUrlConfigured`, `otpReady`, `otpGateReason`, `recipientAllowlistConfigured`, `recipientAllowlistCount`, and `recipientAllowlistOnly`.
- `firebase`: `adminConfigured`, `projectMatchesProduction`, and `errorCode` (`null` or `firebase_admin_unavailable`).

It never returns `CRON_SECRET`, SMTP credentials, `EMAIL_OTP_SECRET`, an OTP, recipient addresses, or Firebase service-account values.

Interpret `email.otpGateReason` as follows:

| Code | Meaning | Owner action |
| --- | --- | --- |
| `ready` | OTP flags, production approval, SMTP shape, and OTP secret length pass the configuration gate. | If HTTP is still `503`, inspect `firebase.adminConfigured` and `firebase.projectMatchesProduction`; SMTP authentication/delivery still needs one controlled test. |
| `otp_flag_false` | `EMAIL_OTP_SENDING_ENABLED` is not exactly `true`. | Set it only for the approved OTP test/activation. |
| `production_approval_false` | Production is detected but `EMAIL_OTP_PRODUCTION_APPROVED` is not exactly `true`. | Obtain owner approval before changing it. |
| `staging_approval_false` | Staging is detected without staging approval. | Use the isolated staging configuration; never weaken production checks. |
| `smtp_incomplete` | Required Gmail host/user/App Password/from configuration is incomplete or invalid. | Correct Vercel Production variables without printing their values. |
| `otp_secret_missing` | `EMAIL_OTP_SECRET` is missing or shorter than 32 characters. | Generate/store a separate server-only secret. |

Allowlist policy is reported separately. `recipientAllowlistOnly=true` means an OTP recipient and worker recipient must be in the configured allowlist; `recipientAllowlistConfigured` and `recipientAllowlistCount` do not reveal the address or prove that a particular address matches. A disallowed OTP request is rejected separately as `otp_recipient_not_allowed`; it is not an `otpGateReason`. A live SMTP authentication or delivery failure also cannot be proven by this read-only route; it requires the owner-approved controlled OTP test.

The OTP gate is independent of transactional outbox sending: `otpReady=true` can coexist with `emailSendingEnabled=false`. Keep `EMAIL_SENDING_ENABLED=false` until the historical outbox disposition is approved and completed.

It can also be invoked manually for an owner-authorized smoke test:

```powershell
Invoke-WebRequest `
  -Uri "https://oneestelaplace.vercel.app/api/internal/email-worker?limit=10" `
  -Headers @{ Authorization = "Bearer $env:CRON_SECRET" }
```

Do not expose the endpoint without `CRON_SECRET`. The worker processes transactional jobs only; it does not send OTP messages.

### 6.1 Prepared GitHub Actions worker (not activated)

`.github/workflows/email-worker.yml` is checked in with a five-minute schedule and manual dispatch, but it is disabled by default. Every worker job requires both:

1. The repository Actions variable `EMAIL_WORKER_ENABLED` to equal the exact lowercase string `true`.
2. For manual dispatch, the `activate` confirmation input to be set to `true`. Scheduled runs do not have that manual input.

When the job runs, it sends one `POST` request with `Authorization: Bearer $CRON_SECRET`; the secret is never placed in the URL. Workflow concurrency allows only one active production worker run, and the endpoint's five-minute job leases provide a second duplicate-claim guard. The workflow does not use Vercel Cron.

The workflow is intentionally not enabled by committing it. Do not set `EMAIL_WORKER_ENABLED=true` until the backlog steps below are complete.

### 6.2 Pre-release backlog disposition

The last authorized read-only inspection found exactly three `pending` jobs created before this release: one `booking_submitted`, one `payment_submitted`, and one `payment_verified`, spanning `2026-11-09T02:26:24.683Z` through `2026-11-09T02:27:12.437Z`. No worker invocation, send, or outbox mutation was performed.

Before activation, the owner must inspect those exact documents in the production Firebase Console or with an approved Admin SDK read. For each job that the owner approves as historical and not to be sent, update only that exact `emailOutbox/{jobId}` document to:

```text
status = "blocked"
lastErrorCode = "historical_job_excluded"
claimedAt = null
claimExpiresAt = null
blockedAt = <owner-approved timestamp>
blockedReason = "pre-release backlog excluded after owner review"
```

Record the document IDs privately in the owner change record. Do not delete the documents, alter booking/payment fields or payloads, mark them `sent`, or reset them to `pending`. `blocked` is already a terminal worker-excluded state and is not selected by the worker. Re-read `emailOutbox` after the update and confirm the three reviewed jobs are `blocked` before enabling transactional sending. If the owner instead approves sending one or more jobs, keep them pending and handle them as a separate, explicit controlled send decision; never enable a broad scheduler first.

This state change requires owner approval and is not performed by this repository or workflow.

## 7. Safe smoke tests

### Automated tests

Run:

```powershell
npx vitest run
node --test scripts/start-staging.test.mjs
npx tsc --noEmit
npx eslint . --quiet
git diff --check
```

The email tests inject a fake SMTP transport. They do not connect to Gmail and do not use production customer data.

### Owner-authorized staging OTP test

1. Confirm the current safe baseline with `npm run dev:staging -- --check`; it must name `one-estela-place-staging`, show `email_sending=false`, `otp_sending=false`, and `verification_enforcement=false`. This command does not send mail.
2. With owner approval only, add the following values to the ignored `.env.staging.local`; never copy them from `.env.local` and never paste secrets into a command line or log:

   ```text
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=465
   SMTP_SECURE=true
   SMTP_USER=<staging-only Gmail address>
   SMTP_APP_PASSWORD=<staging-only Gmail App Password>
   EMAIL_FROM=One Estela Place <staging-only Gmail address>
   EMAIL_OTP_SENDING_ENABLED=true
   EMAIL_OTP_STAGING_APPROVED=true
   EMAIL_OTP_SECRET=<random secret, at least 32 characters>
   EMAIL_TEST_RECIPIENT_ALLOWLIST=<exact authorized test inbox>
   EMAIL_SENDING_ENABLED=false
   EMAIL_OTP_PRODUCTION_APPROVED=false
   EMAIL_VERIFICATION_ENFORCEMENT_ENABLED=false
   NEXT_PUBLIC_EMAIL_VERIFICATION_LINK_FALLBACK_ENABLED=false
   ```

   The launcher rejects multiple allowlist addresses, missing staging SMTP credentials, production approval, mismatched Firebase identity, and missing staging approval.
3. Run `npm run dev:staging -- --check` again. It validates the configuration and exits without starting Next.js or sending an OTP. Only after it passes, start the local server with `npm run dev:staging -- --port 3000`.
4. In a private browser window at `http://localhost:3000`, register exactly one new synthetic Client using the exact allowlisted address. Signup first creates only a pending-registration record and requests one OTP; Firebase Auth/profile creation happens only after the code, using the original password held in temporary browser memory. Do not use production domains, customer addresses, resend, or the email worker.
5. Open `/verify-email`, enter the six-digit code from the controlled inbox, and confirm automatic finalization and the redirect to manual login. In Firebase Console, explicitly select `one-estela-place-staging`, open that test Auth user, and confirm `Email verified` is true. The server also re-reads Auth after the Admin update.
6. Do not put the code in logs, screenshots, tickets, or test output. Invalid, expired, locked, email-changed, and already-used behavior is covered by the automated tests; do not spend the one-delivery test on those cases.
7. Immediately disable the mode in `.env.staging.local` by setting `EMAIL_OTP_SENDING_ENABLED=false` and `EMAIL_OTP_STAGING_APPROVED=false`, then stop/restart the staging server. Leave transactional email and verification enforcement disabled.

### Owner-authorized booking/payment test

1. Use only a synthetic test account whose Auth email is in `EMAIL_TEST_RECIPIENT_ALLOWLIST`.
2. After the historical backlog is dispositioned and `EMAIL_SENDING_ENABLED=true` is explicitly approved, create one future synthetic booking and one controlled payment event.
3. Invoke the worker with the protected secret and inspect the controlled inbox and `emailOutbox` status in the authorized Firebase Console.
4. Confirm the payment event's status/method/amount is correct and that a failed business transaction creates no success job.

Do not replay historical bookings or run a mass send.

## 8. Firestore deployment

The outbox, OTP challenge/rate-limit, and pending-registration collections are server-only and the rules explicitly deny browser access. No new index is required by the current worker or OTP queries. If rules are changed during owner review, deploy only the reviewed rules:

```powershell
firebase deploy --only firestore:rules
```

The implementation does not deploy automatically.

## 9. Owner dashboard activation order

### Vercel

1. Open the Vercel project **oneestelaplace** → **Settings** → **Environment Variables** → **Production**.
2. Confirm `CRON_SECRET` exists, without revealing or copying it into chat/logs. The same value must be stored in GitHub Actions as a secret, not a repository variable.
3. Keep `EMAIL_SENDING_ENABLED=false` while the three historical jobs are reviewed and dispositioned. OTP controls are separate: inspect them through the protected diagnostics response before changing any value.
4. After owner approval, change only the intended production flag(s), redeploy, and run diagnostics again. Do not use Vercel Cron; this workflow is external GitHub Actions.

### GitHub

1. Open the repository → **Settings** → **Secrets and variables** → **Actions**.
2. Under **Secrets**, create `CRON_SECRET` with the exact production value. Do not create it as a variable and do not put it in the workflow file.
3. Under **Variables**, create `EMAIL_WORKER_ENABLED` with `false` (or leave it absent) during backlog review.
4. After the owner approves the backlog and transactional email configuration, change the variable to the exact lowercase value `true`.
5. For the first run, open **Actions** → **Production email worker** → **Run workflow**, select the default branch, set `activate` to `true`, and review the safe response. Later scheduled runs use the same repository-variable gate.
6. Disable immediately by changing `EMAIL_WORKER_ENABLED` to anything other than exact lowercase `true`; no code change is required.

## 10. Troubleshooting and emergency disablement

- **No jobs are created:** confirm `EMAIL_SENDING_ENABLED=true` for the server environment; ordinary local/test runs intentionally skip enqueueing.
- **Worker returns `email_configuration_incomplete`:** check SMTP host/port/security, Gmail user/App Password, `EMAIL_FROM`, and HTTPS `APP_BASE_URL`.
- **Jobs are blocked:** Preview/local delivery requires a normalized address in `EMAIL_TEST_RECIPIENT_ALLOWLIST`; production uses the allowlist only when `EMAIL_TEST_RECIPIENT_ALLOWLIST_ONLY=true`.
- **SMTP authentication fails:** generate a new App Password, confirm 2-Step Verification, and verify the dedicated account has SMTP access. Never print the secret.
- **OTP is unavailable:** confirm `EMAIL_OTP_SENDING_ENABLED=true`, `EMAIL_OTP_STAGING_APPROVED=true`, a strong `EMAIL_OTP_SECRET`, complete staging Gmail SMTP values, and exactly one staging allowlist address. Production also requires explicit `EMAIL_OTP_PRODUCTION_APPROVED=true`; do not set that flag during ordinary staging work.
- **OTP code fails:** request a fresh code after the cooldown; codes are single-use, expire, bind to the current Auth email, and lock after five failed attempts.
- **Verification link fails:** enable the explicit compatibility fallback only for an owner-authorized test; Firebase handles expired, invalid, and already-used action codes.
- **A booking succeeds while email fails:** this is expected. Business success and email delivery status are separate; inspect the outbox and worker safe error code.

To disable immediately, set `EMAIL_WORKER_ENABLED` to anything other than exact lowercase `true`, set `EMAIL_SENDING_ENABLED=false` and `EMAIL_OTP_SENDING_ENABLED=false` in every active deployment environment, and redeploy/restart the server. To stop new verification gates, set `EMAIL_VERIFICATION_ENFORCEMENT_ENABLED=false`. Existing committed bookings/payments are not rolled back, and no automatic historical replay occurs when email is re-enabled.
