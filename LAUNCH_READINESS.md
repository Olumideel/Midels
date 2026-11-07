# Global Culinary Hub — launch readiness

Last reviewed: 7 November 2026

This checklist distinguishes implemented code from external approvals and production verification. A checked item means the underlying code or database setting was inspected; it does not mean the feature has passed a live browser test.

## November launch objective

Target: public launch during November 2026, conditional on the release gates below. This is a target, not a guaranteed date. If payment, legal, security or recovery checks are incomplete, launch with payments disabled rather than accepting unsafe transactions.

## Implemented foundations

- [x] Supabase Auth, PostgreSQL, Row Level Security and private file storage.
- [x] All 30 public-schema tables have Row Level Security enabled.
- [x] Payment confirmation is server-side and restricted to the service role.
- [x] Paystack checkout is hard-locked to test mode; live charges are disabled.
- [x] Product purchases, paid downloads, refunds and refund access revocation are implemented.
- [x] Course creation, enrolment, lessons, assessments, grading and certificate verification are implemented.
- [x] Certificate verification codes now use 96 bits of random material for newly issued certificates.
- [x] Community reporting and a database-authorised moderation queue are implemented.
- [x] Private platform-administrator registry is implemented. The owner account has been registered without changing its public profile role.
- [x] Aggregate platform metrics are available to platform administrators only.
- [x] Search crawler instructions and a basic sitemap are present.
- [x] Contact-form wording no longer promises unverified response times or claims that submissions are never shared with providers.

## Must complete before public production launch

### Business, legal and privacy
- [ ] Confirm registered operator name, business address, jurisdiction and official support/privacy contacts.
- [ ] Have Privacy Notice, Terms of Service, Cookie/Storage Notice, seller terms and refund policy reviewed by qualified counsel. Non-public draft pages are in the repository and are not approved for publication.
- [ ] Decide and enforce age eligibility and parental-consent requirements.
- [ ] Complete verified data-access/export delivery, correction handling and deletion fulfilment workflows.
- [x] Implement authenticated intake and administrator review queue for data-copy and account-deletion requests.
- [ ] Confirm Formspree data-processing terms, region, retention and access controls, or replace it with an approved support channel.
- [ ] Define content moderation escalation, appeals and intellectual-property takedown procedures.
- [ ] Define retention periods for messages, payment records, support cases, reports and backups.
- [x] Add explicit opt-in to newsletter signup and a contact route for removal requests.

### Authentication and infrastructure
- [ ] Move Supabase from Free to a production-appropriate plan before launch; Free currently lacks leaked-password protection and automatic daily backups.
- [ ] Configure and test production SMTP, signup confirmation, password recovery and transactional email delivery.
- [ ] Enable leaked-password protection after upgrading to an eligible Supabase plan.
- [ ] Configure custom domain, DNS, HTTPS enforcement and Supabase Auth redirect URLs.
- [ ] Decide whether to keep the current US West database region or migrate to a closer region before production data is created.
- [ ] Configure external backups, restore drills, monitoring, alerting and incident response.
- [ ] Create a separate staging environment and document deployment/rollback procedures.

### Payments and marketplace operations
- [ ] Verify the Paystack business account, KYC status and international-card activation.
- [ ] Confirm settlement currency and bank-account eligibility with Paystack.
- [ ] Complete seller identity/business verification and Paystack subaccount onboarding.
- [ ] Implement seller settlement splits, payout reconciliation, disputes and refund operations.
- [ ] Complete subscription lifecycle, cancellation and plan-entitlement enforcement.
- [x] Add indicative display-currency conversion for public course and marketplace prices (NGN, USD, GBP, EUR, CAD, AUD, ZAR, GHS and KES), using a daily reference-rate feed with local caching and visible attribution.
- [ ] Extend currency display to subscription plan prices if required; checkout remains NGN only.
- [ ] Obtain approval before switching any checkout path to live mode.

### Quality and operations
- [ ] Test all critical user journeys on Android, desktop and supported browsers.
- [ ] Test signup, email confirmation, login, password reset and account recovery.
- [ ] Test recipe/photo uploads, profile visibility, messaging, blocking and moderation.
- [ ] Test course creation, enrolment, lesson progress, assessments and certificate verification.
- [ ] Test marketplace purchase, download permissions, refund and revocation.
- [ ] Run payment-provider test transactions, webhook retries and idempotency checks.
- [ ] Perform accessibility, performance, security and dependency reviews.
- [ ] Publish accurate support hours, refund response targets and service-status communications.

## Current verified launch blockers — 7 November 2026

- Supabase production migration ledger does not match the tracked `main` migration directory. Supabase Preview logs report `Remote migration versions not found in local migrations directory.`
- Production has recorded 31 migration versions, while the repository's current `supabase/migrations/` directory contains only seven files. The baseline and many earlier migration files are absent; several later migration timestamps also disagree.
- Production Supabase branch status is `MIGRATIONS_FAILED`; no isolated development branch was available during the latest read-only check.
- A course refund/repurchase race remains: a delayed refund for an earlier purchase can revoke a later enrollment for the same student/course because the current enrollment record is not tied to its originating payment.
- Payment Edge Function production version remains test-only. Already-paid payment recovery still needs stronger purpose-specific entitlement checks.
- Static GitHub checks have passed for several candidate changes, but those checks do not prove SQL migration replay or end-to-end payment correctness.
- Paystack business/KYC approval status has not been independently verified from the provider dashboard.

See [SUPABASE_MIGRATION_LEDGER_AUDIT.md](SUPABASE_MIGRATION_LEDGER_AUDIT.md) for the exact production ledger and safe recovery sequence.

## Follow-up audit — 7 November 2026, 13:05 UTC

- Draft PR #51 adds subscription-period validation, course payment-backing checks, and a shared transaction-scoped lock for refund/repurchase transitions. GitHub Actions run #59 passed on its exact head for Deno payment-function checks, environment/webhook tests, and static migration assertions. It remains draft and unmerged; no PostgreSQL concurrency test or migration replay has passed.
- The refund/repurchase proposal checks whether another paid, not-fully-refunded payment for the same learner/course still backs access before revoking the canonical enrollment and certificate. It does not add a separate entitlement table or `payment_id` column to enrollments. Keep issue #49 open until independent review, certificate lifecycle decisions, and executable concurrency tests pass.
- PR #44 contains purpose-specific already-paid verification in its candidate Edge Function and database confirmation guards. Those changes are not deployed. Paid-but-unfulfilled recovery after account reactivation remains unresolved; keep issue #50 open.
- Migration recovery checked both missing baseline SQL paths across all 50 active Git branches; neither file was present on any checked branch. Commit-message searches did not identify a baseline/schema migration commit. This does not rule out external backups, database export artifacts or other authoritative sources.
- Latest Supabase Security Advisor: 4 RLS-enabled tables have no policies (`private.platform_admins`, `public.audit_logs`, `public.newsletter_subscribers`, `public.payment_refunds`); 1 anonymous SECURITY DEFINER function (`verify_course_certificate`); 15 authenticated SECURITY DEFINER functions; and leaked-password protection disabled. The functions require individual authorization review; do not blanket-revoke. Some no-policy tables are intentionally backend-only, but grants must remain tightly scoped.
- Latest Performance Advisor reports 17 unused indexes. Treat these as informational only; do not drop indexes without workload evidence and a measured review.
- Production remains on the single Supabase `main` branch with status `MIGRATIONS_FAILED`. No isolated staging database exists. Do not create a paid development branch until the organisation, cost estimate and explicit user approval are obtained.

No production migration, Edge Function, secret, Paystack setting, payment, refund, transfer, payout, or customer/student record was changed during this follow-up.

## Release rule

The November objective is to launch the public platform only after legal, business, provider-approval, security, backup, payment and critical end-to-end gates have been completed and signed off. If live payment readiness is not achieved in time, a limited public launch may proceed only with checkout visibly disabled and no promise of paid services until payments are activated.

Do not announce a genuine international production launch until the legal, business, provider-approval, security, backup, payment, seller-settlement and end-to-end testing items above have been completed and signed off.

## Payment safety

No live charges, seller settlements, production migrations or production Edge Function deployments are authorised by this readiness document. Live mode remains disabled until the release gates are verified and the required production approvals are explicitly given.
