# Public certificate verification privacy

The public certificate verifier is an authenticity endpoint, not a public learner directory.

## Public response contract

The verifier may return only:

- `valid`
- `certificate_code`
- `course_title`
- `issued_at`
- `revoked_at`

It must not return a learner name, learner ID, email address, profile URL, or other identifying profile data. The public UI must not render those fields.

The signed-in learner's own certificate artifact may continue to show the learner name. That private artifact is separate from the public verification response.

## Access boundary

Anonymous verification is intentional. The RPC remains executable by `anon` and `authenticated`, with an empty database `search_path`. Its SQL definition must remain narrowly scoped to certificate status and course title.

The certificate privacy validation workflow checks the frontend syntax and this response contract on pull requests targeting the Paystack readiness branch.
