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
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  try {
    const authorization = req.headers.get('Authorization') || ''
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authorization } }
    })
    const { data: { user }, error: authError } = await userClient.auth.getUser()
    if (authError || !user) return json({ error: 'Not authenticated' }, 401)
    const { reference } = await req.json()
    if (typeof reference !== 'string' || !/^GCH-[0-9a-f-]{36}$/i.test(reference)) {
      return json({ error: 'Invalid payment reference.' }, 400)
    }

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: profile, error: profileError } = await admin.from('profiles')
      .select('account_status').eq('id', user.id).maybeSingle()
    if (profileError) throw profileError
    if (profile?.account_status !== 'active') {
      return json({ error: 'Your account is not active. Payment verification is unavailable.' }, 403)
    }
    const mode = Deno.env.get('PAYSTACK_MODE') || 'test'
    const secret = Deno.env.get('PAYSTACK_SECRET_KEY') || ''
    if (!isPaystackTestModeConfigured(mode, secret)) {
      console.error('Paystack verification is locked to test mode; live payments are disabled.')
      return json({ error: 'Verification is restricted to Paystack test mode. Live payments are disabled.' }, 503)
    }

    const { data: payment, error: lookupError } = await admin.from('payments')
      .select('user_id,amount_minor,currency,status,purpose,metadata')
      .eq('reference', reference).eq('user_id', user.id).maybeSingle()
    if (lookupError) throw lookupError
    if (!payment) return json({ error: 'Payment record not found.' }, 404)
    if (payment.status === 'paid') return json({ status: 'paid', verified: true, purpose: payment.purpose })
    if (payment.status !== 'pending') return json({ status: payment.status, verified: false, purpose: payment.purpose })
    const response = await fetch('https://api.paystack.co/transaction/verify/' + encodeURIComponent(reference), {
      headers: { Authorization: 'Bearer ' + secret }
    })
    const result = await response.json()
    if (!response.ok || !result?.status || !result?.data) {
      return json({ status: 'pending', verified: false, purpose: payment.purpose })
    }
    const charge = result.data
    const expectedDomain = 'test'
    if (charge.domain !== expectedDomain) {
      console.error('Paystack verification returned a transaction from the wrong environment; no entitlement was granted.')
      return json({ error: 'The payment environment did not match this application configuration.' }, 409)
    }
    if (charge.status !== 'success') return json({ status: charge.status || 'pending', verified: false, purpose: payment.purpose })

    let metadataMatches = charge.metadata?.user_id === user.id
    if (payment.purpose === 'product_purchase') {
      metadataMatches = metadataMatches &&
        charge.metadata?.product_id === payment.metadata?.product_id &&
        charge.metadata?.seller_id === payment.metadata?.seller_id
    } else if (payment.purpose === 'course_enrollment') {
      metadataMatches = metadataMatches &&
        charge.metadata?.course_id === payment.metadata?.course_id &&
        charge.metadata?.instructor_id === payment.metadata?.instructor_id
    }
    if (charge.reference !== reference ||
        Number(charge.amount) !== Number(payment.amount_minor) ||
        String(charge.currency || '').toUpperCase() !== String(payment.currency || '').trim().toUpperCase() ||
        !metadataMatches) {
      console.error('Paystack verification details did not match the authenticated payment.')
      return json({ error: 'Payment verification details did not match.' }, 409)
    }

    const rpcName = payment.purpose === 'product_purchase' ? 'confirm_product_payment'
      : payment.purpose === 'course_enrollment' ? 'confirm_course_payment'
      : 'confirm_paystack_payment'
    const { data: processed, error: processError } = await admin.rpc(rpcName, {
      p_reference: reference, p_amount_minor: Number(charge.amount),
      p_currency: String(charge.currency), p_paid_at: charge.paid_at || new Date().toISOString()
    })
    if (processError) throw processError
    return json({ status: processed ? 'paid' : 'pending', verified: processed === true, purpose: payment.purpose })
  } catch (error) {
    console.error('Payment verification failed:', error)
    return json({ error: 'Unable to verify payment right now. Please refresh later.' }, 500)
  }
})
