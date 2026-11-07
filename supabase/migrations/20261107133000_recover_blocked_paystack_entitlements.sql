CREATE OR REPLACE FUNCTION public.recover_blocked_paystack_entitlement(p_reference text,p_amount_minor bigint,p_currency text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $f$
DECLARE
 p public.payments%rowtype; c public.courses%rowtype; d public.products%rowtype;
 refunded bigint; paid timestamptz; finish timestamptz; plan text; interval_name text;
 s public.subscriptions%rowtype; eid uuid; purchase_id uuid;
BEGIN
 IF coalesce(current_setting('request.jwt.claim.role',true),'') <> 'service_role' THEN RAISE EXCEPTION 'not authorized'; END IF;
 SELECT * INTO p FROM public.payments WHERE reference=p_reference FOR UPDATE;
 IF NOT FOUND OR p.provider IS DISTINCT FROM 'paystack' OR p.status<>'paid'
 OR p.amount_minor<>p_amount_minor OR upper(trim(p.currency::text))<>upper(trim(p_currency))
 THEN RETURN jsonb_build_object('recovered',false,'reason','payment_mismatch'); END IF;
 IF p.metadata->>'entitlement_blocked_reason' IS DISTINCT FROM 'account_not_active'
 THEN RETURN jsonb_build_object('recovered',false,'reason','not_account_blocked'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p.user_id AND account_status::text='active')
 THEN RETURN jsonb_build_object('recovered',false,'reason','account_not_active'); END IF;
 SELECT coalesce(sum(amount_minor),0) INTO refunded FROM public.payment_refunds
 WHERE payment_id=p.id AND status='processed';
 IF refunded>=p.amount_minor THEN RETURN jsonb_build_object('recovered',false,'reason','fully_refunded'); END IF;
 paid:=p.paid_at;
 IF paid IS NULL THEN RETURN jsonb_build_object('recovered',false,'reason','missing_paid_timestamp'); END IF;
 IF p.purpose='course_enrollment' THEN
  IF nullif(p.metadata->>'course_id','') IS NULL OR nullif(p.metadata->>'instructor_id','') IS NULL
  THEN RETURN jsonb_build_object('recovered',false,'reason','invalid_course_metadata'); END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p.metadata->>'course_id'),hashtext(p.user_id::text));
  SELECT * INTO c FROM public.courses WHERE id::text=p.metadata->>'course_id'
  AND instructor_id::text=p.metadata->>'instructor_id' AND is_published=true;
  IF NOT FOUND OR c.instructor_id=p.user_id THEN RETURN jsonb_build_object('recovered',false,'reason','course_unavailable'); END IF;
  INSERT INTO public.enrollments(course_id,student_id,revoked_at) VALUES(c.id,p.user_id,NULL)
  ON CONFLICT(course_id,student_id) DO UPDATE SET revoked_at=NULL RETURNING id INTO eid;
  -- Do not silently reinstate a previously revoked certificate.
  UPDATE public.payments SET metadata=metadata-'entitlement_blocked_reason'-'entitlement_blocked_at',updated_at=now() WHERE id=p.id;
  RETURN jsonb_build_object('recovered',eid IS NOT NULL,'purpose',p.purpose);
 ELSIF p.purpose='product_purchase' THEN
  SELECT * INTO d FROM public.products WHERE id::text=p.metadata->>'product_id'
  AND seller_id::text=p.metadata->>'seller_id';
  IF NOT FOUND OR d.seller_id=p.user_id OR coalesce(d.file_path,'')=''
  THEN RETURN jsonb_build_object('recovered',false,'reason','product_unavailable'); END IF;
  IF EXISTS(SELECT 1 FROM public.product_purchases WHERE payment_id=p.id AND refunded_at IS NOT NULL)
  THEN RETURN jsonb_build_object('recovered',false,'reason','purchase_refunded'); END IF;
  INSERT INTO public.product_purchases(product_id,buyer_id,seller_id,payment_id,amount_minor,currency)
  VALUES(d.id,p.user_id,d.seller_id,p.id,p.amount_minor,p.currency)
  ON CONFLICT(payment_id) DO NOTHING RETURNING id INTO purchase_id;
  IF NOT EXISTS(SELECT 1 FROM public.product_purchases WHERE payment_id=p.id AND product_id=d.id
  AND buyer_id=p.user_id AND seller_id=d.seller_id AND refunded_at IS NULL)
  THEN RETURN jsonb_build_object('recovered',false,'reason','purchase_conflict'); END IF;
  -- Match the normal checkout notifications, but only emit them when this recovery creates the purchase.
  IF purchase_id IS NOT NULL THEN
   INSERT INTO public.notifications(user_id,actor_id,type,title,body,data)
   VALUES
    (d.seller_id,p.user_id,'system','New digital product sale','Your product "'||d.title||'" has a verified purchase.',
      jsonb_build_object('product_id',d.id,'payment_reference',p.reference)),
    (p.user_id,d.seller_id,'system','Purchase confirmed','Your purchase of "'||d.title||'" is confirmed. Your download is ready.',
      jsonb_build_object('product_id',d.id,'payment_reference',p.reference));
  END IF;
  UPDATE public.payments SET metadata=metadata-'entitlement_blocked_reason'-'entitlement_blocked_at',updated_at=now() WHERE id=p.id;
  RETURN jsonb_build_object('recovered',true,'purpose',p.purpose);
 ELSIF p.purpose='subscription' THEN
  plan:=p.metadata->>'plan_code'; interval_name:=p.metadata->>'billing_interval';
  IF plan NOT IN ('pro','school') OR interval_name NOT IN ('monthly','annual')
  THEN RETURN jsonb_build_object('recovered',false,'reason','invalid_subscription_metadata'); END IF;
  finish:=CASE WHEN interval_name='annual' THEN paid+interval '1 year' ELSE paid+interval '1 month' END;
  IF finish<=now() THEN RETURN jsonb_build_object('recovered',false,'reason','subscription_period_expired'); END IF;
  PERFORM pg_advisory_xact_lock(hashtext('paystack-subscription'),hashtext(p.user_id::text));
  SELECT * INTO s FROM public.subscriptions WHERE user_id=p.user_id
  AND status IN ('active','trialing','past_due') ORDER BY current_period_end DESC NULLS LAST LIMIT 1 FOR UPDATE;
  IF FOUND THEN
   IF s.provider='paystack' AND s.provider_reference=p.reference AND s.plan_code=plan
   AND s.current_period_start=paid AND s.current_period_end=finish THEN
    UPDATE public.payments SET metadata=metadata-'entitlement_blocked_reason'-'entitlement_blocked_at',updated_at=now() WHERE id=p.id;
    RETURN jsonb_build_object('recovered',true,'purpose',p.purpose);
   END IF;
   RETURN jsonb_build_object('recovered',false,'reason','newer_active_subscription_exists');
  END IF;
  INSERT INTO public.subscriptions(user_id,plan_code,status,provider,provider_reference,current_period_start,current_period_end,updated_at)
  VALUES(p.user_id,plan,'active','paystack',p.reference,paid,finish,now());
  UPDATE public.payments SET metadata=metadata-'entitlement_blocked_reason'-'entitlement_blocked_at',updated_at=now() WHERE id=p.id;
  RETURN jsonb_build_object('recovered',true,'purpose',p.purpose);
 END IF;
 RETURN jsonb_build_object('recovered',false,'reason','unsupported_payment_purpose');
END; $f$;
REVOKE ALL ON FUNCTION public.recover_blocked_paystack_entitlement(text,bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.recover_blocked_paystack_entitlement(text,bigint,text) TO service_role;
DO $a$ DECLARE f regprocedure:='public.recover_blocked_paystack_entitlement(text,bigint,text)'::regprocedure;
BEGIN
 IF NOT coalesce((SELECT proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid=f::oid),false)
 OR has_function_privilege('anon',f,'EXECUTE') OR has_function_privilege('authenticated',f,'EXECUTE')
 OR NOT has_function_privilege('service_role',f,'EXECUTE') THEN RAISE EXCEPTION 'Recovery RPC security assertion failed'; END IF;
END; $a$;
