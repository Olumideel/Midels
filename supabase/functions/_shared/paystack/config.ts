export type PaystackMode = 'test' | 'live'

export function resolvePaystackConfig(modeValue: string | undefined, secretKey: string | undefined) {
  const mode = (modeValue || 'test') as PaystackMode
  const validMode = mode === 'test' || mode === 'live'
  const expectedPrefix = mode === 'live' ? 'sk_live_' : 'sk_test_'
  const validKey = typeof secretKey === 'string' && secretKey.startsWith(expectedPrefix)
  return { mode, expectedDomain: mode, valid: validMode && validKey }
}
