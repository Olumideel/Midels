# Supabase production migration ledger audit

Audit date: 7 November 2026 (UTC)
Project: `sdbgrnixnnybaqhunlmh`

## Observed production ledger

A read-only Supabase migration-history query returned the following versions, in order:

```text
20260919115122 global_culinary_hub_production_baseline
20260919115137 security_hardening_baseline
20261102173242 add_profile_picture_storage
20261102180329 secure_paystack_subscription_activation
20261102180428 tighten_content_and_messaging_policies
20261102180559 consolidate_friend_request_update_policy
20261102180722 harden_dm_creation_and_concurrency
20261102180830 validate_paid_amount_on_idempotent_webhooks
20261102192220 culinary_learning_foundation
20261102192353 learning_platform_foreign_key_indexes
20261102192359 lock_assessment_attempt_scoring
20261102192446 lesson_progress_upsert_policy
20261102192523 restrict_learning_content_to_published_courses
20261102193626 move_citext_to_extensions_schema
20261102194451 build_assessment_grading_and_certificates
20261102194658 lock_published_course_assessments
20261102194708 secure_assessment_publication
20261102203229 build_chef_storefront_digital_purchases
20261102203350 restrict_digital_downloads_to_paid_purchases
20261102203448 enable_paid_course_enrolment_and_revoke_refunded_access
20261102213006 platform_admin_registry_index
20261102213258 increase_certificate_code_entropy
20261102213606 member_privacy_request_workflow
20261102213748 index_privacy_request_resolver
20261106112516 enforce_academy_draft_editing_and_publication_readiness
20261106112540 harden_course_publication_trigger_insert_handling
20261106113401 restrict_assessment_creation_to_drafts
20261106115915 harden_paystack_refund_accounting
20261106120211 enforce_active_account_payment_and_academy_guards
20261106120813 block_suspended_dm_senders
20261106121646 enforce_active_account_rls_gate
```

## Repository comparison

The `main` branch's `supabase/migrations/` directory currently contains only these seven files:

- `20261106112516_enforce_academy_draft_editing_and_publication_readiness.sql`
- `20261106112540_harden_course_publication_trigger_insert_handling.sql`
- `20261106113401_restrict_assessment_creation_to_drafts.sql`
- `20261106121500_enforce_active_account_payment_and_academy_guards.sql`
- `20261106123000_block_suspended_dm_senders.sql`
- `20261106124500_enforce_active_account_rls_gate.sql`
- `20261106130000_harden_paystack_refund_accounting.sql`

This is not a one-file discrepancy. The repository is missing the original baseline and numerous earlier migrations already recorded in production. It also contains three later security migrations under versions `20261106121500`, `20261106123000`, and `20261106124500`, whereas production records the corresponding migration names at `20261106120211`, `20261106120813`, and `20261106121646`. The refund migration is recorded in production at `20261106115915`, while the repository names it `20261106130000`.

The exact historical SQL for the missing migrations must be recovered from trusted Git history, release artifacts or a verified schema backup. Do not recreate historical migrations from names alone.

## Preview failure evidence

Supabase workflow logs for the linked `main` branch report:

```text
Remote migration versions not found in local migrations directory.
```

This is consistent with the ledger/file mismatch above. The project currently exposes only the production `main` branch; its branch status is `MIGRATIONS_FAILED`. No isolated development branch was available during this audit.

## Safe recovery sequence

1. Recover the exact historical migration files from trusted source control or backup, preserving their original versions and contents.
2. Compare every local migration version with the production ledger and verify that each already-applied version has its original SQL file.
3. Resolve the timestamp/name conflicts using a reviewed migration-history reconciliation plan. Do not rename or duplicate an already-applied migration.
4. Add and validate the correct Supabase CLI project configuration, checking current CLI major-version behavior before running commands.
5. Recreate an isolated PostgreSQL/Supabase environment and replay the complete chain from an empty database.
6. Compare the replayed schema and relevant function definitions with production using read-only inspection.
7. Run refund/repurchase, repeat-payment, webhook idempotency, RLS, and course-entitlement regression tests.
8. Only then request an approved production release window. No `migration repair`, reset, or production `db push` is an acceptable shortcut.

## Safety status

This audit is read-only. It does not modify production schema, migration history, secrets, Edge Functions, payment records, or customer/student data. Live Paystack charges remain disabled.


## Additional payment-entitlement findings (7 November 2026)

Read-only inspection of the production function definitions and table metadata confirmed a course refund/repurchase race:

- `confirm_course_payment` reuses the unique canonical enrollment for a `(course_id, student_id)` pair and clears `revoked_at` on a later successful purchase.
- `record_paystack_refund` currently revokes that enrollment and the student's course certificate by course/student, without checking whether another valid paid purchase still backs access.
- Therefore, after purchase A is refunded and purchase B restores the shared enrollment, a delayed or replayed full-refund event for A can revoke access associated with B.
- `lesson_progress` and `course_certificates` reference the canonical `enrollment_id`; a per-purchase enrollment redesign is not a safe drop-in change.

The webhook source validates test-domain refund notifications and delegates accounting to `record_paystack_refund`. The durable correction must therefore be made in the database entitlement transition, not only in webhook parsing.

### Required regression coverage before release

- Purchase A → full refund A → purchase B → replay/delayed duplicate refund A; B must retain access.
- Concurrent refund and repurchase for the same student/course.
- Partial refunds and multiple partial refunds that cumulatively reach the original amount.
- Duplicate refund reference with mismatched payment, amount or currency.
- Certificate lifecycle and preservation of lesson progress across refund/repurchase.

A lower-risk design to evaluate is to serialize refund and confirmation transitions with the same transaction-scoped student/course lock, retain the canonical enrollment/progress row, and revoke it only when no other qualifying paid purchase remains. Certificate handling needs an explicit policy rather than a broad course/student revocation.

This is a verified defect and a repair design, **not a completed code fix**. It is tracked in [issue #49](https://github.com/Olumideel/Midels/issues/49). Production remains unchanged.


## Payment verification consistency finding (7 November 2026)

A read-only review of `supabase/functions/verify-payment/index.ts` and its frontend caller in `app.js` found a second, related defect:

- When a payment row is already marked `paid`, the verification Edge Function immediately returns `{ status: 'paid', verified: true, purpose }`.
- That early return does not check whether the associated entitlement remains active.
- The frontend interprets this response as a successful purchase and displays a course-enrollment, product-ready, or subscription-active success message.
- A fully refunded course payment can therefore be reported as successful even after the enrollment was revoked. This is a misleading verification result even if the subsequent dashboard query correctly withholds access.

The issue is tracked in [issue #50](https://github.com/Olumideel/Midels/issues/50) and linked to the refund/repurchase race in [issue #49](https://github.com/Olumideel/Midels/issues/49).

### Required correction and regression coverage

Do not simply remove the early return. Define purpose-specific entitlement checks first:

- Course: active canonical enrollment backed by at least one qualifying paid, non-refunded originating course payment.
- Digital product: exact purchase row exists, is not refunded, and references the same paid payment.
- Subscription: subscription is active, within its valid period, and associated with the expected provider reference.

Return a distinct non-success result when the payment was historically paid but no longer grants access. Add tests for refunded course/product purchases, cancelled or expired subscriptions, ordinary active purchases, and the purchase-A/refund-A/repurchase-B/delayed-refund-A sequence.

Repository searches during this pass did not locate an existing test suite covering these payment/refund paths. This is not proof that no external test environment exists, but it means no regression suite has yet been demonstrated. The current migration-history mismatch also prevents a trustworthy full database replay in the available workflow.

This finding is a verified code-path defect and test requirement, **not a completed fix**. No production code, database, payment, enrollment, certificate, secret, or Edge Function was changed.
