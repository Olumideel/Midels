import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { resolvePaystackConfig } from '../_shared/paystack/config.ts'
import { verifyLegacyPaystackSignature, verifyModernPaystackSignature } from './signature.ts'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

serve(async req => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  try {
    const rawBody = new Uint8Array(await req.arrayBuffer())
    const body = new TextDecoder().decode(rawBody)
    const mode = Deno.env.get('PAYSTACK_MODE')
    const secret = Deno.env.get('PAYSTACK_SECRET_KEY') || ''
    const paystack = resolvePaystackConfig(mode, secret)
    if (!paystack.valid) {
      console.error('Paystack webhook configuration is invalid for the selected environment.')
      return new Response('Webhook environment is not configured', { status: 503 })
    }
    const modernHeader = req.headers.get('paystack-signature') || ''
    let signatureValid = false
    if (modernHeader) {
      const current = Deno.env.get('PAYSTACK_WEBHOOK_SECRET') || ''
      const previous = Deno.env.get('PAYSTACK_WEBHOOK_SECRET_PREVIOUS') || ''
      const signingSecrets = [current, previous].filter(value => value.startsWith('whsec_'))
      if (!signingSecrets.length) return new Response('Webhook signing secret is not configured', { status: 503 })
      signatureValid = await verifyModernPaystackSignature(rawBody, modernHeader, signingSecrets)
    } else if (paystack.mode === 'test') {
      // Backward compatibility is intentionally test-only. Live webhooks require timestamped whsec_ signatures.
      signatureValid = await verifyLegacyPaystackSignature(rawBody, req.headers.get('x-paystack-signature') || '', secret)
    }
    if (!signatureValid) return new Response('Invalid signature', { status: 401 })

    const event = JSON.parse(body)
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    if (event.event === 'charge.success') {
      const charge = event.data
      if (!charge?.reference || charge.status !== 'success' || charge.domain !== paystack.expectedDomain) {
        console.error('Ignoring a non-test or invalid Paystack charge-success event.')
        return json({ received: true, processed: false })
      }
      const { data: payment, error: lookupError } = await admin.from('payments')
        .select('provider,user_id,amount_minor,currency,status,purpose,metadata')
        .eq('reference', charge.reference).eq('provider', 'paystack').maybeSingle()
      if (lookupError) throw lookupError
      if (!payment) return json({ received: true, processed: false })
      if ((payment.metadata?.paystack_mode && payment.metadata.paystack_mode !== paystack.mode) ||
          (paystack.mode === 'live' && payment.metadata?.paystack_mode !== 'live')) {
        console.error('Webhook payment environment does not match the original checkout environment.')
        return json({ received: true, processed: false })
      }
      let metadataMatches = payment.provider === 'paystack' && charge.metadata?.user_id === payment.user_id
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
      const reference = event.data?.domain === paystack.expectedDomain ? event.data?.reference : null
      if (reference) {
        const { data: failedPayment, error: failedLookupError } = await admin.from('payments')
          .select('metadata').eq('reference', reference).eq('provider', 'paystack').maybeSingle()
        if (failedLookupError) throw failedLookupError
        const environmentMatches = failedPayment &&
          ((!failedPayment.metadata?.paystack_mode && paystack.mode === 'test') ||
            failedPayment.metadata?.paystack_mode === paystack.mode)
        if (environmentMatches) {
          const { error } = await admin.from('payments').update({ status: 'failed', updated_at: new Date().toISOString() })
            .eq('reference', reference).eq('provider', 'paystack').eq('status', 'pending')
          if (error) throw error
        }
      }
    }

    if (event.event === 'refund.processed') {
      const refund = event.data
      const transactionReference = refund?.transaction_reference || refund?.transaction?.reference
      const refundReference = refund?.refund_reference
      const amountMinor = Number(refund?.amount)
      const currency = String(refund?.currency || '').trim().toUpperCase()
      if (refund?.status !== 'processed' || refund?.domain !== paystack.expectedDomain ||
          typeof transactionReference !== 'string' || !transactionReference.trim() ||
          typeof refundReference !== 'string' || !refundReference.trim() ||
          !Number.isSafeInteger(amountMinor) || amountMinor <= 0 ||
          !/^[A-Z]{3}$/.test(currency)) {
        console.error('Paystack refund notification did not contain valid test-mode refund details.')
        return json({ received: true, processed: false })
      }

      const { data: refundPayment, error: refundPaymentLookupError } = await admin.from('payments')
        .select('metadata').eq('reference', transactionReference).eq('provider', 'paystack').maybeSingle()
      if (refundPaymentLookupError) throw refundPaymentLookupError
      const refundEnvironmentMatches = refundPayment &&
        ((!refundPayment.metadata?.paystack_mode && paystack.mode === 'test') ||
          refundPayment.metadata?.paystack_mode === paystack.mode)
      if (!refundEnvironmentMatches) {
        console.error('Paystack refund environment does not match the original checkout environment.')
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
