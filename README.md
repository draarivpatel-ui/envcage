# envcage

[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/draarivpatel-ui/envcage/badge)](https://scorecard.dev/viewer/?uri=github.com/draarivpatel-ui/envcage)

Zero-dependency strict environment variable validation, secret redaction and dotenv parsing for Node.js.

`envcage` is a small, auditable security library for service configuration. It validates only the environment variables named by a schema, aggregates every validation failure into one structured error, deeply freezes the resulting null-prototype config object, and makes secret values difficult to leak through logs, `JSON.stringify`, `util.inspect` or diagnostic objects. It works in ESM and CommonJS with strict TypeScript declarations and no runtime dependencies.

- **Zero dependencies.** Only `node:fs` is used, and only by the optional `loadEnvFile()` helper.
- **Dual module.** Native ESM (`import`) and CommonJS (`require`) entry points generated from one source of truth.
- **Fail closed.** Missing or invalid required values throw before any partial config is returned.
- **Aggregate errors.** `EnvCageError.issues` contains every schema failure without echoing environment values.
- **Secret masking.** `t.secret()` returns a `SecretString` wrapper whose string, JSON and inspect forms are always `[REDACTED]`.
- **Safe dotenv parsing.** No shell execution, no variable expansion, strict size limits, duplicate-key policy, multiline quoted strings and prototype-key rejection.

**Tests:** 455 passing with `npm test` (Node 18+).

## Install

```sh
npm install envcage
```

No install scripts, no native builds, no transitive dependencies.

## Quick start

### ESM

```js
import { defineEnv, t } from 'envcage';

const config = defineEnv({
  NODE_ENV: t.enum(['development', 'test', 'production']),
  PORT: t.port().default('8080'),
  DATABASE_URL: t.url({ requireHttps: true, disallowCredentials: true }),
  API_TOKEN: t.secret({ minLength: 32 }),
  ENABLE_CACHE: t.bool().default('false')
});

const server = createServer();
server.listen(config.PORT);

// Explicit access is required at the trust boundary.
apiClient.setToken(config.API_TOKEN.reveal());
```

### CommonJS

```js
const { defineEnv, t } = require('envcage');

const config = defineEnv({
  PORT: t.port(),
  API_TOKEN: t.secret()
});
```

## Core API

### `defineEnv(schema, source = process.env, options?)`

Validates the keys named by `schema` against `source`, then returns a deeply frozen `Object.create(null)` config object. Unknown environment variables are not copied. Optional missing values are omitted. A missing required value or any invalid value throws one `EnvCageError` with code `ERR_ENVCAGE_VALIDATION` and an `issues` array containing every failure.

Error issues contain the key, a machine-readable code and a safe reason. Raw environment values are never placed in the error message, issue objects or `toJSON()` output.

Options:

| Option | Default | Meaning |
| --- | --- | --- |
| `maxValueLength` | `16384` | Maximum raw string length accepted for any one value. |
| `allowMultiline` | `false` | Permit tab and line break characters in every value. Prefer per-validator `multiline` where supported. |

The returned object and all arrays and plain objects inside it are frozen. Secret values are additionally wrapped. Mutating or spreading the config does not expose a secret accidentally, but `reveal()` always returns the real string and must be treated as sensitive.

Raw values reject null bytes, C0 and C1 control characters, bidirectional formatting controls and other Unicode format controls. Line breaks and tabs are rejected unless multiline input is explicitly enabled.

### Validators

All validators are required by default. `.optional()` omits a missing value. `.default(value)` uses `value` when the environment variable is absent. String defaults are parsed exactly like environment input; already typed defaults are checked before use.

#### `t.str(options?)`

Strict string validator.

| Option | Default | Meaning |
| --- | --- | --- |
| `minLength` | `0` | Minimum string length. |
| `maxLength` | unlimited within `maxValueLength` | Maximum string length. |
| `allowEmpty` | `true` | Set false to reject an empty string. |
| `trim` | `false` | Trim whitespace before validation. |
| `multiline` | `false` | Permit tab and line break characters. |
| `pattern` | none | RegExp the final string must match. Stateful global flags are removed before use. |

#### `t.secret(options?)`

Strict secret validator. The default `minLength` is 16. It rejects leading or trailing whitespace, repeated single-character values and obvious placeholders such as `changeme`, `secret`, `password`, `todo`, `example` and `your-key-here`.

The return value is a `SecretString`:

```js
const token = config.API_TOKEN;

String(token);           // '[REDACTED]'
JSON.stringify(config);  // never serializes the raw token
console.log(token);      // inspect output is '[REDACTED]'
token.reveal();          // the raw token, explicitly
```

`reveal()` is intentionally the only way to obtain the raw value. Do not log the result, put it in an error, or send it anywhere other than the intended credential consumer.

#### `t.bool()`

Accepts only `true`, `false`, `1`, `0`, `yes` and `no`, case-insensitively. It rejects values such as `maybe`, `2`, `on`, `off`, empty strings and whitespace-padded strings. This avoids the common bug where `Boolean(process.env.FLAG)` treats the string `'false'` as true.

#### `t.int(options?)`

Accepts decimal integers with an optional sign. Rejects decimal fractions, exponent notation, `NaN`, `Infinity`, empty strings, whitespace, trailing junk and unsafe integers. Optional `min` and `max` bounds must be safe integers.

#### `t.num(options?)`

Accepts finite decimal numbers such as `1`, `-2`, `+3.5` and `.5`. Exponent notation is rejected so a configuration value cannot silently change magnitude. `NaN` and `Infinity` are rejected. Optional `min` and `max` bounds are supported.

#### `t.port()`

Accepts only decimal digits representing a TCP or UDP port from 1 through 65535. Signs, whitespace, decimal fractions, exponent notation, zero and out-of-range values are rejected.

#### `t.url(options?)`

Parses an absolute URL with the platform `URL` parser and returns its normalized string form. It rejects whitespace and invalid URLs.

| Option | Default | Meaning |
| --- | --- | --- |
| `allowedProtocols` | `['https:', 'http:']` | Protocol allowlist. `javascript:`, `file:` and `data:` are blocked unless explicitly allowed, which is not recommended. |
| `requireHttps` | `false` | Require `https:`. |
| `disallowCredentials` | `false` | Reject a username or password embedded in the URL. |
| `allowedHosts` | none | Exact lowercase host allowlist. Use ASCII or punycode host names. |

#### `t.enum(values, options?)`

Accepts one of the supplied non-empty string values and returns the canonical configured spelling. Matching is case-sensitive by default; pass `{ caseSensitive: false }` for case-insensitive matching.

#### `t.json(options?)`

Parses strict JSON. Object keys named `__proto__`, `constructor` or `prototype` are rejected recursively, and duplicate object keys are rejected after escape decoding. Nesting depth is limited by `maxDepth` (default 32) and deep input is rejected before the native parser recurses into it. Raw line breaks are rejected unless `{ multiline: true }` is set. The parsed value is deeply frozen as part of the final config.

#### `t.csv(options?)`

Parses a simple comma-separated list into an array of strings. This is deliberately not an RFC 4180 parser; quotes have no special meaning.

| Option | Default | Meaning |
| --- | --- | --- |
| `trim` | `true` | Trim each item. |
| `allowEmpty` | `false` | Permit empty items. |
| `unique` | `false` | Reject duplicate items after trimming. |
| `minItems` | `0` | Minimum item count. |
| `maxItems` | unlimited within `maxValueLength` | Maximum item count. |

#### `t.durationMs(options?)`

Parses a duration into whole milliseconds. Accepted forms are bare digits as milliseconds or unit segments using `ms`, `s`, `m`, `h` and `d`, such as `250ms`, `2s`, `5m`, `1h 30m` or `1d`. Segments are separated only by ASCII spaces. Units may not repeat. Fractional input is accepted only when it resolves to whole milliseconds, for example `1.5s`. Negative values, exponent notation, unknown units and non-integer millisecond results are rejected.

### `redact(config, textOrObj)`

Replaces every registered secret value with `[REDACTED]` in a string, an `Error` copy or a deep clone of a diagnostic object. For secrets at least 8 characters long, their canonical `encodeURIComponent`, base64 and base64url forms, including unpadded base64 variants, are also replaced. Percent-encoding hex digits are matched case-insensitively. Redaction is defense in depth and cannot cover every possible downstream encoding. The input object is never mutated.

```js
const safeLog = redact(config, `token was ${config.API_TOKEN.reveal()}`);
// token was [REDACTED]
```

`redactString(config, text)` and `redactObject(config, object)` are explicit convenience wrappers.

### `safeSnapshot(config)`

Returns a deeply frozen diagnostic copy of the config with every `SecretString` replaced by `[REDACTED]` and any matching string occurrence redacted. Use this for error reports or support output. The snapshot is not suitable for running the application because secrets are intentionally absent.

### `parseDotEnv(text, options?)`

Parses dotenv text into a frozen null-prototype object of strings. The parser is intentionally strict:

- Keys must match `[A-Za-z_][A-Za-z0-9_]*` and must not be `__proto__`, `constructor` or `prototype`.
- Duplicate keys throw by default. `onDuplicate` may be `'error'`, `'first'` or `'last'`.
- Input size, entry count, key length and value length are capped.
- Null bytes, control characters and Unicode format controls are rejected. Multiline quoted values may contain line breaks and tabs.
- One UTF-8 byte order mark is accepted at the start of input. Only ASCII spaces and tabs are structural whitespace.
- Single-quoted values are literal. Double-quoted values support `\\n`, `\\r`, `\\t`, `\\\\`, `\\\"` and `\\$` escapes.
- `$(command)`, backticks and `$VARIABLE` are literal text. Nothing is evaluated or expanded.
- CRLF input is normalized to LF line endings.

Options: `maxBytes` (default 1048576), `maxEntries` (default 1000), `maxKeyLength` (default 256), `maxValueLength` (default 65536), `onDuplicate`.

### `loadEnvFile(filePath, options?)`

Reads a regular UTF-8 dotenv file with `node:fs` and parses it with `parseDotEnv`. Non-regular paths such as directories, devices and FIFOs are rejected instead of blocking. Malformed UTF-8 is rejected rather than silently converted to replacement characters. By default a read failure throws `ERR_ENVCAGE_FILE`. Pass `{ required: false }` to return an empty frozen object when the file does not exist. Parser options are forwarded.

## Scope and limitations

`envcage` is not a secret manager, encryption library or credential rotation system. It cannot protect a secret after application code calls `reveal()` and deliberately sends or logs it elsewhere. It validates strings present in the supplied source object; it does not scan the process environment for every possible secret, detect entropy, or prove that a credential is correct. URL validation is syntactic and policy based; no network request is made. The dotenv parser intentionally does not implement shell expansion or variable interpolation.

The library validates at process configuration time. It does not protect against an attacker who can already execute JavaScript in the same process, read process memory, or mutate the environment after validation.

## Errors

Every rejection uses `EnvCageError` or an aggregated `EnvCageError` with this shape:

```js
{
  name: 'EnvCageError',
  code: 'ERR_ENVCAGE_VALIDATION',
  issues: [
    { key: 'PORT', code: 'ERR_ENVCAGE_RANGE', reason: 'port value must be in the range 1 through 65535' }
  ]
}
```

Values are not echoed. This is deliberate: configuration values frequently contain credentials even when the schema author did not mark them secret.

## Module and type support

```js
// ESM
import envcage, { defineEnv, t } from 'envcage';

// CommonJS
const envcage = require('envcage');
```

Both entry points expose the same API. TypeScript declarations are included at `types/index.d.ts` and require no additional type package.

## Security

See SECURITY.md for the vulnerability reporting process and scope.
