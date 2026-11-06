# Paystack production readiness — controlled activation

## Current safe state
- Checkout, verification and webhook processing are hard-locked to test mode in this release. Setting `PAYSTACK_MODE=live` causes payment operations to fail closed.
- The default mode is `test`; the secret-key prefix must match the selected mode.
- No Paystack secret, public key, or webhook signing secret belongs in this repository or browser code.
- NGN is the only checkout currency. Currency-conversion displays remain indicative and never change the amount sent to Paystack.
- This change does not set Supabase secrets, enable live mode, or initiate a transaction.

## Supabase Edge Function secrets
Keep the following server-side only:
- `PAYSTACK_MODE=test` (default and required; any other value disables payment operations)
- `PAYSTACK_SECRET_KEY=sk_test_...` only; live-key support is intentionally excluded from this release
- `PAYSTACK_WEBHOOK_SECRET=whsec_...` after creating the signing secret for the matching Paystack environment
- `PAYSTACK_WEBHOOK_SECRET_PREVIOUS=whsec_...` (optional; temporary overlap only during Paystack signing-secret rotation)

The function code fails closed unless `PAYSTACK_MODE` is `test` and the secret starts with `sk_test_`. This release cannot initiate or verify live payments. The webhook accepts the timestamped `Paystack-Signature` header when a matching test-mode `whsec_` secret is configured. Test mode retains the legacy `x-paystack-signature` fallback for existing test integrations. When Paystack sends the modern signature header, the webhook verifies the raw body, all v1 signatures, and a ±300-second timestamp window. During signing-secret rotation, configure the previous `whsec_` value in `PAYSTACK_WEBHOOK_SECRET_PREVIOUS` before the dashboard overlap begins; both current and previous secrets are checked against every `whk_` candidate. Remove the previous secret after the overlap expires.

## Cutover checklist — do not perform until explicitly approved
1. Complete a successful test-mode end-to-end checkout, authenticated verification, signed webhook delivery, duplicate-event/idempotency check, refund ledger test, and entitlement revocation test.
2. Keep live API credentials out of this project. A separate, explicitly authorized production-readiness change is required before any live-mode code or secrets are introduced.
3. Do not configure a live webhook against this test-locked endpoint. Use Paystack's Test Mode webhook configuration for sandbox validation.
4. Monitor test webhook delivery history, Edge Function logs and the payment ledger during sandbox testing.

## Current known limitations / evidence gaps
- No end-to-end Paystack sandbox checkout or signed webhook delivery has yet been completed.
- No production key or live webhook signing secret has been installed or inspected. Live payment code is intentionally locked out.
- No live charge, refund, transfer or payout has been made.
- The current payments table had no recorded payment attempts at the last review; this is not evidence of a successful payment test.
- Refund reconciliation and blocked-entitlement manual refund procedures still require operational validation.
