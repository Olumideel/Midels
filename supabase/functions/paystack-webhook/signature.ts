const encoder = new TextEncoder()

function hexToBytes(hex: string): ArrayBuffer | null {
  if (!/^[a-f0-9]{128}$/i.test(hex)) return null
  const bytes = new Uint8Array(hex.match(/.{2}/g)!.map(byte => parseInt(byte, 16)))
  return bytes.buffer as ArrayBuffer
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-512' }, false, ['verify'])
}

/** Verify Paystack's timestamped v1 signature against the exact raw request body. */
export async function verifyModernPaystackSignature(
  body: string,
  header: string,
  signingSecrets: string | readonly string[],
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const secrets = [...new Set((typeof signingSecrets === 'string' ? [signingSecrets] : signingSecrets)
    .filter(secret => typeof secret === 'string' && secret.startsWith('whsec_')))]
  if (!secrets.length) return false
  const fields = header.split(',').map(part => part.trim())
  const timestampField = fields.find(part => part.startsWith('t='))
  const timestamp = timestampField ? Number(timestampField.slice(2)) : NaN
  if (!Number.isSafeInteger(timestamp) || Math.abs(nowSeconds - timestamp) > 300) return false

  const signedPayload = encoder.encode(timestamp + '.' + body)
  const signatures = fields.filter(part => part.startsWith('v1=')).map(part => part.slice(3))
  for (const value of signatures) {
    const separator = value.indexOf(':')
    const keyId = separator >= 0 ? value.slice(0, separator) : ''
    const hex = separator >= 0 ? value.slice(separator + 1) : ''
    if (!/^whk_[A-Za-z0-9_-]+$/.test(keyId)) continue
    const bytes = hexToBytes(hex)
    if (!bytes) continue
    for (const secret of secrets) {
      const key = await hmacKey(secret)
      if (await crypto.subtle.verify('HMAC', key, bytes, signedPayload)) return true
    }
  }
  return false
}

/** Legacy raw-body signature is retained only for test-mode compatibility. */
export async function verifyLegacyPaystackSignature(
  body: string,
  signature: string,
  secretKey: string,
): Promise<boolean> {
  const bytes = hexToBytes(signature)
  if (!bytes || !secretKey.startsWith('sk_test_')) return false
  const key = await hmacKey(secretKey)
  return crypto.subtle.verify('HMAC', key, bytes, encoder.encode(body))
}
