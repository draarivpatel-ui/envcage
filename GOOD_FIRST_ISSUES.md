# Good first issues

These 10 tasks are intentionally narrow. Each can be completed without changing the public architecture. Before starting, read CONTRIBUTING.md and open or claim the matching issue.

## 1. Additional boolean spellings policy test

Add fixture tests proving that `on`, `off`, `enabled`, `disabled` and whitespace-padded booleans remain rejected. If a maintainer later decides to accept new spellings, the test should be updated only after an explicit compatibility discussion.

Acceptance checklist:

- Add positive and negative fixtures for every documented spelling.
- Prove error messages do not echo the input.
- No parser change unless the issue explicitly approves one.

## 2. URL allowlist edge-case matrix

Add tests for trailing dot host names, mixed-case hosts, IPv4 hosts, IPv6 literals and internationalized host names normalized by the platform URL parser.

Acceptance checklist:

- Document the exact host comparison behavior in README.md.
- Add tests for each matrix row.
- Do not make network requests.

## 3. CSV duplicate semantics documentation

Add tests and documentation showing whether duplicates are compared before or after trimming, and how empty items interact with `unique` and `allowEmpty`.

Acceptance checklist:

- Cover leading and trailing whitespace.
- Cover empty input and one empty item.
- Keep the simple comma-splitting contract unchanged.

## 4. Duration precision boundary tests

Add boundary fixtures for fractional seconds, very small fractional milliseconds, repeated units and values near `Number.MAX_SAFE_INTEGER`.

Acceptance checklist:

- Use deterministic decimal fixtures.
- Prove fractional milliseconds are rejected.
- Prove compound durations do not use floating-point addition.

## 5. JSON depth documentation examples

Add examples that make the exact depth-counting rule clear for a root scalar, root object and nested array.

Acceptance checklist:

- Tests pin the boundary at the documented depth.
- README.md shows one accepted and one rejected shape.
- Prototype-key rejection remains recursive.

## 6. Redaction coverage matrix

Add a table-driven test matrix covering raw secrets, URL-encoded secrets, padded and unpadded base64, base64url, repeated occurrences and secrets shorter than 8 characters.

Acceptance checklist:

- Prove encoded forms are redacted only at the documented length threshold.
- Prove original objects are not mutated.
- Use synthetic secrets only.

## 7. Dotenv quote-state regression tests

Add hostile fixtures for quotes after comments, unterminated multiline values, backslashes at line endings, unsupported escapes and trailing characters after a closing quote.

Acceptance checklist:

- Each fixture asserts the error code and line number.
- No shell execution or variable expansion is introduced.
- Values are never echoed in errors.

## 8. TypeScript declaration compile fixture

Add a small TypeScript compile fixture in tests or CI, without adding a runtime dependency. If `typescript` is needed, it must be a development-only CI tool rather than a package dependency.

Acceptance checklist:

- The fixture exercises schema inference, `SecretString`, redaction and dotenv types.
- `dependencies` and `devDependencies` in package.json remain empty.
- CI installation strategy is documented before implementation.

## 9. Cross-module mixed-use test

Add tests that build a config through ESM and redact it through CommonJS, then repeat in the opposite direction.

Acceptance checklist:

- `SecretString` values still redact across both entry points.
- Error shape and validator behavior remain identical.
- No module state is shared unsafely.

## 10. Package tarball audit automation

Extend the existing package hygiene test with explicit expectations for the files included by `npm pack --dry-run`.

Acceptance checklist:

- The test does not require network access.
- It verifies source, CJS, types, README, SECURITY, CONTRIBUTING, GOOD_FIRST_ISSUES and LICENSE inclusion.
- It verifies tests and git metadata are not published.
