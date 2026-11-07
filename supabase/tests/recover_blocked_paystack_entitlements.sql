SET request.jwt.claim.role = 'service_role';
DO $test$
DECLARE
 buyer uuid:=gen_random_uuid(); seller uuid:=gen_random_uuid(); course_id uuid:=gen_random_uuid();
 product_id uuid:=gen_random_uuid(); ref text; result jsonb; payment_id uuid;
BEGIN
 INSERT INTO public.profiles(id,account_status) VALUES(buyer,'active'),(seller,'active');
 INSERT INTO public.courses(id,instructor_id,is_published) VALUES(course_id,seller,true);
 ref:='GCH-'||gen_random_uuid()::text;
 INSERT INTO public.payments(user_id,reference,amount_minor,currency,status,purpose,metadata,paid_at)
 VALUES(buyer,ref,250000,'NGN','paid','course_enrollment',
 jsonb_build_object('course_id',course_id,'instructor_id',seller,'entitlement_blocked_reason','account_not_active'),now()-interval '1 hour');
 SELECT public.recover_blocked_paystack_entitlement(ref,250000,'NGN') INTO result;
 IF result->>'recovered'<>'true' OR NOT EXISTS(SELECT 1 FROM public.enrollments WHERE course_id=course_id AND student_id=buyer AND revoked_at IS NULL)
 THEN RAISE EXCEPTION 'Course recovery failed: %',result; END IF;

 INSERT INTO public.products(id,seller_id,file_path) VALUES(product_id,seller,seller::text||'/'||product_id::text||'/asset.pdf');
 ref:='GCH-'||gen_random_uuid()::text;
 INSERT INTO public.payments(user_id,reference,amount_minor,currency,status,purpose,metadata,paid_at)
 VALUES(buyer,ref,120000,'NGN','paid','product_purchase',
 jsonb_build_object('product_id',product_id,'seller_id',seller,'entitlement_blocked_reason','account_not_active'),now()-interval '1 hour')
 RETURNING id INTO payment_id;
 SELECT public.recover_blocked_paystack_entitlement(ref,120000,'NGN') INTO result;
 IF result->>'recovered'<>'true' OR NOT EXISTS(SELECT 1 FROM public.product_purchases WHERE payment_id=payment_id AND currency='NGN')
 THEN RAISE EXCEPTION 'Product recovery/currency binding failed: %',result; END IF;

 ref:='GCH-'||gen_random_uuid()::text;
 INSERT INTO public.payments(user_id,reference,amount_minor,currency,status,purpose,metadata,paid_at)
 VALUES(buyer,ref,99000,'NGN','paid','subscription',
 jsonb_build_object('plan_code','pro','billing_interval','monthly','entitlement_blocked_reason','account_not_active'),now()-interval '1 day');
 SELECT public.recover_blocked_paystack_entitlement(ref,99000,'NGN') INTO result;
 IF result->>'recovered'<>'true' OR NOT EXISTS(SELECT 1 FROM public.subscriptions WHERE user_id=buyer AND provider_reference=ref AND status='active' AND current_period_end>now())
 THEN RAISE EXCEPTION 'Subscription recovery failed: %',result; END IF;

 ref:='GCH-'||gen_random_uuid()::text;
 INSERT INTO public.payments(user_id,reference,amount_minor,currency,status,purpose,metadata,paid_at)
 VALUES(buyer,ref,10000,'NGN','paid','course_enrollment',
 jsonb_build_object('course_id',course_id,'instructor_id',seller,'entitlement_blocked_reason','account_not_active'),now()-interval '1 hour')
 RETURNING id INTO payment_id;
 INSERT INTO public.payment_refunds(payment_id,amount_minor,status) VALUES(payment_id,10000,'processed');
 SELECT public.recover_blocked_paystack_entitlement(ref,10000,'NGN') INTO result;
 IF result->>'recovered'<>'false' OR result->>'reason'<>'fully_refunded'
 THEN RAISE EXCEPTION 'Fully refunded payment was not blocked: %',result; END IF;

 UPDATE public.profiles SET account_status='suspended' WHERE id=buyer;
 ref:='GCH-'||gen_random_uuid()::text;
 INSERT INTO public.payments(user_id,reference,amount_minor,currency,status,purpose,metadata,paid_at)
 VALUES(buyer,ref,50000,'NGN','paid','course_enrollment',
 jsonb_build_object('course_id',course_id,'instructor_id',seller,'entitlement_blocked_reason','account_not_active'),now());
 SELECT public.recover_blocked_paystack_entitlement(ref,50000,'NGN') INTO result;
 IF result->>'recovered'<>'false' OR result->>'reason'<>'account_not_active'
 THEN RAISE EXCEPTION 'Suspended account recovery was not blocked: %',result; END IF;
 RAISE NOTICE 'Blocked-payment recovery integration cases passed.';
END;
$test$;
