# Paystack sandbox acceptance runbook

This runbook is for the guarded Paystack implementation in PR #34. It is an operator checklist, not proof that a sandbox transaction has already passed.

## Safety boundary

- Keep `PAYSTACK_MODE=test` and use only Paystack test credentials.
- Do not set live credentials, enable live charges, or initiate a real charge, refund, transfer, or payout as part of this runbook.
- Never paste secret values into GitHub, source files, browser code, chat, screenshots, issue comments, or CI logs.
- Configure secrets only in the Supabase project's Edge Function secrets environment.
- The currently deployed payment functions predate PR #34. Do not run the end-to-end checks against production until the reviewed PR is integrated and all three payment functions are deliberately deployed together.
- Do not apply the PR migrations or deploy functions until the PR has been reviewed and the owner has explicitly approved that operation.

## Required server-side configuration

Configure these names in the Supabase project used by Global Culinary Hub:

| Secret / setting | Sandbox value |
| --- | --- |
| `PAYSTACK_MODE` | `test` |
| `PAYSTACK_SECRET_KEY` | Paystack **test** secret key (must begin `sk_test_`) |
| `PAYSTACK_WEBHOOK_SECRET` | Current webhook signing secret supplied for the selected Paystack test environment (implementation expects `whsec_`) |
| `PAYSTACK_WEBHOOK_SECRET_PREVIOUS` | Optional previous `whsec_` value during a controlled signing-secret rotation; remove after overlap ends |

Supabase supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions. Never replace these with browser-visible values or copy the service-role key into application code.

Webhook endpoint:

`https://sdbgrnixnnybaqhunlmh.supabase.co/functions/v1/paystack-webhook`

Set this endpoint in the **Paystack test-mode webhook configuration**, not the live-mode configuration. Confirm the signing secret belongs to that same test-mode webhook configuration.

## Auth leaked-password protection — known plan limitation

Supabase's built-in leaked-password protection requires the Pro plan. The current project is on the Free plan, so this control cannot presently be enabled in the dashboard. Do not mark it as enabled or treat the dashboard setting as completed.

Dashboard location for eligible plans:

https://supabase.com/dashboard/project/sdbgrnixnnybaqhunlmh/auth/providers

This control is separate from Paystack mode and does not itself prevent sandbox payment testing. Keep it recorded as an unresolved authentication-hardening limitation for the production security review. Do not upgrade the project or change billing without the owner's explicit decision. Any production release decision must explicitly acknowledge this limitation and document the compensating password controls in place.

## Acceptance test matrix

Record the test-mode transaction reference, event identifier, expected outcome, observed outcome, and timestamp for each case. Redact email addresses and all credentials from evidence.

| Case | Procedure | Expected result |
| --- | --- | --- |
| Checkout initialization | Signed-in active test user starts one paid course or digital-product checkout | A pending payment is created for NGN minor units; Paystack returns a test authorization URL; no entitlement is granted yet |
| Authenticated verification | Complete the sandbox checkout, then call verification as the same signed-in user | Exact reference, test domain, amount, currency, owner and metadata match; one payment confirmation and one entitlement |
| Wrong user | Attempt to verify another user's reference | Request is rejected; no payment or entitlement changes |
| Metadata mismatch | In isolated sandbox fixtures, alter the returned purpose, subscription plan/billing interval, product/seller ID, or course/instructor ID while keeping the original payment reference | Verification and webhook processing fail closed; no payment confirmation, entitlement, or refund-side effect is created |
| Wrong environment | Use a live-domain transaction or mismatched key/domain | Rejected; no payment confirmation or entitlement |
| Valid signed webhook | Deliver a timestamped `Paystack-Signature` generated for the exact raw body | Accepted; event processed once |
| Webhook ping | Deliver a validly signed Paystack ping event | 2xx response; no payment or entitlement mutation |
| Invalid signature | Alter one body byte without recalculating signature | 401; no database mutation |
| Stale signature | Deliver a correctly signed event with timestamp outside the 300-second tolerance | Rejected; no database mutation |
| Duplicate charge event | Deliver the same successful charge event more than once | Idempotent; no duplicate payment confirmation or entitlement |
| Partial refund | Process a valid refund smaller than the paid amount | Refund recorded once; course/product access remains active |
| Duplicate refund event | Deliver the same refund reference again | Idempotent; refunded total is unchanged |
| Conflicting duplicate | Reuse a refund reference with a different amount or transaction reference | Rejected; no additional refund amount recorded |
| Full cumulative refund | Process valid refunds whose cumulative total equals the original payment | Access and associated certificate are revoked once |
| Over-refund | Attempt cumulative refunds above the original paid amount | Rejected; recorded total cannot exceed original amount |

For each case, inspect both the HTTP response and the corresponding payment/refund/entitlement rows. A successful HTTP response alone is not sufficient evidence that the intended database state is correct.

## Evidence and release gates

Before requesting approval to integrate or deploy, attach a redacted test report containing:

1. Git commit SHA and CI run links for the exact candidate commit.
2. Confirmation that all three payment functions are built from the same reviewed commit.
3. Sandbox references and event IDs for successful checkout, verification, webhook, duplicate delivery, partial refund, and full refund cases.
4. Negative-test outcomes for wrong user, wrong environment, mismatched payment metadata, invalid signature, stale signature, conflicting duplicate, and over-refund.
5. Before/after database evidence showing exactly one entitlement after payment, retained access after partial refund, and revoked access after full refund.
6. Record the leaked-password-protection state accurately: unavailable on the current Free plan; document compensating controls and explicit risk acceptance if a production release is later considered.
7. Confirmation that no live credentials were configured and no live transactions occurred.

Do not merge, apply migrations, or deploy until the owner has reviewed the evidence and explicitly approved the next operation. Keep live charges disabled.
