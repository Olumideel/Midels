import { verifyLegacyPaystackSignature, verifyModernPaystackSignature } from './signature.ts'

const enc = new TextEncoder()
const secret = 'whsec_unit_secret'
const testKey = 'sk_test_unit_key'
const body = JSON.stringify({ event: 'ping' })
const now = 1800000000

async function sign(keyText: string, value: string | Uint8Array) {
  const key = await crypto.subtle.importKey('raw', enc.encode(keyText), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign'])
  const digest = await crypto.subtle.sign('HMAC', key, typeof value === 'string' ? enc.encode(value) : value)
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}

Deno.test('modern signature validates exact body bytes and timestamp', async () => {
  const d = await sign(secret, now + '.' + body)
  if (!await verifyModernPaystackSignature(body, `t=${now},v1=whk_current:${d}`, secret, now)) throw Error('valid signature rejected')
  if (await verifyModernPaystackSignature(body + ' ', `t=${now},v1=whk_current:${d}`, secret, now)) throw Error('tampered body accepted')
  if (await verifyModernPaystackSignature(body, `t=${now - 301},v1=whk_current:${d}`, secret, now)) throw Error('stale signature accepted')
})

Deno.test('modern signature preserves exact non-ASCII raw bytes', async () => {
  const raw = enc.encode('{"message":"café 🍲","amount":1.50}')
  const prefix = enc.encode(now + '.')
  const signed = new Uint8Array(prefix.length + raw.length)
  signed.set(prefix)
  signed.set(raw, prefix.length)
  const digest = await sign(secret, signed)
  if (!await verifyModernPaystackSignature(raw, `t=${now},v1=whk_current:${digest}`, secret, now)) {
    throw Error('valid raw-byte signature rejected')
  }
  const changed = enc.encode('{"message":"cafe 🍲","amount":1.50}')
  if (await verifyModernPaystackSignature(changed, `t=${now},v1=whk_current:${digest}`, secret, now)) {
    throw Error('modified raw bytes accepted')
  }
})

Deno.test('supports rotation and candidate iteration', async () => {
  const old = 'whsec_old'
  const current = 'whsec_current'
  const payload = now + '.' + body
  const d1 = await sign(old, payload)
  const d2 = await sign(current, payload)
  if (!await verifyModernPaystackSignature(body, `t=${now},v1=whk_old:${d1},v1=whk_new:${d2}`, [current, old], now)) {
    throw Error('rotation overlap failed')
  }
  if (await verifyModernPaystackSignature(body, `t=${now},v1=whk_old:${d1}`, current, now)) {
    throw Error('old key accepted without overlap')
  }
})

Deno.test('legacy signature is restricted to test keys', async () => {
  const d = await sign(testKey, body)
  if (!await verifyLegacyPaystackSignature(body, d, testKey)) throw Error('test signature rejected')
  if (await verifyLegacyPaystackSignature(body, d, 'sk_live_not_allowed')) throw Error('live legacy signature accepted')
})
