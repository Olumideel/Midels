import { resolvePaystackConfig } from './config.ts'

Deno.test('defaults safely to test mode with a test key', () => {
  if (!resolvePaystackConfig(undefined, 'sk_test_example').valid) throw new Error('test default rejected')
})
Deno.test('accepts explicit test and live key pairs', () => {
  if (!resolvePaystackConfig('test', 'sk_test_example').valid) throw new Error('test pair rejected')
  if (!resolvePaystackConfig('live', 'sk_live_example').valid) throw new Error('live pair rejected')
})
Deno.test('rejects cross-environment keys', () => {
  if (resolvePaystackConfig('test', 'sk_live_example').valid) throw new Error('live key accepted in test')
  if (resolvePaystackConfig('live', 'sk_test_example').valid) throw new Error('test key accepted in live')
})
Deno.test('rejects unknown mode and missing keys', () => {
  if (resolvePaystackConfig('staging', 'sk_test_example').valid) throw new Error('unknown mode accepted')
  if (resolvePaystackConfig('live', undefined).valid) throw new Error('missing key accepted')
})
