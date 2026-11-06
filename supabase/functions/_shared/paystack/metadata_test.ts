import { paystackMetadataMatches } from './metadata.ts'

Deno.test('subscription metadata must match purpose, user, plan and billing interval', () => {
  const expected = { plan_code: 'pro', billing_interval: 'annual' }
  const valid = { user_id: 'user-1', purpose: 'subscription', plan_code: 'pro', billing_interval: 'annual' }
  if (!paystackMetadataMatches('subscription', expected, valid, 'user-1')) throw Error('valid subscription metadata rejected')
  for (const changed of [
    { ...valid, user_id: 'user-2' },
    { ...valid, purpose: 'product_purchase' },
    { ...valid, plan_code: 'school' },
    { ...valid, billing_interval: 'monthly' },
    { user_id: 'user-1', purpose: 'subscription' }
  ]) {
    if (paystackMetadataMatches('subscription', expected, changed, 'user-1')) {
      throw Error('mismatched subscription metadata accepted')
    }
  }
})

Deno.test('product and course metadata remain bound to their original records and purpose', () => {
  const product = { product_id: 'product-1', seller_id: 'seller-1' }
  const validProduct = { user_id: 'user-1', purpose: 'product_purchase', ...product }
  if (!paystackMetadataMatches('product_purchase', product, validProduct, 'user-1')) throw Error('valid product metadata rejected')
  if (paystackMetadataMatches('product_purchase', product,
    { ...validProduct, purpose: 'course_enrollment' }, 'user-1')) throw Error('wrong product purpose accepted')
  if (paystackMetadataMatches('product_purchase', product,
    { ...validProduct, seller_id: 'seller-2' }, 'user-1')) throw Error('wrong seller accepted')

  const course = { course_id: 'course-1', instructor_id: 'teacher-1' }
  const validCourse = { user_id: 'user-1', purpose: 'course_enrollment', ...course }
  if (!paystackMetadataMatches('course_enrollment', course, validCourse, 'user-1')) throw Error('valid course metadata rejected')
  if (paystackMetadataMatches('course_enrollment', course,
    { ...validCourse, purpose: 'product_purchase' }, 'user-1')) throw Error('wrong course purpose accepted')
  if (paystackMetadataMatches('course_enrollment', course,
    { ...validCourse, instructor_id: 'teacher-2' }, 'user-1')) throw Error('wrong instructor accepted')
})

Deno.test('unknown payment purposes fail closed', () => {
  if (paystackMetadataMatches('unknown', {}, { user_id: 'user-1', purpose: 'unknown' }, 'user-1')) {
    throw Error('unknown payment purpose accepted')
  }
})
