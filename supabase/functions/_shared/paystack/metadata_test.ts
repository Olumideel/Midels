import { paystackMetadataMatches } from './metadata.ts'

Deno.test('subscription metadata must match user, plan and billing interval', () => {
  const expected = { plan_code: 'pro', billing_interval: 'annual' }
  const valid = { user_id: 'user-1', plan_code: 'pro', billing_interval: 'annual' }
  if (!paystackMetadataMatches('subscription', expected, valid, 'user-1')) throw Error('valid subscription metadata rejected')
  for (const changed of [
    { ...valid, user_id: 'user-2' },
    { ...valid, plan_code: 'school' },
    { ...valid, billing_interval: 'monthly' },
    { user_id: 'user-1' }
  ]) {
    if (paystackMetadataMatches('subscription', expected, changed, 'user-1')) {
      throw Error('mismatched subscription metadata accepted')
    }
  }
})

Deno.test('product and course metadata remain bound to their original records', () => {
  const product = { product_id: 'product-1', seller_id: 'seller-1' }
  if (!paystackMetadataMatches('product_purchase', product,
    { user_id: 'user-1', ...product }, 'user-1')) throw Error('valid product metadata rejected')
  if (paystackMetadataMatches('product_purchase', product,
    { user_id: 'user-1', ...product, seller_id: 'seller-2' }, 'user-1')) throw Error('wrong seller accepted')

  const course = { course_id: 'course-1', instructor_id: 'teacher-1' }
  if (!paystackMetadataMatches('course_enrollment', course,
    { user_id: 'user-1', ...course }, 'user-1')) throw Error('valid course metadata rejected')
  if (paystackMetadataMatches('course_enrollment', course,
    { user_id: 'user-1', ...course, instructor_id: 'teacher-2' }, 'user-1')) throw Error('wrong instructor accepted')
})

Deno.test('unknown payment purposes fail closed', () => {
  if (paystackMetadataMatches('unknown', {}, { user_id: 'user-1' }, 'user-1')) {
    throw Error('unknown payment purpose accepted')
  }
})
