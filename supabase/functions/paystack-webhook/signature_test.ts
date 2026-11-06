import {
  verifyLegacyPaystackSignature,
  verifyModernPaystackSignature,
} from './signature.ts'

const encoder = new TextEncoder()
const signingSecret = 'whsec_unit_test_signing_secret'
const testSecret = 'sk_test_unit_test_secret'
const body = JSON.stringify({ event: 'charge.success', data: { reference: 'unit-ref' } })
const now = 1_800_000_000

async function sign(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-512' }, false, ['sign'])
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)))
  return Array.from(signature, byte => byte.toString(16).padStart(2, '0')).join('')
}

Deno.test('accepts a valid timestamped Paystack v1 signature', async () => {
  const digest = await sign(signingSecret, now + '.' + body)
  const valid = await verifyModernPaystackSignature(body, `t=${now},v1=whk_current:${digest}`, signingSecret, now)
  if (!valid) throw new Error('Expected valid modern signature to pass')
})

Deno.test('rejects a modified raw body', async () => {
  const digest = await sign(signingSecret, now + '.' + body)
  const valid = await verifyModernPaystackSignature(body + ' ', `t=${now},v1=whk_current:${digest}`, signingSecret, now)
  if (valid) throw new Error('Modified body must fail verification')
})

Deno.test('rejects expired and malformed timestamps', async () => {
  const digest = await sign(signingSecret, now + '.' + body)
  const expired = await verifyModernPaystackSignature(body, `t=${now - 301},v1=whk_old:${digest}`, signingSecret, now)
  const malformed = await verifyModernPaystackSignature(body, `t=not-a-time,v1=whk_old:${digest}`, signingSecret, now)
  if (expired || malformed) throw new Error('Invalid timestamp must fail verification')
})

Deno.test('accepts a valid v1 signature when an earlier candidate is invalid', async () => {
  const invalidDigest = await sign('whsec_different_signing_secret', now + '.' + body)
  const validDigest = await sign(signingSecret, now + '.' + body)
  const header = `t=${now},v1=whk_candidate:${invalidDigest},v1=whk_current:${validDigest}`
  const valid = await verifyModernPaystackSignature(body, header, signingSecret, now)
  if (!valid) throw new Error('A valid signature must pass even when another v1 candidate is invalid')
})

Deno.test('rejects wrong signing-secret prefix and absent v1 signatures', async () => {
  const wrongPrefix = await verifyModernPaystackSignature(body, `t=${now},v1=abc`, 'sk_test_not_a_webhook_secret', now)
  const missingV1 = await verifyModernPaystackSignature(body, `t=${now}`, signingSecret, now)
  if (wrongPrefix || missingV1) throw new Error('Invalid configuration/header must fail')
})

Deno.test('accepts a valid legacy test signature and rejects live-key use', async () => {
  const digest = await sign(testSecret, body)
  const valid = await verifyLegacyPaystackSignature(body, digest, testSecret)
  const liveKey = await verifyLegacyPaystackSignature(body, digest, 'sk_live_unit_test_secret')
  if (!valid || liveKey) throw new Error('Legacy verification must be test-key-only')
})

Deno.test('supports overlapping webhook signing secrets during rotation', async () => {
  const previousSecret = 'whsec_previous_rotation_secret'
  const currentSecret = 'whsec_current_rotation_secret'
  const previousDigest = await sign(previousSecret, now + '.' + body)
  const currentDigest = await sign(currentSecret, now + '.' + body)
  const header = `t=${now},v1=whk_previous:${previousDigest},v1=whk_current:${currentDigest}`
  const valid = await verifyModernPaystackSignature(body, header, [currentSecret, previousSecret], now)
  const rejected = await verifyModernPaystackSignature(body, header, currentSecret, now)
  if (!valid || rejected) throw new Error('Rotation overlap must accept the previous secret only when it is configured')
})
