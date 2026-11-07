CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TYPE public.account_status AS ENUM ('active','suspended','deleted');
CREATE TYPE public.notification_type AS ENUM ('system');
CREATE TABLE public.profiles(id uuid PRIMARY KEY, account_status public.account_status NOT NULL DEFAULT 'active');
CREATE TABLE public.payments(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.profiles(id),
 provider text NOT NULL DEFAULT 'paystack', reference text NOT NULL UNIQUE,
 amount_minor bigint NOT NULL, currency character(3) NOT NULL DEFAULT 'NGN',
 status text NOT NULL DEFAULT 'pending', purpose text NOT NULL, metadata jsonb NOT NULL DEFAULT '{}',
 paid_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.payment_refunds(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payment_id uuid NOT NULL REFERENCES public.payments(id),
 amount_minor bigint NOT NULL, status text NOT NULL DEFAULT 'processed'
);
CREATE TABLE public.courses(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), instructor_id uuid NOT NULL, is_published boolean NOT NULL DEFAULT false);
CREATE TABLE public.enrollments(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), course_id uuid NOT NULL REFERENCES public.courses(id),
 student_id uuid NOT NULL REFERENCES public.profiles(id), revoked_at timestamptz,
 UNIQUE(course_id,student_id)
);
CREATE TABLE public.products(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seller_id uuid NOT NULL, file_path text, title text NOT NULL DEFAULT 'Test product');
CREATE TABLE public.product_purchases(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), product_id uuid NOT NULL REFERENCES public.products(id),
 buyer_id uuid NOT NULL REFERENCES public.profiles(id), seller_id uuid NOT NULL REFERENCES public.profiles(id),
 payment_id uuid NOT NULL UNIQUE REFERENCES public.payments(id), amount_minor bigint NOT NULL CHECK(amount_minor>0),
 currency character(3) NOT NULL DEFAULT 'NGN', refunded_at timestamptz,
 CHECK(buyer_id<>seller_id)
);
CREATE TABLE public.notifications(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.profiles(id),
 actor_id uuid REFERENCES public.profiles(id), type public.notification_type NOT NULL,
 title text NOT NULL, body text, data jsonb NOT NULL DEFAULT '{}',
 is_read boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.subscriptions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.profiles(id),
 plan_code text NOT NULL, status text NOT NULL CHECK(status IN ('active','trialing','past_due','cancelled','expired')),
 provider text NOT NULL DEFAULT 'paystack', provider_reference text,
 current_period_start timestamptz, current_period_end timestamptz, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX subscriptions_one_current_per_user ON public.subscriptions(user_id)
 WHERE status IN ('active','trialing','past_due');
