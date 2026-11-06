const encoder = new TextEncoder()

function hexToBytes(hex: string): ArrayBuffer | null {
  if (!/^[a-f0-9]{128}$/i.test(hex)) return null
  return new Uint8Array(hex.match(/.{2}/g)!.map(byte => parseInt(byte, 16))).buffer as ArrayBuffer
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['verify'])
}

function asBytes(body: string | Uint8Array): Uint8Array {
  return typeof body === 'string' ? encoder.encode(body) : body
}

export async function verifyModernPaystackSignature(
  body: string | Uint8Array,
  header: string,
  signingSecrets: string | readonly string[],
  nowSeconds = Math.floor(Date.now() / 1000)
): Promise<boolean> {
  const secrets = [...new Set(
    (typeof signingSecrets === 'string' ? [signingSecrets] : signingSecrets)
      .filter(secret => typeof secret === 'string' && secret.startsWith('whsec_'))
  )]
  if (!secrets.length) return false

  const fields = header.split(',').map(part => part.trim())
  const timestampFields = fields.filter(part => part.startsWith('t='))
  if (timestampFields.length !== 1) return false
  const timestampText = timestampFields[0].slice(2)
  if (!/^\d+$/.test(timestampText)) return false
  const timestamp = Number(timestampText)
  if (!Number.isSafeInteger(timestamp) || Math.abs(nowSeconds - timestamp) > 300) return false

  const rawBody = asBytes(body)
  const prefix = encoder.encode(timestamp + '.')
  const payload = new Uint8Array(prefix.length + rawBody.length)
  payload.set(prefix)
  payload.set(rawBody, prefix.length)

  for (const value of fields.filter(part => part.startsWith('v1=')).map(part => part.slice(3))) {
    const separator = value.indexOf(':')
    const keyId = separator >= 0 ? value.slice(0, separator) : ''
    const digest = separator >= 0 ? value.slice(separator + 1) : ''
    if (!/^whk_[A-Za-z0-9_-]+$/.test(keyId)) continue
    const bytes = hexToBytes(digest)
    if (!bytes) continue
    for (const secret of secrets) {
      if (await crypto.subtle.verify('HMAC', await hmacKey(secret), bytes, payload.buffer as ArrayBuffer)) return true
    }
  }
  return false
}

export async function verifyLegacyPaystackSignature(
  body: string | Uint8Array,
  signature: string,
  secretKey: string
): Promise<boolean> {
  const bytes = hexToBytes(signature)
  if (!bytes || !secretKey.startsWith('sk_test_')) return false
  return crypto.subtle.verify('HMAC', await hmacKey(secretKey), bytes, asBytes(body).slice().buffer as ArrayBuffer)
}
