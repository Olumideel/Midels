import { isPaystackTestModeConfigured } from './config.ts'

Deno.test('allows explicit test mode with a test secret', () => {
  if (!isPaystackTestModeConfigured('test', 'sk_test_example')) throw new Error('Expected test configuration to pass')
})

Deno.test('allows omitted mode to default to test when the key is a test key', () => {
  if (!isPaystackTestModeConfigured(undefined, 'sk_test_example')) throw new Error('Expected safe default to pass')
})

Deno.test('rejects live mode even when a live key is supplied', () => {
  if (isPaystackTestModeConfigured('live', 'sk_live_example')) throw new Error('Live mode must be rejected')
})

Deno.test('rejects a live key even when mode says test', () => {
  if (isPaystackTestModeConfigured('test', 'sk_live_example')) throw new Error('Live key must be rejected')
})

Deno.test('rejects missing, empty and unexpected configuration', () => {
  for (const [mode, key] of [[undefined, undefined], ['test', ''], ['staging', 'sk_test_example'], ['LIVE', 'sk_live_example']] as const) {
    if (isPaystackTestModeConfigured(mode, key)) throw new Error('Unsafe configuration must be rejected')
  }
})
