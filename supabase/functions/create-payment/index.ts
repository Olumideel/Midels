import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { isPaystackTestModeConfigured } from '../_shared/paystack/config.ts'

const cors = {
  'Access-Control-Allow-Origin': 'https://olumideel.github.io',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin'
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' }
  })

const PLANS: Record<string, { monthly: number; annual: number }> = {
  pro: { monthly: 990000, annual: 8316000 },
  school: { monthly: 2990000, annual: 25116000 }
}

serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const authorization = req.headers.get('Authorization') || ''
    const publicClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authorization } } }
    )
    const { data: { user }, error: authError } = await publicClient.auth.getUser()
    if (authError || !user?.email) return json({ error: 'Please sign in to continue.' }, 401)

    const request = await req.json()
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )
    const { data: profile, error: profileError } = await admin.from('profiles')
      .select('account_status').eq('id', user.id).maybeSingle()
    if (profileError) throw profileError
    if (profile?.account_status !== 'active') {
      return json({ error: 'Your account is not active and cannot start a payment.' }, 403)
    }

    let amountMinor: number
    let currency = 'NGN'
    let purpose = 'subscription'
    let metadata: Record<string, unknown>
    let paystackMetadata: Record<string, unknown>

    if (request?.purpose === 'product_purchase') {
      const productId = request?.product_id
      if (typeof productId !== 'string' || !/^[0-9a-f-]{36}$/i.test(productId)) {
        return json({ error: 'Choose a valid product.' }, 400)
      }
      const { data: product, error: productError } = await admin
        .from('products')
        .select('id,title,seller_id,product_type,price_minor,currency,file_path,is_published')
        .eq('id', productId).eq('is_published', true).maybeSingle()
      if (productError) throw productError
      if (!product || !product.file_path ||
          !['recipe_book', 'digital_download'].includes(product.product_type)) {
        return json({ error: 'This digital product is not available for purchase.' }, 404)
      }
      if (product.seller_id === user.id) return json({ error: 'You cannot purchase your own product.' }, 403)
      const { data: priorPurchase, error: priorPurchaseError } = await admin.from('payments')
        .select('id').eq('user_id', user.id).eq('purpose', 'product_purchase')
        .eq('status', 'paid').eq('metadata->>product_id', product.id).limit(1).maybeSingle()
      if (priorPurchaseError) throw priorPurchaseError
      if (priorPurchase) return json({ error: 'You already own this digital product. Find it in My purchases.' }, 409)
      if (!Number.isSafeInteger(Number(product.price_minor)) || Number(product.price_minor) < 100) {
        return json({ error: 'This product has an invalid price.' }, 400)
      }
      currency = String(product.currency || 'NGN').trim().toUpperCase()
      if (currency !== 'NGN') return json({ error: 'This checkout currently supports NGN only.' }, 400)
      amountMinor = Number(product.price_minor)
      purpose = 'product_purchase'
      metadata = { product_id: product.id, seller_id: product.seller_id, product_title: product.title }
      paystackMetadata = {
        user_id: user.id, purpose, product_id: product.id, seller_id: product.seller_id,
        custom_fields: [
          { display_name: 'Digital product', variable_name: 'product', value: product.title },
          { display_name: 'Seller', variable_name: 'seller', value: product.seller_id }
        ]
      }
    } else if (request?.purpose === 'course_enrollment') {
      const courseId = request?.course_id
      if (typeof courseId !== 'string' || !/^[0-9a-f-]{36}$/i.test(courseId)) {
        return json({ error: 'Choose a valid course.' }, 400)
      }
      const { data: course, error: courseError } = await admin
        .from('courses')
        .select('id,title,instructor_id,price_minor,currency,is_published')
        .eq('id', courseId).eq('is_published', true).maybeSingle()
      if (courseError) throw courseError
      if (!course || Number(course.price_minor) < 100) {
        return json({ error: 'This paid course is not available for checkout.' }, 404)
      }
      if (course.instructor_id === user.id) return json({ error: 'You cannot enrol in your own course.' }, 403)
      const { data: existing, error: enrolError } = await admin
        .from('enrollments').select('id').eq('course_id', course.id)
        .eq('student_id', user.id).is('revoked_at', null).maybeSingle()
      if (enrolError) throw enrolError
      if (existing) return json({ error: 'You are already enrolled in this course.' }, 409)
      currency = String(course.currency || 'NGN').trim().toUpperCase()
      if (currency !== 'NGN') return json({ error: 'This checkout currently supports NGN only.' }, 400)
      amountMinor = Number(course.price_minor)
      purpose = 'course_enrollment'
      metadata = { course_id: course.id, instructor_id: course.instructor_id, course_title: course.title }
      paystackMetadata = {
        user_id: user.id, purpose, course_id: course.id, instructor_id: course.instructor_id,
        custom_fields: [
          { display_name: 'Course', variable_name: 'course', value: course.title },
          { display_name: 'Instructor', variable_name: 'instructor', value: course.instructor_id }
        ]
      }
    } else {
      const planCode = request?.plan_code
      const billingInterval = request?.billing_interval
      if (!Object.hasOwn(PLANS, planCode) || !['monthly', 'annual'].includes(billingInterval)) {
        return json({ error: 'Choose a valid plan and billing period.' }, 400)
      }
      amountMinor = PLANS[planCode][billingInterval as 'monthly' | 'annual']
      metadata = { plan_code: planCode, billing_interval: billingInterval }
      paystackMetadata = {
        user_id: user.id, plan_code: planCode, billing_interval: billingInterval,
        custom_fields: [
          { display_name: 'Plan', variable_name: 'plan', value: planCode },
          { display_name: 'Billing period', variable_name: 'billing_period', value: billingInterval }
        ]
      }
    }

    const reference = 'GCH-' + crypto.randomUUID()
    const mode = Deno.env.get('PAYSTACK_MODE') || 'test'
    const secret = Deno.env.get('PAYSTACK_SECRET_KEY') || ''
    if (!isPaystackTestModeConfigured(mode, secret)) {
      console.error('Paystack checkout is locked to test mode; live charges are disabled.')
      return json({ error: 'Checkout is restricted to Paystack test mode. Live charges are disabled.' }, 503)
    }

    const { error: insertError } = await admin.from('payments').insert({
      user_id: user.id, provider: 'paystack', reference, amount_minor: amountMinor,
      currency, status: 'pending', purpose, metadata
    })
    if (insertError) throw insertError

    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + secret, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: user.email, amount: amountMinor, currency, reference,
        callback_url: 'https://olumideel.github.io/Midels/?payment=return',
        metadata: paystackMetadata
      })
    })
    const result = await response.json()
    if (!response.ok || !result?.status || !result?.data?.authorization_url) {
      await admin.from('payments').update({ status: 'failed' }).eq('reference', reference).eq('status', 'pending')
      return json({ error: result?.message || 'Unable to initialize payment.' }, 502)
    }
    return json({ reference, authorization_url: result.data.authorization_url, access_code: result.data.access_code, purpose })
  } catch (error) {
    console.error('Payment initialization failed:', error)
    return json({ error: 'Payment could not be initialized. Please try again.' }, 500)
  }
})
