# Paystack production readiness — controlled activation

## Current safe state
- The deployed project remains in test mode unless `PAYSTACK_MODE=live` is explicitly configured.
- The default mode is `test`; the secret-key prefix must match the selected mode.
- No Paystack secret, public key, or webhook signing secret belongs in this repository or browser code.
- NGN is the only checkout currency. Currency-conversion displays remain indicative and never change the amount sent to Paystack.
- This change does not set Supabase secrets, enable live mode, or initiate a transaction.

## Supabase Edge Function secrets
Keep the following server-side only:
- `PAYSTACK_MODE=test` (default; retain until production approval)
- `PAYSTACK_SECRET_KEY=sk_test_...` for test, or `sk_live_...` only during an explicitly approved production cutover
- `PAYSTACK_WEBHOOK_SECRET=whsec_...` after creating the signing secret for the matching Paystack environment
- `PAYSTACK_WEBHOOK_SECRET_PREVIOUS=whsec_...` (optional; temporary overlap only during Paystack signing-secret rotation)

The function code fails closed if mode and secret prefix do not match. The webhook requires the timestamped `Paystack-Signature` header and matching `whsec_` secret in live mode. Test mode retains the legacy `x-paystack-signature` fallback for existing test integrations. When Paystack sends the modern signature header, the webhook verifies the raw body, all v1 signatures, and a ±300-second timestamp window. During signing-secret rotation, configure the previous `whsec_` value in `PAYSTACK_WEBHOOK_SECRET_PREVIOUS` before the dashboard overlap begins; both current and previous secrets are checked against every `whk_` candidate. Remove the previous secret after the overlap expires.

## Cutover checklist — do not perform until explicitly approved
1. Complete a successful test-mode end-to-end checkout, authenticated verification, signed webhook delivery, duplicate-event/idempotency check, refund ledger test, and entitlement revocation test.
2. Confirm production NGN pricing, Paystack account settlement bank details, business/contact details, customer support and refund policy.
3. In Paystack Dashboard → Developers → API configuration, copy the live secret key and create a live webhook signing secret. Never send either secret in chat or commit them.
4. Configure the production Supabase secrets together in a planned cutover: `PAYSTACK_MODE=live`, `PAYSTACK_SECRET_KEY=sk_live_...`, and `PAYSTACK_WEBHOOK_SECRET=whsec_...`. Keep test keys in a separate staging project/environment; do not mix modes.
5. Set the Live Mode webhook URL to `https://sdbgrnixnnybaqhunlmh.supabase.co/functions/v1/paystack-webhook`. Keep the Test Mode endpoint separately configured if test traffic must continue.
6. Ping the live webhook using Paystack's dashboard/API and confirm a valid signed `ping` receives 2xx. Confirm invalid, expired, wrong-mode and mismatched signatures are rejected.
7. Perform a tightly controlled, explicitly approved low-value live transaction only after the preceding checks; verify exactly once, then reconcile settlement and refund handling.
8. Monitor webhook delivery history, Edge Function logs, payment ledger, settlement reports and support queue before broad customer rollout.

## Current known limitations / evidence gaps
- No end-to-end Paystack sandbox checkout or signed webhook delivery has yet been completed.
- No production key or webhook signing secret has been installed or inspected.
- No live charge, refund, transfer or payout has been made.
- The current payments table had no recorded payment attempts at the last review; this is not evidence of a successful payment test.
- Refund reconciliation and blocked-entitlement manual refund procedures still require operational validation.
