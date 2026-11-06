import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { verifyLegacyPaystackSignature, verifyModernPaystackSignature } from './signature.ts'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

serve(async req => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  try {
    const body = await req.text()
    const mode = Deno.env.get('PAYSTACK_MODE') || 'test'
    const secret = Deno.env.get('PAYSTACK_SECRET_KEY') || ''
    const webhookSecret = Deno.env.get('PAYSTACK_WEBHOOK_SECRET') || ''
    const previousWebhookSecret = Deno.env.get('PAYSTACK_WEBHOOK_SECRET_PREVIOUS') || ''
    if (mode !== 'test' || !secret.startsWith('sk_test_')) {
      console.error('Paystack webhook is locked to test mode; live events are disabled.')
      return new Response('Test-mode webhook only; live events are disabled', { status: 503 })
    }

    const modernSignature = req.headers.get('paystack-signature') || ''
    let signatureValid = false
    if (modernSignature) {
      const webhookSecrets = [webhookSecret, previousWebhookSecret].filter(value => value.startsWith('whsec_'))
      if (!webhookSecrets.length) {
        console.error('Paystack webhook signing secret is not configured.')
        return new Response('Webhook signing secret is not configured', { status: 503 })
      }
      signatureValid = await verifyModernPaystackSignature(body, modernSignature, webhookSecrets)
      const timestampField = modernSignature.split(',').map(part => part.trim()).find(part => part.startsWith('t='))
      const timestamp = timestampField ? Number(timestampField.slice(2)) : NaN
      if (!Number.isSafeInteger(timestamp) || Math.abs(Math.floor(Date.now() / 1000) - timestamp) > 300) {
        return new Response('Expired or invalid webhook timestamp', { status: 401 })
      }
    } else if (mode === 'test') {
      // Legacy test-mode compatibility only. Live mode requires Paystack's timestamped whsec_ signature.
      const legacySignature = req.headers.get('x-paystack-signature') || ''
      signatureValid = await verifyLegacyPaystackSignature(body, legacySignature, secret)
    }
    if (!signatureValid) return new Response('Invalid signature', { status: 401 })

    const expectedDomain = 'test'
    const event = JSON.parse(body)
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    if (event.event === 'charge.success') {
      const charge = event.data
      if (!charge?.reference || charge.status !== 'success' || charge.domain !== expectedDomain) {
        console.error('Ignoring a wrong-environment or invalid Paystack charge-success event.')
        return json({ received: true, processed: false })
      }
      const { data: payment, error: lookupError } = await admin.from('payments')
        .select('user_id,amount_minor,currency,status,purpose,metadata')
        .eq('reference', charge.reference).maybeSingle()
      if (lookupError) throw lookupError
      if (!payment) return json({ received: true, processed: false })
      let metadataMatches = charge.metadata?.user_id === payment.user_id
      if (payment.purpose === 'product_purchase') {
        metadataMatches = metadataMatches &&
          charge.metadata?.product_id === payment.metadata?.product_id &&
          charge.metadata?.seller_id === payment.metadata?.seller_id
      } else if (payment.purpose === 'course_enrollment') {
        metadataMatches = metadataMatches &&
          charge.metadata?.course_id === payment.metadata?.course_id &&
          charge.metadata?.instructor_id === payment.metadata?.instructor_id
      }
      if (!metadataMatches || Number(charge.amount) !== Number(payment.amount_minor) ||
          String(charge.currency || '').toUpperCase() !== String(payment.currency || '').trim().toUpperCase()) {
        console.error('Paystack metadata, amount or currency did not match the pending payment.')
        return json({ received: true, processed: false })
      }
      const rpcName = payment.purpose === 'product_purchase' ? 'confirm_product_payment'
        : payment.purpose === 'course_enrollment' ? 'confirm_course_payment'
        : 'confirm_paystack_payment'
      const { data: processed, error: processError } = await admin.rpc(rpcName, {
        p_reference: charge.reference, p_amount_minor: Number(charge.amount),
        p_currency: String(charge.currency || ''), p_paid_at: charge.paid_at || new Date().toISOString()
      })
      if (processError) throw processError
      return json({ received: true, processed: processed === true })
    }

    if (event.event === 'charge.failed') {
      const reference = event.data?.domain === expectedDomain ? event.data?.reference : null
      if (reference) {
        const { error } = await admin.from('payments').update({ status: 'failed', updated_at: new Date().toISOString() })
          .eq('reference', reference).eq('status', 'pending')
        if (error) throw error
      }
    }

    if (event.event === 'refund.processed') {
      const refund = event.data
      const transactionReference = refund?.transaction_reference || refund?.transaction?.reference
      const refundReference = refund?.refund_reference
      const amountMinor = Number(refund?.amount)
      const currency = String(refund?.currency || '').trim().toUpperCase()
      if (refund?.status !== 'processed' || refund?.domain !== expectedDomain ||
          typeof transactionReference !== 'string' || !transactionReference.trim() ||
          typeof refundReference !== 'string' || !refundReference.trim() ||
          !Number.isSafeInteger(amountMinor) || amountMinor <= 0 ||
          !/^[A-Z]{3}$/.test(currency)) {
        console.error('Paystack refund notification did not contain valid environment-specific refund details.')
        return json({ received: true, processed: false })
      }

      const timestamp = [refund.refunded_at, refund.updatedAt, refund.createdAt]
        .find(value => typeof value === 'string' && Number.isFinite(Date.parse(value)))
      const processedAt = timestamp ? new Date(timestamp).toISOString() : new Date().toISOString()
      const { data: result, error } = await admin.rpc('record_paystack_refund', {
        p_transaction_reference: transactionReference,
        p_refund_reference: refundReference,
        p_amount_minor: amountMinor,
        p_currency: currency,
        p_processed_at: processedAt
      })
      if (error) throw error
      return json({ received: true, ...result })
    }

    return json({ received: true })
  } catch (error) {
    console.error('Webhook processing failed:', error)
    return json({ error: 'Webhook processing failed' }, 500)
  }
})
