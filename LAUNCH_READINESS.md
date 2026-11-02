# Global Culinary Hub — launch readiness

Last reviewed: 2 November 2026

This checklist distinguishes implemented code from external approvals and production verification. A checked item means the underlying code or database setting was inspected; it does not mean the feature has passed a live browser test.

## Implemented foundations

- [x] Supabase Auth, PostgreSQL, Row Level Security and private file storage.
- [x] All 29 public-schema tables have Row Level Security enabled.
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
- [ ] Add currency-aware pricing only for currencies approved on the merchant account. Current checkout supports NGN only.
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

## Current launch constraints

- The Supabase project is on the Free plan and in the US West region.
- Paystack checkout remains test-only. No live charges or seller settlements are enabled.
- Checkout currency is currently NGN; international currency settlement is not implemented.
- Seller payout onboarding and split settlements are not implemented.
- School plan and some subscription entitlement controls remain in development.
- The latest code has passed static JavaScript syntax checks, but the latest interface changes still require live browser testing.

## Release rule

Do not announce a genuine international production launch until the legal, business, provider-approval, security, backup, payment, seller-settlement and end-to-end testing items above have been completed and signed off.
