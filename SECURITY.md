# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| Latest published 1.x release | Yes |
| Older releases | No |

Security fixes apply to the latest published 1.x release. Users should upgrade to the fixed release as soon as it is available.

## Reporting a vulnerability

Report suspected vulnerabilities privately through [GitHub private vulnerability reporting](https://github.com/draarivpatel-ui/envcage/security/advisories/new). Do not open a public issue for an exploitable finding.

Include:

- A minimal proof of concept (an environment value, schema, dotenv input or redaction input).
- The affected version and Node.js version.
- The expected security boundary and the observed violation.
- Whether the issue exposes a secret value, bypasses validation, permits prototype pollution or bypasses a documented limit.

Do not include real credentials, secret values or customer data in a report.

## Acknowledgment and coordinated disclosure timeline

- We aim to acknowledge a vulnerability report within 3 business days.
- We aim to complete initial triage and severity assessment within 14 days.
- We aim to release a fix within 90 days of confirming a vulnerability, sooner for high severity issues when practical.
- We coordinate public disclosure with the reporter. A public advisory is normally published after a fixed release is available or on a mutually agreed date.
- Credit is given in release notes and the advisory unless the reporter prefers otherwise.
- If a report is not accepted as a vulnerability, we will explain the reasoning before closing the advisory.

## Vulnerability handling process

1. Receive the private report through the GitHub security advisory.
2. Reproduce the issue, determine affected versions and assess severity.
3. Develop a fix with regression tests.
4. Publish the fixed release and prepare the advisory.
5. Publish coordinated disclosure notes with affected and fixed versions.

## Scope

The following are in scope:

- Validation bypasses for documented strict boolean, integer, number, port, URL, enum, JSON, CSV or duration rules.
- Secret values appearing in `EnvCageError` messages, issue objects, `toJSON()`, `util.inspect()` output or `safeSnapshot()` output.
- Failure of `redact()` to remove a registered secret or its documented canonical encoded forms.
- Prototype pollution or duplicate-key ambiguity through schema keys, option objects, JSON values or dotenv keys.
- Dotenv parser command execution, shell expansion, quote-state confusion, duplicate bypasses, malformed UTF-8 acceptance or documented limit bypasses.
- Control-character, Unicode format-control or null-byte handling that contradicts the documented rules.

The following are generally out of scope:

- Secrets after application code deliberately calls `reveal()` and logs or transmits them.
- An attacker who can already execute JavaScript in the same process or inspect process memory.
- Environment changes made after validation.
- Network properties of a URL. URL validation is syntactic and policy based only.
- Resource use within the documented input size limits that is proportional to input size.

## Security design notes

- Error aggregation never includes raw environment values. This avoids leaking unmarked credentials through validation failures.
- Secret values are wrapped in `SecretString`. Accidental string conversion, JSON serialization and inspection produce `[REDACTED]`; only an explicit `reveal()` call returns the raw value.
- `redact()` treats raw, canonical `encodeURIComponent`, base64 and base64url forms as sensitive when the secret is at least 8 characters long. Percent hex is matched case-insensitively. Redaction is defense in depth, not proof that every possible downstream encoding or representation is covered.
- The config object is null-prototype and deeply frozen. Schema keys, JSON object keys and dotenv keys are checked for prototype-pollution names before use. Duplicate JSON object keys are rejected after escape decoding.
- The dotenv parser never invokes a shell, evaluates JavaScript or expands variables. Text that looks like command substitution remains text. Files must be regular valid UTF-8 files.
- Size and depth limits are applied before recursive or proportional parsing work where practical. Applications with tighter memory requirements should lower the limits.

## Disclosure history

No published advisories yet. Fixed versions will be listed here with their advisory links.
