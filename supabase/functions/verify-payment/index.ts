import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { resolvePaystackConfig } from '../_shared/paystack/config.ts'
import { paystackMetadataMatches } from '../_shared/paystack/metadata.ts'

const cors = {
  'Access-Control-Allow-Origin': 'https://olumideel.github.io',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin'
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const confirmationRpc = (purpose: string) =>
  purpose === 'product_purchase' ? 'confirm_product_payment'
    : purpose === 'course_enrollment' ? 'confirm_course_payment'
    : 'confirm_paystack_payment'

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
    const mode = Deno.env.get('PAYSTACK_MODE')
    const secret = Deno.env.get('PAYSTACK_SECRET_KEY') || ''
    const paystack = resolvePaystackConfig(mode, secret)
    if (!paystack.valid) {
      console.error('Paystack verification configuration is invalid for the selected environment.')
      return json({ error: 'Payment verification is not configured for the selected environment.' }, 503)
    }

    const { data: payment, error: lookupError } = await admin.from('payments')
      .select('user_id,amount_minor,currency,status,purpose,metadata')
      .eq('reference', reference).eq('user_id', user.id).maybeSingle()
    if (lookupError) throw lookupError
    if (!payment) return json({ error: 'Payment record not found.' }, 404)
    if ((payment.metadata?.paystack_mode && payment.metadata.paystack_mode !== paystack.mode) ||
        (paystack.mode === 'live' && payment.metadata?.paystack_mode !== 'live')) {
      return json({ error: 'Payment was initialized in a different environment.' }, 409)
    }

    const rpcName = confirmationRpc(payment.purpose)

    // A settled payment must still pass the database's idempotent entitlement check.
    // This prevents stale "paid" rows from reporting verified access after a refund,
    // revoked course enrollment, or missing subscription/product entitlement.
    if (payment.status === 'paid') {
      // Recover only payments explicitly blocked because the account was inactive.
      // The service-role RPC rechecks payment, account, refund and purpose-specific metadata.
      if (payment.metadata?.entitlement_blocked_reason === 'account_not_active') {
        const { error: recoveryError } = await admin.rpc('recover_blocked_paystack_entitlement', {
          p_reference: reference,
          p_amount_minor: Number(payment.amount_minor),
          p_currency: String(payment.currency)
        })
        if (recoveryError) throw recoveryError
      }

      const { data: entitlementValid, error: entitlementError } = await admin.rpc(rpcName, {
        p_reference: reference,
        p_amount_minor: Number(payment.amount_minor),
        p_currency: String(payment.currency),
        p_paid_at: new Date().toISOString()
      })
      if (entitlementError) throw entitlementError
      return json({
        status: 'paid',
        verified: entitlementValid === true,
        purpose: payment.purpose,
        ...(entitlementValid === true ? {} : { error: 'Payment is settled, but its entitlement is unavailable.' })
      }, entitlementValid === true ? 200 : 409)
    }

    if (payment.status !== 'pending') return json({ status: payment.status, verified: false, purpose: payment.purpose })
    const response = await fetch('https://api.paystack.co/transaction/verify/' + encodeURIComponent(reference), {
      headers: { Authorization: 'Bearer ' + secret }
    })
    const result = await response.json()
    if (!response.ok || !result?.status || !result?.data) {
      return json({ status: 'pending', verified: false, purpose: payment.purpose })
    }
    const charge = result.data
    if (charge.domain !== paystack.expectedDomain) {
      console.error('Paystack verification returned a transaction from the wrong environment; no entitlement was granted.')
      return json({ error: 'The payment environment did not match this application configuration.' }, 409)
    }
    if (charge.status !== 'success') return json({ status: charge.status || 'pending', verified: false, purpose: payment.purpose })

    const metadataMatches = paystackMetadataMatches(
      payment.purpose, payment.metadata, charge.metadata, user.id
    )
    if (charge.reference !== reference ||
        Number(charge.amount) !== Number(payment.amount_minor) ||
        String(charge.currency || '').toUpperCase() !== String(payment.currency || '').trim().toUpperCase() ||
        !metadataMatches) {
      console.error('Paystack verification details did not match the authenticated payment.')
      return json({ error: 'Payment verification details did not match.' }, 409)
    }

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
