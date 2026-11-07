SET request.jwt.claim.role = 'service_role';
DO $test$
DECLARE buyer uuid:=gen_random_uuid(); seller uuid:=gen_random_uuid(); v_course_id uuid:=gen_random_uuid();
 v_product_id uuid:=gen_random_uuid(); ref text; result jsonb; v_payment_id uuid;
BEGIN
 INSERT INTO public.profiles(id,account_status) VALUES(buyer,'active'),(seller,'active');
 INSERT INTO public.courses(id,instructor_id,is_published) VALUES(v_course_id,seller,true);
 ref:='GCH-'||gen_random_uuid()::text;
 INSERT INTO public.payments(user_id,reference,amount_minor,currency,status,purpose,metadata,paid_at)
 VALUES(buyer,ref,250000,'NGN','paid','course_enrollment',
 jsonb_build_object('course_id',v_course_id,'instructor_id',seller,'entitlement_blocked_reason','account_not_active'),now()-interval '1 hour');
 SELECT public.recover_blocked_paystack_entitlement(ref,250000,'NGN') INTO result;
 IF result->>'recovered'<>'true' OR NOT EXISTS(SELECT 1 FROM public.enrollments WHERE enrollments.course_id=v_course_id AND student_id=buyer AND revoked_at IS NULL)
 THEN RAISE EXCEPTION 'Course recovery failed: %',result; END IF;
 IF EXISTS(SELECT 1 FROM public.payments WHERE reference=ref AND metadata ? 'entitlement_blocked_reason')
 THEN RAISE EXCEPTION 'Course recovery did not clear the blocked marker'; END IF;

 INSERT INTO public.products(id,seller_id,file_path) VALUES(v_product_id,seller,seller::text||'/'||v_product_id::text||'/asset.pdf');
 ref:='GCH-'||gen_random_uuid()::text;
 INSERT INTO public.payments(user_id,reference,amount_minor,currency,status,purpose,metadata,paid_at)
 VALUES(buyer,ref,120000,'NGN','paid','product_purchase',
 jsonb_build_object('product_id',v_product_id,'seller_id',seller,'entitlement_blocked_reason','account_not_active'),now()-interval '1 hour')
 RETURNING id INTO v_payment_id;
 SELECT public.recover_blocked_paystack_entitlement(ref,120000,'NGN') INTO result;
 IF result->>'recovered'<>'true' OR NOT EXISTS(SELECT 1 FROM public.product_purchases WHERE product_purchases.payment_id=v_payment_id AND currency='NGN')
 THEN RAISE EXCEPTION 'Product recovery/currency binding failed: %',result; END IF;
 IF (SELECT count(*) FROM public.notifications WHERE data->>'payment_reference'=ref)<>2
 THEN RAISE EXCEPTION 'Product recovery did not create buyer and seller notifications'; END IF;
 SELECT public.recover_blocked_paystack_entitlement(ref,120000,'NGN') INTO result;
 IF result->>'recovered'<>'false' OR result->>'reason'<>'not_account_blocked'
 THEN RAISE EXCEPTION 'Repeated product recovery was not safely rejected: %',result; END IF;
 IF (SELECT count(*) FROM public.notifications WHERE data->>'payment_reference'=ref)<>2
 THEN RAISE EXCEPTION 'Repeated recovery duplicated product notifications'; END IF;

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
 jsonb_build_object('course_id',v_course_id,'instructor_id',seller,'entitlement_blocked_reason','account_not_active'),now()-interval '1 hour')
 RETURNING id INTO v_payment_id;
 INSERT INTO public.payment_refunds(payment_id,amount_minor,status) VALUES(v_payment_id,10000,'processed');
 SELECT public.recover_blocked_paystack_entitlement(ref,10000,'NGN') INTO result;
 IF result->>'recovered'<>'false' OR result->>'reason'<>'fully_refunded'
 THEN RAISE EXCEPTION 'Fully refunded payment was not blocked: %',result; END IF;

 ref:='GCH-'||gen_random_uuid()::text;
 INSERT INTO public.payments(user_id,reference,amount_minor,currency,status,purpose,metadata,paid_at)
 VALUES(buyer,ref,99000,'NGN','paid','subscription',
 jsonb_build_object('plan_code','pro','billing_interval','monthly','entitlement_blocked_reason','account_not_active'),now()-interval '2 months');
 SELECT public.recover_blocked_paystack_entitlement(ref,99000,'NGN') INTO result;
 IF result->>'recovered'<>'false' OR result->>'reason'<>'subscription_period_expired'
 THEN RAISE EXCEPTION 'Expired subscription recovery was not blocked: %',result; END IF;

 UPDATE public.profiles SET account_status='suspended' WHERE id=buyer;
 ref:='GCH-'||gen_random_uuid()::text;
 INSERT INTO public.payments(user_id,reference,amount_minor,currency,status,purpose,metadata,paid_at)
 VALUES(buyer,ref,50000,'NGN','paid','course_enrollment',
 jsonb_build_object('course_id',v_course_id,'instructor_id',seller,'entitlement_blocked_reason','account_not_active'),now());
 SELECT public.recover_blocked_paystack_entitlement(ref,50000,'NGN') INTO result;
 IF result->>'recovered'<>'false' OR result->>'reason'<>'account_not_active'
 THEN RAISE EXCEPTION 'Suspended account recovery was not blocked: %',result; END IF;
 RAISE NOTICE 'Blocked-payment recovery integration cases passed.';
END;
$test$;
