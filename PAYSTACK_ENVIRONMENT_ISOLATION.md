# Paystack environment isolation and activation

## Environment selection
- `PAYSTACK_MODE` accepts only `test` or `live`; unset defaults to `test`.
- `PAYSTACK_SECRET_KEY` must match the selected environment: `sk_test_` for test and `sk_live_` for live.
- All three payment Edge Functions enforce the same resolver and reject cross-environment keys.
- Paystack transaction `domain` must match the selected mode before payment confirmation, refund recording, or entitlement changes.
- Checkout currency remains NGN and amounts remain minor units (kobo).

## Webhook signing
- Configure `PAYSTACK_WEBHOOK_SECRET` for the selected environment using its `whsec_` secret.
- During key rotation, set `PAYSTACK_WEBHOOK_SECRET_PREVIOUS` temporarily, then remove it after overlap ends.
- Timestamped `Paystack-Signature` is verified against the exact raw body with a 300-second freshness window.
- Legacy `x-paystack-signature` using the API secret is accepted only in test mode. Live mode fails closed without a valid timestamped signature.
- Configure separate Paystack dashboard webhook endpoints/settings for Test and Live environments.

## Production cutover gate
This branch only adds guarded live-mode code. It does not set secrets, deploy functions, merge code, or make a charge.
Before live activation:
1. Complete sandbox checkout, authenticated verification, signed webhook, duplicate delivery, partial/full refund and entitlement revocation tests.
2. Review production RLS and SECURITY DEFINER findings, including admin-only authorization boundaries.
3. Configure live secrets server-side in Supabase; never put them in GitHub or browser code.
4. Confirm the Live webhook signing secret matches the Live dashboard endpoint.
5. Deploy and verify Edge Functions, then perform a controlled low-value live transaction only after explicit operational approval.
