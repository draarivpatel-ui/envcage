# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 1.x | Yes |
| < 1.0 | No |

## Reporting a vulnerability

Please report security issues privately using GitHub's "Report a vulnerability" feature on the repository's Security tab. Do not open a public issue for an exploitable finding.

Include:

- A minimal proof of concept (an environment value, schema, dotenv input or redaction input).
- The affected version and Node.js version.
- The expected security boundary and the observed violation.
- Whether the issue exposes a secret value, bypasses validation, permits prototype pollution or bypasses a documented limit.

You should receive an acknowledgement within 7 days. We will work with you on a fix and coordinate disclosure. Please give maintainers a reasonable window to release a patch before public disclosure.

## Scope

The following are in scope:

- Validation bypasses for documented strict boolean, integer, number, port, URL, enum, JSON, CSV or duration rules.
- Secret values appearing in `EnvCageError` messages, issue objects, `toJSON()`, `util.inspect()` output or `safeSnapshot()` output.
- Failure of `redact()` to remove a registered secret or its documented encoded forms.
- Prototype pollution through schema keys, option objects, JSON values or dotenv keys.
- Dotenv parser command execution, shell expansion, quote-state confusion, duplicate bypasses or documented limit bypasses.
- Control-character or null-byte handling that contradicts the documented rules.

The following are generally out of scope:

- Secrets after application code deliberately calls `reveal()` and logs or transmits them.
- An attacker who can already execute JavaScript in the same process or inspect process memory.
- Environment changes made after validation.
- Network properties of a URL. URL validation is syntactic and policy based only.
- Resource use within the documented input size limits that is proportional to input size.

## Security design notes

- Error aggregation never includes raw environment values. This avoids leaking unmarked credentials through validation failures.
- Secret values are wrapped in `SecretString`. Accidental string conversion, JSON serialization and inspection produce `[REDACTED]`; only an explicit `reveal()` call returns the raw value.
- `redact()` treats raw, URL-encoded, base64 and base64url forms as sensitive when the secret is at least 8 characters long. Redaction is defense in depth, not proof that every possible encoding is covered.
- The config object is null-prototype and deeply frozen. Schema keys, JSON object keys and dotenv keys are checked for prototype-pollution names before use.
- The dotenv parser never invokes a shell, evaluates JavaScript or expands variables. Text that looks like command substitution remains text.
- Size limits are applied before parsing large inputs. Applications with tighter memory requirements should lower the limits.

## Disclosure history

No published advisories yet. Fixed versions will be listed here with their advisory links.
