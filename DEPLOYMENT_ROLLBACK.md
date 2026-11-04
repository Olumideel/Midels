# Deployment validation and rollback

## Known-good recovery point

The login-recovery release was confirmed by the project owner after a successful email/password sign-in.

- Recovery commit: `0ae4984963ce736968b3b890440e10f5a69c2d27`
- Frontend bundle: `app.js` blob `db1a28a4ef13fb667ff7468397506435eb046aa3`
- The `index.html` script reference points to that exact bundle.
- GitHub Pages deployment run: [41853231539](https://github.com/Olumideel/Midels/actions/runs/41853231539)

Treat this commit as a recovery reference, not as a reason to overwrite newer data or commits.

## Release procedure

1. Make feature work on a separate branch; do not edit the working login or payment paths as part of unrelated features.
2. Open a pull request into `main`.
3. Wait for **Frontend JavaScript validation** to pass. It runs `node --check app.js` on pull requests and pushes to `main`.
4. Review the changed files and confirm that secrets, authentication settings, payment mode, database policies and user data have not been unintentionally changed.
5. Merge only after the checks and review pass.
6. Confirm the GitHub Pages deployment run completes successfully. A successful build alone does not prove every browser journey works.

## Rollback procedure

1. Identify the faulty commit in the GitHub commit history.
2. Use GitHub's **Revert** action to create a new commit that reverses the faulty change. Prefer reverting only the faulty commit(s), not resetting the branch.
3. If a broader rollback is necessary, restore the tracked frontend files from the known-good recovery commit in a new branch, review the diff carefully, and submit a pull request.
4. Wait for validation and Pages deployment to complete.
5. Verify the affected journey before declaring recovery complete.

Do not force-push `main`, delete user data, rotate credentials, change Supabase policies, or switch Paystack to live mode as part of a frontend rollback.

## Scope and limitations

The automated check currently validates JavaScript parsing for `app.js`. It does not test authentication, database permissions, payment processing, browser rendering, accessibility, or external services. The GitHub Pages publishing workflow is managed by the repository's Pages configuration; this validation workflow is a separate check. Configure branch protection to require this check before merge if enforcement is desired.
