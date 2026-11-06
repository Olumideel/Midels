/** Central fail-closed policy for this release: Paystack test mode only. */
export function isPaystackTestModeConfigured(mode: string | undefined, secretKey: string | undefined): boolean {
  const effectiveMode = mode || 'test'
  return effectiveMode === 'test' && typeof secretKey === 'string' && secretKey.startsWith('sk_test_')
}
