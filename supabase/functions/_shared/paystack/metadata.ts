type Metadata = Record<string, unknown> | null | undefined

export function paystackMetadataMatches(
  purpose: string,
  expected: Metadata,
  received: Metadata,
  userId: string
): boolean {
  if (!received || received.user_id !== userId || received.purpose !== purpose || !expected) return false

  switch (purpose) {
    case 'subscription':
      return typeof expected.plan_code === 'string' &&
        typeof expected.billing_interval === 'string' &&
        received.plan_code === expected.plan_code &&
        received.billing_interval === expected.billing_interval
    case 'product_purchase':
      return received.product_id === expected.product_id &&
        received.seller_id === expected.seller_id
    case 'course_enrollment':
      return received.course_id === expected.course_id &&
        received.instructor_id === expected.instructor_id
    default:
      return false
  }
}
