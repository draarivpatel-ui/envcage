import { openSync, readSync, closeSync, fstatSync, constants as fsConstants } from 'node:fs';

/*
 * envcage core.
 *
 * Zero runtime dependencies beyond node:fs for the optional file loader.
 * The CommonJS build in cjs/index.cjs is generated from this file by
 * scripts/build-cjs.mjs so both module formats have identical behavior.
 */

export const CODE = Object.freeze({
  INVALID_INPUT: 'ERR_ENVCAGE_INVALID_INPUT',
  SCHEMA: 'ERR_ENVCAGE_SCHEMA',
  VALIDATION: 'ERR_ENVCAGE_VALIDATION',
  MISSING: 'ERR_ENVCAGE_MISSING',
  TYPE: 'ERR_ENVCAGE_TYPE',
  LENGTH: 'ERR_ENVCAGE_LENGTH',
  PATTERN: 'ERR_ENVCAGE_PATTERN',
  RANGE: 'ERR_ENVCAGE_RANGE',
  URL: 'ERR_ENVCAGE_URL',
  JSON: 'ERR_ENVCAGE_JSON',
  CSV: 'ERR_ENVCAGE_CSV',
  DURATION: 'ERR_ENVCAGE_DURATION',
  SECRET: 'ERR_ENVCAGE_SECRET',
  NULL_BYTE: 'ERR_ENVCAGE_NULL_BYTE',
  CONTROL_CHARACTER: 'ERR_ENVCAGE_CONTROL_CHARACTER',
  LIMIT_EXCEEDED: 'ERR_ENVCAGE_LIMIT_EXCEEDED',
  PROTOTYPE_KEY: 'ERR_ENVCAGE_PROTOTYPE_KEY',
  DOTENV_SYNTAX: 'ERR_ENVCAGE_DOTENV_SYNTAX',
  DUPLICATE_KEY: 'ERR_ENVCAGE_DUPLICATE_KEY',
  FILE: 'ERR_ENVCAGE_FILE'
});

const REDACTED = '[REDACTED]';
const VALIDATOR_BRAND = Symbol.for('envcage.validator');
const SECRET_BRAND = Symbol.for('envcage.secret');
const INSPECT_CUSTOM = Symbol.for('nodejs.util.inspect.custom');
const SECRET_VALUES = new WeakMap();
const CONFIG_SECRET_VALUES = new WeakMap();
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ALWAYS_CONTROL_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/;
const FORMAT_CONTROL_RE = /[\t\r\n\u2028\u2029]/;
const BIDI_CONTROL_RE = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/;
const UNICODE_FORMAT_CONTROL_RE = /\p{Cf}/u;
const DOTENV_CONTROL_RE = /[\x00-\x1F\x7F-\x9F\u2028\u2029]/;
const DOTENV_MULTILINE_FORBIDDEN_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F\u2028\u2029]/;
const DEFAULT_MAX_VALUE_LENGTH = 16384;
const DEFAULT_DOTENV_MAX_BYTES = 1048576;
const DEFAULT_DOTENV_MAX_ENTRIES = 1000;
const DEFAULT_DOTENV_MAX_KEY_LENGTH = 256;
const DEFAULT_DOTENV_MAX_VALUE_LENGTH = 65536;
const MAX_SCHEMA_KEY_LENGTH = 256;

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function deepFreeze(value, seen = new Set()) {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value;
  if (seen.has(value)) return value;
  seen.add(value);
  if (typeof value === 'object') {
    for (const key of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        deepFreeze(descriptor.value, seen);
      }
    }
  }
  return Object.freeze(value);
}

function cleanIssue(issue) {
  const source = issue !== null && typeof issue === 'object' ? issue : {};
  const clean = {
    key: typeof source.key === 'string' ? source.key : null,
    code: typeof source.code === 'string' ? source.code : CODE.VALIDATION,
    reason: typeof source.reason === 'string' ? source.reason : 'validation failed'
  };
  if (Number.isSafeInteger(source.line)) clean.line = source.line;
  return clean;
}

export class EnvCageError extends Error {
  constructor(code, reason, details = {}) {
    super(String(code) + ': ' + String(reason));
    this.name = 'EnvCageError';
    this.code = String(code);
    this.reason = String(reason);
    const source = isPlainObject(details) ? details : {};
    const issues = Array.isArray(source.issues) ? source.issues.map(cleanIssue) : [];
    this.issues = deepFreeze(issues);
    if (Number.isSafeInteger(source.line)) this.line = source.line;
    if (typeof source.key === 'string') this.key = source.key;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      reason: this.reason,
      message: this.message,
      issues: this.issues.map((issue) => ({ ...issue }))
    };
  }
}

function fail(code, reason, details) {
  throw new EnvCageError(code, reason, details);
}

class ValidationFailure extends Error {
  constructor(code, reason) {
    super(reason);
    this.name = 'ValidationFailure';
    this.code = code;
    this.reason = reason;
  }
}

function invalid(code, reason) {
  throw new ValidationFailure(code, reason);
}

function assertNoReservedKeys(object, label) {
  for (const key of Object.keys(object)) {
    if (RESERVED_KEYS.has(key)) {
      fail(CODE.PROTOTYPE_KEY, label + ' contains a reserved prototype key', { key });
    }
  }
}

function readPlainOptions(options, label) {
  if (options === undefined) return {};
  if (!isPlainObject(options)) {
    fail(CODE.INVALID_INPUT, label + ' must be a plain object');
  }
  assertNoReservedKeys(options, label);
  return options;
}

function assertOnlyKeys(options, allowed, label, code = CODE.SCHEMA) {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(options)) {
    if (!allowedSet.has(key)) fail(code, label + ' contains an unknown option', { key });
  }
}

function schemaFail(reason) {
  fail(CODE.SCHEMA, reason);
}

function booleanOption(options, name, fallback, errorCode = CODE.SCHEMA) {
  const value = options[name];
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') fail(errorCode, name + ' must be a boolean');
  return value;
}

function integerOption(options, name, fallback, min, max, errorCode = CODE.SCHEMA) {
  const value = options[name];
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    fail(errorCode, name + ' must be a safe integer in range');
  }
  return value;
}

function numberOption(options, name, fallback) {
  const value = options[name];
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    schemaFail(name + ' must be a finite number');
  }
  return value;
}

function assertSchemaKey(key) {
  if (typeof key !== 'string' || key.length === 0 || key.length > MAX_SCHEMA_KEY_LENGTH || !ENV_KEY_RE.test(key)) {
    schemaFail('schema keys must be valid environment variable names');
  }
  if (RESERVED_KEYS.has(key)) {
    fail(CODE.PROTOTYPE_KEY, 'schema key is a reserved prototype key', { key });
  }
}

function cloneValidator(source, patch) {
  const copy = Object.assign({}, source, patch);
  Object.defineProperty(copy, VALIDATOR_BRAND, { value: true });
  return Object.freeze(copy);
}

function createValidator(kind, parse, extra = {}) {
  const validator = {
    kind,
    required: true,
    secret: extra.secret === true,
    multiline: extra.multiline === true,
    parse,
    parseOutput: extra.parseOutput,
    optional() {
      return cloneValidator(this, { required: false });
    },
    default(value) {
      return cloneValidator(this, { hasDefault: true, defaultValue: value });
    }
  };
  Object.defineProperty(validator, VALIDATOR_BRAND, { value: true });
  return Object.freeze(validator);
}

function isValidator(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    value[VALIDATOR_BRAND] === true &&
    typeof value.parse === 'function'
  );
}

export class SecretString {
  constructor(value) {
    if (typeof value !== 'string' || value.length === 0) {
      fail(CODE.INVALID_INPUT, 'secret value must be a non-empty string');
    }
    SECRET_VALUES.set(this, value);
    Object.defineProperty(this, SECRET_BRAND, { value: true });
    Object.freeze(this);
  }

  reveal() {
    const value = SECRET_VALUES.get(this);
    if (typeof value !== 'string') {
      fail(CODE.INVALID_INPUT, 'secret value is not available on this object');
    }
    return value;
  }

  toString() {
    return REDACTED;
  }

  valueOf() {
    return REDACTED;
  }

  toJSON() {
    return REDACTED;
  }

  [Symbol.toPrimitive]() {
    return REDACTED;
  }

  [INSPECT_CUSTOM]() {
    return REDACTED;
  }
}

function isSecretValue(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    value[SECRET_BRAND] === true &&
    typeof value.reveal === 'function'
  );
}

function secretValueOf(value) {
  try {
    const secret = value.reveal();
    return typeof secret === 'string' && secret.length > 0 ? secret : null;
  } catch {
    return null;
  }
}

function validateRawTransport(raw, validator, options) {
  if (typeof raw !== 'string') {
    invalid(CODE.TYPE, 'environment value must be a string');
  }
  if (raw.length > options.maxValueLength) {
    invalid(CODE.LIMIT_EXCEEDED, 'environment value exceeds maxValueLength');
  }
  if (raw.indexOf('\0') !== -1) {
    invalid(CODE.NULL_BYTE, 'environment value contains a null byte');
  }
  if (ALWAYS_CONTROL_RE.test(raw) || BIDI_CONTROL_RE.test(raw) || UNICODE_FORMAT_CONTROL_RE.test(raw)) {
    invalid(CODE.CONTROL_CHARACTER, 'environment value contains a forbidden control character');
  }
  const allowsMultiline = options.allowMultiline === true || validator.multiline === true;
  if (!allowsMultiline && FORMAT_CONTROL_RE.test(raw)) {
    invalid(CODE.CONTROL_CHARACTER, 'environment value contains line or tab control characters');
  }
}

function makeStringValidator(optionsInput) {
  const options = readPlainOptions(optionsInput, 'string validator options');
  assertOnlyKeys(options, ['minLength', 'maxLength', 'allowEmpty', 'trim', 'multiline', 'pattern'], 'string validator options');
  const minLength = integerOption(options, 'minLength', 0, 0, Number.MAX_SAFE_INTEGER);
  const maxLength = integerOption(options, 'maxLength', Number.MAX_SAFE_INTEGER, 0, Number.MAX_SAFE_INTEGER);
  const allowEmpty = booleanOption(options, 'allowEmpty', true);
  const trim = booleanOption(options, 'trim', false);
  const multiline = booleanOption(options, 'multiline', false);
  if (minLength > maxLength) schemaFail('minLength must not exceed maxLength');
  let pattern = null;
  if (options.pattern !== undefined) {
    if (!(options.pattern instanceof RegExp)) schemaFail('pattern must be a RegExp');
    const flags = options.pattern.flags.replace(/[gy]/g, '');
    pattern = new RegExp(options.pattern.source, flags);
  }

  function check(value) {
    if (!allowEmpty && value.length === 0) invalid(CODE.LENGTH, 'string value must not be empty');
    if (value.length < minLength) invalid(CODE.LENGTH, 'string value is shorter than minLength');
    if (value.length > maxLength) invalid(CODE.LENGTH, 'string value is longer than maxLength');
    if (pattern && !pattern.test(value)) invalid(CODE.PATTERN, 'string value does not match the required pattern');
    return value;
  }

  const parse = (raw) => {
    const value = trim ? raw.trim() : raw;
    return check(value);
  };

  return createValidator('str', parse, {
    multiline,
    parseOutput(value) {
      if (typeof value !== 'string') invalid(CODE.TYPE, 'default value must be a string');
      return parse(value);
    }
  });
}

function makeSecretValidator(optionsInput) {
  const options = readPlainOptions(optionsInput, 'secret validator options');
  assertOnlyKeys(options, ['minLength', 'maxLength'], 'secret validator options');
  const minLength = integerOption(options, 'minLength', 16, 1, Number.MAX_SAFE_INTEGER);
  const maxLength = integerOption(options, 'maxLength', Number.MAX_SAFE_INTEGER, 1, Number.MAX_SAFE_INTEGER);
  if (minLength > maxLength) schemaFail('minLength must not exceed maxLength');
  const placeholders = new Set([
    'changeme', 'changeit', 'secret', 'password', 'todo', 'example', 'sample',
    'yourkeyhere', 'yourtokenhere', 'yoursecret', 'replace', 'replaceme',
    'placeholder', 'redacted', '[redacted]', 'none', 'null'
  ]);

  function parse(raw) {
    if (raw !== raw.trim()) invalid(CODE.SECRET, 'secret value has leading or trailing whitespace');
    if (raw.length < minLength) invalid(CODE.SECRET, 'secret value is shorter than minLength');
    if (raw.length > maxLength) invalid(CODE.SECRET, 'secret value is longer than maxLength');
    const canonical = raw.toLowerCase().replace(/[\s_-]+/g, '');
    if (placeholders.has(canonical)) invalid(CODE.SECRET, 'secret value is an obvious placeholder');
    let repeated = true;
    for (let index = 1; index < raw.length; index += 1) {
      if (raw[index] !== raw[0]) {
        repeated = false;
        break;
      }
    }
    if (repeated) invalid(CODE.SECRET, 'secret value is a repeated single character');
    return new SecretString(raw);
  }

  return createValidator('secret', parse, {
    secret: true,
    multiline: false,
    parseOutput(value) {
      const raw = isSecretValue(value) ? secretValueOf(value) : value;
      if (typeof raw !== 'string') invalid(CODE.TYPE, 'default value must be a string');
      return parse(raw);
    }
  });
}

function makeBooleanValidator(optionsInput) {
  const options = readPlainOptions(optionsInput, 'boolean validator options');
  assertOnlyKeys(options, [], 'boolean validator options');
  const truthy = new Set(['true', '1', 'yes']);
  const falsy = new Set(['false', '0', 'no']);
  const parse = (raw) => {
    const normalized = raw.toLowerCase();
    if (truthy.has(normalized)) return true;
    if (falsy.has(normalized)) return false;
    invalid(CODE.TYPE, 'boolean value must be true, false, 1, 0, yes or no');
  };
  return createValidator('bool', parse, {
    parseOutput(value) {
      if (typeof value !== 'boolean') invalid(CODE.TYPE, 'default value must be a boolean');
      return value;
    }
  });
}

function makeIntegerValidator(optionsInput) {
  const options = readPlainOptions(optionsInput, 'integer validator options');
  assertOnlyKeys(options, ['min', 'max'], 'integer validator options');
  const min = integerOption(options, 'min', -Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  const max = integerOption(options, 'max', Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  if (min > max) schemaFail('min must not exceed max');
  const integerRe = /^[+-]?\d+$/;

  function checkNumber(value) {
    if (!Number.isSafeInteger(value)) invalid(CODE.RANGE, 'integer value is not a safe integer');
    if (value < min) invalid(CODE.RANGE, 'integer value is below min');
    if (value > max) invalid(CODE.RANGE, 'integer value is above max');
    return value;
  }

  const parse = (raw) => {
    if (!integerRe.test(raw)) invalid(CODE.TYPE, 'integer value must contain only decimal digits and an optional sign');
    return checkNumber(Number(raw));
  };

  return createValidator('int', parse, {
    parseOutput(value) {
      if (typeof value !== 'number') invalid(CODE.TYPE, 'default value must be a number');
      return checkNumber(value);
    }
  });
}

function makeNumberValidator(optionsInput) {
  const options = readPlainOptions(optionsInput, 'number validator options');
  assertOnlyKeys(options, ['min', 'max'], 'number validator options');
  const min = numberOption(options, 'min', -Infinity);
  const max = numberOption(options, 'max', Infinity);
  if (min > max) schemaFail('min must not exceed max');
  const numberRe = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;

  function checkNumber(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      invalid(CODE.RANGE, 'number value must be finite');
    }
    if (value < min) invalid(CODE.RANGE, 'number value is below min');
    if (value > max) invalid(CODE.RANGE, 'number value is above max');
    return value;
  }

  const parse = (raw) => {
    if (!numberRe.test(raw)) {
      invalid(CODE.TYPE, 'number value must be a decimal number without exponent notation');
    }
    return checkNumber(Number(raw));
  };

  return createValidator('num', parse, {
    parseOutput(value) {
      return checkNumber(value);
    }
  });
}

function makePortValidator(optionsInput) {
  const options = readPlainOptions(optionsInput, 'port validator options');
  assertOnlyKeys(options, [], 'port validator options');
  const portRe = /^\d+$/;
  const parse = (raw) => {
    if (!portRe.test(raw)) invalid(CODE.TYPE, 'port value must contain only decimal digits');
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 1 || value > 65535) {
      invalid(CODE.RANGE, 'port value must be in the range 1 through 65535');
    }
    return value;
  };
  return createValidator('port', parse, {
    parseOutput(value) {
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 65535) {
        invalid(CODE.RANGE, 'default port must be in the range 1 through 65535');
      }
      return value;
    }
  });
}

function normalizeProtocol(value) {
  if (typeof value !== 'string' || value.length === 0) schemaFail('allowedProtocols entries must be non-empty strings');
  return value.endsWith(':') ? value.toLowerCase() : (value + ':').toLowerCase();
}

function makeUrlValidator(optionsInput) {
  const options = readPlainOptions(optionsInput, 'url validator options');
  assertOnlyKeys(options, ['allowedProtocols', 'requireHttps', 'disallowCredentials', 'allowedHosts'], 'url validator options');
  const requireHttps = booleanOption(options, 'requireHttps', false);
  const disallowCredentials = booleanOption(options, 'disallowCredentials', false);
  let allowedProtocols = ['https:', 'http:'];
  if (options.allowedProtocols !== undefined) {
    if (!Array.isArray(options.allowedProtocols) || options.allowedProtocols.length === 0) {
      schemaFail('allowedProtocols must be a non-empty array');
    }
    allowedProtocols = Array.from(new Set(options.allowedProtocols.map(normalizeProtocol)));
  }
  let allowedHosts = null;
  if (options.allowedHosts !== undefined) {
    if (!Array.isArray(options.allowedHosts)) schemaFail('allowedHosts must be an array');
    allowedHosts = new Set();
    for (const host of options.allowedHosts) {
      if (typeof host !== 'string' || host.length === 0 || /[\s/?#@]/.test(host)) {
        schemaFail('allowedHosts entries must be host names');
      }
      allowedHosts.add(host.toLowerCase());
    }
  }
  const protocolSet = new Set(allowedProtocols);

  const parse = (raw) => {
    if (raw !== raw.trim() || /\s/.test(raw)) {
      invalid(CODE.URL, 'url value must not contain whitespace');
    }
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      invalid(CODE.URL, 'url value is not a valid absolute URL');
    }
    if (!protocolSet.has(parsed.protocol)) {
      invalid(CODE.URL, 'url protocol is not allowed');
    }
    if (requireHttps && parsed.protocol !== 'https:') {
      invalid(CODE.URL, 'url value must use https');
    }
    if (disallowCredentials && (parsed.username !== '' || parsed.password !== '')) {
      invalid(CODE.URL, 'url credentials are not allowed');
    }
    if (allowedHosts && !allowedHosts.has(parsed.hostname.toLowerCase())) {
      invalid(CODE.URL, 'url host is not allowed');
    }
    return parsed.toString();
  };

  return createValidator('url', parse, {
    parseOutput(value) {
      if (typeof value !== 'string') invalid(CODE.TYPE, 'default value must be a string');
      return parse(value);
    }
  });
}

function makeEnumValidator(valuesInput, optionsInput) {
  const options = readPlainOptions(optionsInput, 'enum validator options');
  assertOnlyKeys(options, ['caseSensitive'], 'enum validator options');
  if (!Array.isArray(valuesInput) || valuesInput.length === 0) {
    schemaFail('enum values must be a non-empty array');
  }
  const caseSensitive = booleanOption(options, 'caseSensitive', true);
  const values = [];
  const lookup = new Map();
  for (const value of valuesInput) {
    if (typeof value !== 'string' || value.length === 0) schemaFail('enum values must be non-empty strings');
    const key = caseSensitive ? value : value.toLowerCase();
    if (lookup.has(key)) schemaFail('enum values must be unique');
    lookup.set(key, value);
    values.push(value);
  }
  const parse = (raw) => {
    const key = caseSensitive ? raw : raw.toLowerCase();
    if (!lookup.has(key)) invalid(CODE.TYPE, 'value is not one of the allowed enum values');
    return lookup.get(key);
  };
  return createValidator('enum', parse, {
    parseOutput(value) {
      if (typeof value !== 'string') invalid(CODE.TYPE, 'default value must be a string');
      return parse(value);
    }
  });
}

function validateJsonValue(value, maxDepth) {
  const stack = [{ value, depth: 1 }];
  const seen = new Set();
  while (stack.length > 0) {
    const item = stack.pop();
    const current = item.value;
    if (current === null) continue;
    const type = typeof current;
    if (type === 'number') {
      if (!Number.isFinite(current)) invalid(CODE.JSON, 'json value contains a non-finite number');
      continue;
    }
    if (type === 'string' || type === 'boolean') continue;
    if (type !== 'object') invalid(CODE.JSON, 'json default must contain only JSON values');
    if (item.depth > maxDepth) invalid(CODE.JSON, 'json value exceeds maxDepth');
    if (seen.has(current)) invalid(CODE.JSON, 'json default must not contain repeated or cyclic objects');
    seen.add(current);
    if (Array.isArray(current)) {
      for (const child of current) stack.push({ value: child, depth: item.depth + 1 });
      continue;
    }
    if (!isPlainObject(current)) invalid(CODE.JSON, 'json default objects must be plain objects');
    if (Object.getOwnPropertySymbols(current).length > 0) invalid(CODE.JSON, 'json default objects must not contain symbol keys');
    for (const key of Object.keys(current)) {
      if (RESERVED_KEYS.has(key)) invalid(CODE.JSON, 'json value contains a reserved prototype key');
      stack.push({ value: current[key], depth: item.depth + 1 });
    }
  }
}

function cloneJsonValue(value) {
  if (Array.isArray(value)) return value.map((child) => cloneJsonValue(child));
  if (value !== null && typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    const copy = Object.create(proto === null ? null : Object.prototype);
    for (const key of Object.keys(value)) {
      defineDataProperty(copy, key, cloneJsonValue(value[key]));
    }
    return copy;
  }
  return value;
}

function assertJsonDepthWithinLimit(raw, maxDepth) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{' || char === '[') {
      depth += 1;
      if (depth > maxDepth) invalid(CODE.JSON, 'json value exceeds maxDepth');
    } else if (char === '}' || char === ']') {
      depth -= 1;
      if (depth < 0) return;
    }
  }
}

function assertNoDuplicateJsonKeys(raw) {
  let index = 0;

  function skipWhitespace() {
    while (index < raw.length && (raw[index] === ' ' || raw[index] === '\t' || raw[index] === '\n' || raw[index] === '\r')) {
      index += 1;
    }
  }

  function scanString() {
    const start = index;
    index += 1;
    while (index < raw.length) {
      const char = raw[index];
      if (char === '\\') {
        index += 2;
        continue;
      }
      index += 1;
      if (char === '"') break;
    }
    return raw.slice(start, index);
  }

  function scanPrimitive() {
    while (index < raw.length && !/[\s,\]}]/.test(raw[index])) index += 1;
  }

  function scanValue(depth) {
    skipWhitespace();
    const char = raw[index];
    if (char === '{') {
      scanObject(depth);
    } else if (char === '[') {
      scanArray(depth);
    } else if (char === '"') {
      scanString();
    } else {
      scanPrimitive();
    }
  }

  function scanObject(depth) {
    index += 1;
    const keys = new Set();
    skipWhitespace();
    if (raw[index] === '}') {
      index += 1;
      return;
    }
    while (index < raw.length) {
      skipWhitespace();
      const token = scanString();
      const key = JSON.parse(token);
      if (keys.has(key)) invalid(CODE.JSON, 'json object contains a duplicate key');
      keys.add(key);
      skipWhitespace();
      index += 1;
      scanValue(depth + 1);
      skipWhitespace();
      if (raw[index] === ',') {
        index += 1;
        continue;
      }
      if (raw[index] === '}') {
        index += 1;
        return;
      }
      return;
    }
  }

  function scanArray(depth) {
    index += 1;
    skipWhitespace();
    if (raw[index] === ']') {
      index += 1;
      return;
    }
    while (index < raw.length) {
      scanValue(depth + 1);
      skipWhitespace();
      if (raw[index] === ',') {
        index += 1;
        continue;
      }
      if (raw[index] === ']') {
        index += 1;
        return;
      }
      return;
    }
  }

  scanValue(1);
}

function makeJsonValidator(optionsInput) {
  const options = readPlainOptions(optionsInput, 'json validator options');
  assertOnlyKeys(options, ['maxDepth', 'multiline'], 'json validator options');
  const maxDepth = integerOption(options, 'maxDepth', 32, 1, 512);
  const parse = (raw) => {
    assertJsonDepthWithinLimit(raw, maxDepth);
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      invalid(CODE.JSON, 'json value is not valid JSON');
    }
    assertNoDuplicateJsonKeys(raw);
    validateJsonValue(value, maxDepth);
    return value;
  };
  return createValidator('json', parse, {
    multiline: booleanOption(options, 'multiline', false),
    parseOutput(value) {
      validateJsonValue(value, maxDepth);
      return cloneJsonValue(value);
    }
  });
}

function makeCsvValidator(optionsInput) {
  const options = readPlainOptions(optionsInput, 'csv validator options');
  assertOnlyKeys(options, ['trim', 'allowEmpty', 'unique', 'minItems', 'maxItems'], 'csv validator options');
  const trim = booleanOption(options, 'trim', true);
  const allowEmpty = booleanOption(options, 'allowEmpty', false);
  const unique = booleanOption(options, 'unique', false);
  const minItems = integerOption(options, 'minItems', 0, 0, Number.MAX_SAFE_INTEGER);
  const maxItems = integerOption(options, 'maxItems', Number.MAX_SAFE_INTEGER, 0, Number.MAX_SAFE_INTEGER);
  if (minItems > maxItems) schemaFail('minItems must not exceed maxItems');

  function checkItems(items) {
    if (items.length < minItems) invalid(CODE.CSV, 'csv value has fewer items than minItems');
    if (items.length > maxItems) invalid(CODE.CSV, 'csv value has more items than maxItems');
    const seen = new Set();
    for (const item of items) {
      if (typeof item !== 'string') invalid(CODE.CSV, 'csv default items must be strings');
      if (!allowEmpty && item.length === 0) invalid(CODE.CSV, 'csv value contains an empty item');
      if (unique) {
        if (seen.has(item)) invalid(CODE.CSV, 'csv value contains a duplicate item');
        seen.add(item);
      }
    }
    return items;
  }

  const parse = (raw) => {
    const items = raw.split(',').map((item) => (trim ? item.trim() : item));
    return checkItems(items);
  };

  return createValidator('csv', parse, {
    parseOutput(value) {
      if (!Array.isArray(value)) invalid(CODE.TYPE, 'default value must be an array');
      return checkItems(value.slice());
    }
  });
}

function decimalMilliseconds(numberText, factor) {
  const parts = numberText.split('.');
  const whole = parts[0];
  const fraction = parts[1] || '';
  const numerator = BigInt(whole + fraction);
  const denominator = 10n ** BigInt(fraction.length);
  const scaled = numerator * BigInt(factor);
  if (scaled % denominator !== 0n) return null;
  return scaled / denominator;
}

function makeDurationValidator(optionsInput) {
  const options = readPlainOptions(optionsInput, 'duration validator options');
  assertOnlyKeys(options, ['min', 'max'], 'duration validator options');
  const min = integerOption(options, 'min', 0, 0, Number.MAX_SAFE_INTEGER);
  const max = integerOption(options, 'max', Number.MAX_SAFE_INTEGER, 0, Number.MAX_SAFE_INTEGER);
  if (min > max) schemaFail('min must not exceed max');
  const factors = Object.freeze({ ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 });
  const segmentRe = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/i;
  const bareMsRe = /^\d+$/;

  function checkRange(total) {
    if (total < BigInt(min)) invalid(CODE.RANGE, 'duration value is below min');
    if (total > BigInt(max)) invalid(CODE.RANGE, 'duration value is above max');
    if (total > BigInt(Number.MAX_SAFE_INTEGER)) invalid(CODE.RANGE, 'duration value is not a safe integer');
    return Number(total);
  }

  const parse = (raw) => {
    if (raw !== raw.trim() || raw.length === 0) {
      invalid(CODE.DURATION, 'duration value must not have leading or trailing whitespace');
    }
    if (bareMsRe.test(raw)) return checkRange(BigInt(raw));
    const parts = raw.split(/ +/);
    const usedUnits = new Set();
    let total = 0n;
    for (const part of parts) {
      const match = segmentRe.exec(part);
      if (!match) invalid(CODE.DURATION, 'duration value has an invalid segment or unit');
      const unit = match[2].toLowerCase();
      if (usedUnits.has(unit)) invalid(CODE.DURATION, 'duration value repeats a unit');
      usedUnits.add(unit);
      const amount = decimalMilliseconds(match[1], factors[unit]);
      if (amount === null) invalid(CODE.DURATION, 'duration value does not resolve to whole milliseconds');
      total += amount;
      if (total > BigInt(Number.MAX_SAFE_INTEGER)) invalid(CODE.RANGE, 'duration value is not a safe integer');
    }
    return checkRange(total);
  };

  return createValidator('durationMs', parse, {
    parseOutput(value) {
      if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
        invalid(CODE.TYPE, 'default value must be a safe integer number of milliseconds');
      }
      return checkRange(BigInt(value));
    }
  });
}

export const t = Object.freeze({
  str: makeStringValidator,
  secret: makeSecretValidator,
  bool: makeBooleanValidator,
  int: makeIntegerValidator,
  num: makeNumberValidator,
  port: makePortValidator,
  url: makeUrlValidator,
  enum: makeEnumValidator,
  json: makeJsonValidator,
  csv: makeCsvValidator,
  durationMs: makeDurationValidator
});

function issueFromFailure(key, failure) {
  return {
    key,
    code: failure.code || CODE.VALIDATION,
    reason: failure.reason || 'validation failed'
  };
}

function parseDefaultValue(validator, options) {
  const value = validator.defaultValue;
  if (typeof value === 'string') {
    validateRawTransport(value, validator, options);
    return validator.parse(value);
  }
  if (typeof validator.parseOutput !== 'function') {
    invalid(CODE.TYPE, 'default value must be a string for this validator');
  }
  return validator.parseOutput(value);
}

function validationMessage(issues) {
  const shown = issues.slice(0, 20).map((issue) => issue.key + ': ' + issue.reason);
  const remainder = issues.length - shown.length;
  return 'environment validation failed with ' + issues.length + ' issue(s): ' +
    shown.join('; ') + (remainder > 0 ? '; and ' + remainder + ' more' : '');
}

export function defineEnv(schema, source = process.env, optionsInput = {}) {
  if (!isPlainObject(schema)) fail(CODE.SCHEMA, 'schema must be a plain object');
  assertNoReservedKeys(schema, 'schema');
  const options = readPlainOptions(optionsInput, 'defineEnv options');
  assertOnlyKeys(options, ['maxValueLength', 'allowMultiline'], 'defineEnv options', CODE.INVALID_INPUT);
  const maxValueLength = integerOption(options, 'maxValueLength', DEFAULT_MAX_VALUE_LENGTH, 1, Number.MAX_SAFE_INTEGER, CODE.INVALID_INPUT);
  const allowMultiline = booleanOption(options, 'allowMultiline', false, CODE.INVALID_INPUT);
  if (source === null || (typeof source !== 'object' && typeof source !== 'function')) {
    fail(CODE.INVALID_INPUT, 'source must be an object such as process.env');
  }

  const runtimeOptions = Object.freeze({ maxValueLength, allowMultiline });
  const keys = Object.keys(schema);
  const result = Object.create(null);
  const issues = [];
  const secrets = [];

  for (const key of keys) {
    assertSchemaKey(key);
    const validator = schema[key];
    if (!isValidator(validator)) {
      schemaFail('schema values must be envcage validators');
    }

    let present = false;
    let raw;
    try {
      present = Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined;
      if (present) raw = source[key];
    } catch {
      issues.push({ key, code: CODE.TYPE, reason: 'environment value could not be read' });
      continue;
    }

    if (!present) {
      if (validator.hasDefault === true) {
        try {
          const parsedDefault = parseDefaultValue(validator, runtimeOptions);
          result[key] = parsedDefault;
          if (validator.secret && isSecretValue(parsedDefault)) {
            const secret = secretValueOf(parsedDefault);
            if (secret !== null) secrets.push(secret);
          }
        } catch (error) {
          if (error instanceof ValidationFailure) {
            issues.push({ key, code: error.code, reason: 'invalid default: ' + error.reason });
          } else {
            throw error;
          }
        }
      } else if (validator.required !== false) {
        issues.push({ key, code: CODE.MISSING, reason: 'required environment variable is missing' });
      }
      continue;
    }

    try {
      validateRawTransport(raw, validator, runtimeOptions);
      const parsed = validator.parse(raw);
      result[key] = parsed;
      if (validator.secret && isSecretValue(parsed)) {
        const secret = secretValueOf(parsed);
        if (secret !== null) secrets.push(secret);
      }
    } catch (error) {
      if (error instanceof ValidationFailure) {
        issues.push(issueFromFailure(key, error));
      } else {
        throw error;
      }
    }
  }

  if (issues.length > 0) {
    throw new EnvCageError(CODE.VALIDATION, validationMessage(issues), { issues });
  }

  deepFreeze(result);
  CONFIG_SECRET_VALUES.set(result, Object.freeze(secrets.slice()));
  return result;
}

function collectSecrets(config) {
  const output = [];
  const add = (value) => {
    if (typeof value === 'string' && value.length > 0 && !output.includes(value)) output.push(value);
  };
  if (isSecretValue(config)) {
    const value = secretValueOf(config);
    if (value !== null) add(value);
  }
  if (CONFIG_SECRET_VALUES.has(config)) {
    for (const value of CONFIG_SECRET_VALUES.get(config)) add(value);
  }
  if (config && typeof config === 'object') {
    const stack = [config];
    const seen = new Set();
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current || typeof current !== 'object' || seen.has(current)) continue;
      seen.add(current);
      if (isSecretValue(current)) {
        const value = secretValueOf(current);
        if (value !== null) add(value);
        continue;
      }
      if (current instanceof Map) {
        for (const [key, child] of current) {
          if (key && typeof key === 'object') stack.push(key);
          if (child && typeof child === 'object') stack.push(child);
        }
      }
      if (current instanceof Set) {
        for (const child of current) {
          if (child && typeof child === 'object') stack.push(child);
        }
      }
      if (current instanceof Error) {
        const causeDescriptor = Object.getOwnPropertyDescriptor(current, 'cause');
        if (causeDescriptor && Object.prototype.hasOwnProperty.call(causeDescriptor, 'value')) {
          const cause = causeDescriptor.value;
          if (cause && typeof cause === 'object') stack.push(cause);
        }
      }
      if (!Array.isArray(current) && !isPlainObject(current)) continue;
      for (const key of Object.keys(current)) {
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
          const child = descriptor.value;
          if (child && typeof child === 'object') stack.push(child);
        }
      }
    }
  }
  return output;
}

function escapeRegExpChar(char) {
  return char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hexDigitPattern(char) {
  const lower = char.toLowerCase();
  return /[a-f]/.test(lower) ? '[' + lower + lower.toUpperCase() + ']' : char;
}

function urlEncodedFormRegex(encoded) {
  let source = '';
  for (let index = 0; index < encoded.length; index += 1) {
    const char = encoded[index];
    if (char === '%' && index + 2 < encoded.length && /^[0-9A-F]{2}$/.test(encoded.slice(index + 1, index + 3))) {
      source += '%' + hexDigitPattern(encoded[index + 1]) + hexDigitPattern(encoded[index + 2]);
      index += 2;
    } else {
      source += escapeRegExpChar(char);
    }
  }
  return new RegExp(source, 'g');
}

function pushSecretForm(forms, kind, value, length) {
  const key = kind + ':' + (kind === 'regex' ? value.source : value);
  for (const form of forms) {
    if (form.key === key) return;
  }
  forms.push({ key, kind, value, length });
}

function secretForms(secret) {
  const forms = [];
  pushSecretForm(forms, 'text', secret, secret.length);
  if (secret.length >= 8) {
    let uri = null;
    try {
      uri = encodeURIComponent(secret);
    } catch {
      uri = null;
    }
    if (uri !== null) {
      pushSecretForm(forms, 'regex', urlEncodedFormRegex(uri), uri.length);
    }
    const base64 = Buffer.from(secret, 'utf8').toString('base64');
    const base64Url = base64.replace(/\+/g, '-').replace(/\//g, '_');
    for (const form of [base64, base64Url, base64.replace(/=+$/g, ''), base64Url.replace(/=+$/g, '')]) {
      pushSecretForm(forms, 'text', form, form.length);
    }
  }
  return forms;
}

function allSecretForms(config) {
  const forms = [];
  for (const secret of collectSecrets(config)) {
    for (const form of secretForms(secret)) {
      pushSecretForm(forms, form.kind, form.value, form.length);
    }
  }
  return forms.sort((left, right) => right.length - left.length);
}

function redactText(text, forms) {
  let output = text;
  for (const form of forms) {
    if (form.kind === 'regex') {
      form.value.lastIndex = 0;
      output = output.replace(form.value, () => REDACTED);
      form.value.lastIndex = 0;
    } else {
      output = output.split(form.value).join(REDACTED);
    }
  }
  return output;
}

function defineDataProperty(target, key, value) {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true
  });
}

function copyError(error, forms, seen) {
  const copy = new Error(redactText(error.message, forms));
  seen.set(error, copy);
  copy.name = typeof error.name === 'string' ? redactText(error.name, forms) : error.name;
  if (typeof error.stack === 'string') copy.stack = redactText(error.stack, forms);
  if ('code' in error) {
    copy.code = typeof error.code === 'string' ? redactText(error.code, forms) : error.code;
  }
  if ('cause' in error) defineDataProperty(copy, 'cause', cloneRedacted(error.cause, forms, seen));
  for (const key of Object.keys(error)) {
    if (key === 'message' || key === 'stack' || key === 'cause') continue;
    const descriptor = Object.getOwnPropertyDescriptor(error, key);
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) continue;
    defineDataProperty(copy, redactText(key, forms), cloneRedacted(descriptor.value, forms, seen));
  }
  return copy;
}

function cloneRedacted(value, forms, seen) {
  if (typeof value === 'string') return redactText(value, forms);
  if (isSecretValue(value)) return REDACTED;
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  if (value instanceof Error) return copyError(value, forms, seen);
  if (value instanceof Date) {
    const copy = new Date(value.getTime());
    seen.set(value, copy);
    return copy;
  }
  if (value instanceof RegExp) {
    const copy = new RegExp(value.source, value.flags);
    seen.set(value, copy);
    return copy;
  }
  if (value instanceof Map) {
    const copy = new Map();
    seen.set(value, copy);
    for (const [key, child] of value) {
      copy.set(cloneRedacted(key, forms, seen), cloneRedacted(child, forms, seen));
    }
    return copy;
  }
  if (value instanceof Set) {
    const copy = new Set();
    seen.set(value, copy);
    for (const child of value) copy.add(cloneRedacted(child, forms, seen));
    return copy;
  }
  if (Array.isArray(value)) {
    const copy = [];
    seen.set(value, copy);
    for (const child of value) copy.push(cloneRedacted(child, forms, seen));
    return copy;
  }

  const proto = Object.getPrototypeOf(value);
  const copy = Object.create(proto === Object.prototype || proto === null ? proto : null);
  seen.set(value, copy);
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) continue;
    const cleanKey = redactText(key, forms);
    defineDataProperty(copy, cleanKey, cloneRedacted(descriptor.value, forms, seen));
  }
  return copy;
}

export function redact(config, textOrObj) {
  const forms = allSecretForms(config);
  if (typeof textOrObj === 'string') return redactText(textOrObj, forms);
  return cloneRedacted(textOrObj, forms, new Map());
}

export function redactString(config, text) {
  if (typeof text !== 'string') fail(CODE.INVALID_INPUT, 'text must be a string');
  return redact(config, text);
}

export function redactObject(config, object) {
  return redact(config, object);
}

export function safeSnapshot(config) {
  if (config === null || typeof config !== 'object') {
    fail(CODE.INVALID_INPUT, 'config must be an object returned by defineEnv');
  }
  const snapshot = redact(config, config);
  return deepFreeze(snapshot);
}

function readUtf8FileBounded(filePath, maxBytes) {
  let descriptor;
  let total = 0;
  const chunks = [];
  const nonBlockingFlag = process.platform === 'win32' ? 0 : (fsConstants.O_NONBLOCK || 0);
  const openFlags = fsConstants.O_RDONLY | nonBlockingFlag;
  try {
    descriptor = openSync(filePath, openFlags);
    if (!fstatSync(descriptor).isFile()) {
      fail(CODE.FILE, 'dotenv path is not a regular file');
    }
    const buffer = Buffer.allocUnsafe(65536);
    while (total <= maxBytes) {
      const remaining = maxBytes - total + 1;
      const length = Math.min(buffer.length, remaining);
      if (length <= 0) break;
      const bytesRead = readSync(descriptor, buffer, 0, length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  if (total > maxBytes) fail(CODE.LIMIT_EXCEEDED, 'dotenv file exceeds maxBytes');
  const bytes = Buffer.concat(chunks);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    fail(CODE.FILE, 'dotenv file is not valid UTF-8');
  }
}

function dotenvFail(code, reason, line, key) {
  const suffix = Number.isSafeInteger(line) ? ' at line ' + line : '';
  fail(code, reason + suffix, { line, key });
}

function positiveLimit(options, name, fallback) {
  const value = options[name];
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    fail(CODE.INVALID_INPUT, name + ' must be a positive safe integer');
  }
  return value;
}

function validateDotEnvKey(key, line, maxKeyLength) {
  if (key.length > maxKeyLength) dotenvFail(CODE.LIMIT_EXCEEDED, 'dotenv key exceeds maxKeyLength', line, key);
  if (!ENV_KEY_RE.test(key)) dotenvFail(CODE.DOTENV_SYNTAX, 'dotenv key is not a valid environment variable name', line, key);
  if (RESERVED_KEYS.has(key)) dotenvFail(CODE.PROTOTYPE_KEY, 'dotenv key is a reserved prototype key', line, key);
}

function validateDotEnvValue(value, line, key, multiline, maxValueLength) {
  if (value.length > maxValueLength) dotenvFail(CODE.LIMIT_EXCEEDED, 'dotenv value exceeds maxValueLength', line, key);
  if (value.indexOf('\0') !== -1) dotenvFail(CODE.NULL_BYTE, 'dotenv value contains a null byte', line, key);
  if (multiline) {
    if (DOTENV_MULTILINE_FORBIDDEN_RE.test(value) || BIDI_CONTROL_RE.test(value) || UNICODE_FORMAT_CONTROL_RE.test(value)) {
      dotenvFail(CODE.CONTROL_CHARACTER, 'dotenv multiline value contains a forbidden control character', line, key);
    }
  } else if (DOTENV_CONTROL_RE.test(value) || BIDI_CONTROL_RE.test(value) || UNICODE_FORMAT_CONTROL_RE.test(value)) {
    dotenvFail(CODE.CONTROL_CHARACTER, 'dotenv value contains a control character', line, key);
  }
}

function parseQuotedDotEnvValue(lines, startLineIndex, initialText, quote, key) {
  const doubleQuoted = quote === '"';
  const parts = [];
  let lineIndex = startLineIndex;
  let text = initialText;
  let position = 1;
  let segmentStart = 1;
  let spansLines = false;
  let escapedLineBreak = false;

  while (true) {
    while (position < text.length) {
      const char = text[position];
      if (char === quote) {
        if (segmentStart < position) parts.push(text.slice(segmentStart, position));
        const value = parts.join('');
        return {
          value,
          endLineIndex: lineIndex,
          remainder: text.slice(position + 1),
          multiline: spansLines || escapedLineBreak || value.indexOf('\n') !== -1 || value.indexOf('\r') !== -1
        };
      }
      if (doubleQuoted && char === '\\') {
        if (segmentStart < position) parts.push(text.slice(segmentStart, position));
        position += 1;
        if (position >= text.length) {
          dotenvFail(CODE.DOTENV_SYNTAX, 'dotenv double-quoted value ends with an incomplete escape', lineIndex + 1, key);
        }
        const escaped = text[position];
        const escapes = { n: '\n', r: '\r', t: '\t', '\\': '\\', '"': '"', '$': '$' };
        if (!Object.prototype.hasOwnProperty.call(escapes, escaped)) {
          dotenvFail(CODE.DOTENV_SYNTAX, 'dotenv double-quoted value contains an unsupported escape', lineIndex + 1, key);
        }
        const decoded = escapes[escaped];
        if (decoded === '\n' || decoded === '\r') escapedLineBreak = true;
        parts.push(decoded);
        position += 1;
        segmentStart = position;
        continue;
      }
      position += 1;
    }

    if (segmentStart < text.length) parts.push(text.slice(segmentStart));
    if (lineIndex >= lines.length - 1) {
      dotenvFail(CODE.DOTENV_SYNTAX, 'dotenv quoted value is not terminated', startLineIndex + 1, key);
    }
    parts.push('\n');
    spansLines = true;
    lineIndex += 1;
    text = lines[lineIndex];
    position = 0;
    segmentStart = 0;
  }
}

function stripUnquotedComment(rest) {
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === '#' && (index === 0 || rest[index - 1] === ' ' || rest[index - 1] === '\t')) {
      return rest.slice(0, index);
    }
  }
  return rest;
}

function trimAsciiWhitespaceStart(text) {
  return text.replace(/^[ \t]+/, '');
}

function trimAsciiWhitespaceEnd(text) {
  return text.replace(/[ \t]+$/, '');
}

function trimAsciiWhitespace(text) {
  return trimAsciiWhitespaceEnd(trimAsciiWhitespaceStart(text));
}

export function parseDotEnv(textInput, optionsInput = {}) {
  if (typeof textInput !== 'string') fail(CODE.INVALID_INPUT, 'dotenv text must be a string');
  const options = readPlainOptions(optionsInput, 'parseDotEnv options');
  assertOnlyKeys(options, ['maxBytes', 'maxEntries', 'maxKeyLength', 'maxValueLength', 'onDuplicate'], 'parseDotEnv options', CODE.INVALID_INPUT);
  const maxBytes = positiveLimit(options, 'maxBytes', DEFAULT_DOTENV_MAX_BYTES);
  const maxEntries = positiveLimit(options, 'maxEntries', DEFAULT_DOTENV_MAX_ENTRIES);
  const maxKeyLength = positiveLimit(options, 'maxKeyLength', DEFAULT_DOTENV_MAX_KEY_LENGTH);
  const maxValueLength = positiveLimit(options, 'maxValueLength', DEFAULT_DOTENV_MAX_VALUE_LENGTH);
  let onDuplicate = options.onDuplicate;
  if (onDuplicate === undefined) onDuplicate = 'error';
  if (onDuplicate !== 'error' && onDuplicate !== 'first' && onDuplicate !== 'last') {
    fail(CODE.INVALID_INPUT, 'onDuplicate must be error, first or last');
  }
  if (Buffer.byteLength(textInput, 'utf8') > maxBytes) {
    fail(CODE.LIMIT_EXCEEDED, 'dotenv input exceeds maxBytes');
  }

  const withoutByteOrderMark = textInput.charCodeAt(0) === 0xFEFF ? textInput.slice(1) : textInput;
  const normalized = withoutByteOrderMark.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  const output = Object.create(null);
  let count = 0;
  let lineIndex = 0;

  while (lineIndex < lines.length) {
    const originalLine = lines[lineIndex];
    let line = trimAsciiWhitespaceStart(originalLine);
    const lineNumber = lineIndex + 1;
    if (line.length === 0 || line.startsWith('#')) {
      lineIndex += 1;
      continue;
    }
    if (/^export[ \t]+/.test(line)) line = line.replace(/^export[ \t]+/, '');

    const keyMatch = /^[A-Za-z_][A-Za-z0-9_]*/.exec(line);
    if (!keyMatch) dotenvFail(CODE.DOTENV_SYNTAX, 'dotenv line does not start with a valid key', lineNumber);
    const key = keyMatch[0];
    validateDotEnvKey(key, lineNumber, maxKeyLength);
    let rest = line.slice(key.length);
    if (!/^[ \t]*=/.test(rest)) dotenvFail(CODE.DOTENV_SYNTAX, 'dotenv key is not followed by an equals sign', lineNumber, key);
    rest = rest.replace(/^[ \t]*=/, '').replace(/^[ \t]+/, '');

    let value;
    let multiline = false;
    if (rest.startsWith('"') || rest.startsWith("'")) {
      const quote = rest[0];
      const parsed = parseQuotedDotEnvValue(lines, lineIndex, rest, quote, key);
      value = parsed.value;
      multiline = parsed.multiline;
      const remainder = trimAsciiWhitespace(parsed.remainder);
      if (remainder.length > 0 && !remainder.startsWith('#')) {
        dotenvFail(CODE.DOTENV_SYNTAX, 'dotenv quoted value has trailing characters', parsed.endLineIndex + 1, key);
      }
      lineIndex = parsed.endLineIndex;
    } else {
      value = trimAsciiWhitespaceEnd(stripUnquotedComment(rest));
    }

    validateDotEnvValue(value, lineNumber, key, multiline, maxValueLength);

    const duplicate = Object.prototype.hasOwnProperty.call(output, key);
    if (duplicate && onDuplicate === 'error') {
      dotenvFail(CODE.DUPLICATE_KEY, 'dotenv key is duplicated', lineNumber, key);
    }
    if (!duplicate) {
      count += 1;
      if (count > maxEntries) dotenvFail(CODE.LIMIT_EXCEEDED, 'dotenv input exceeds maxEntries', lineNumber, key);
    }
    if (!duplicate || onDuplicate === 'last') output[key] = value;
    lineIndex += 1;
  }

  return deepFreeze(output);
}

export function loadEnvFile(filePath, optionsInput = {}) {
  if (typeof filePath !== 'string' || filePath.length === 0 || filePath.length > 4096) {
    fail(CODE.INVALID_INPUT, 'filePath must be a non-empty string within 4096 characters');
  }
  if (filePath.indexOf('\0') !== -1) fail(CODE.NULL_BYTE, 'filePath contains a null byte');
  const options = readPlainOptions(optionsInput, 'loadEnvFile options');
  assertOnlyKeys(options, ['maxBytes', 'maxEntries', 'maxKeyLength', 'maxValueLength', 'onDuplicate', 'required'], 'loadEnvFile options', CODE.INVALID_INPUT);
  const required = booleanOption(options, 'required', true, CODE.INVALID_INPUT);
  let text;
  try {
    text = readUtf8FileBounded(filePath, positiveLimit(options, 'maxBytes', DEFAULT_DOTENV_MAX_BYTES));
  } catch (error) {
    if (error instanceof EnvCageError) throw error;
    if (!required && error && error.code === 'ENOENT') return deepFreeze(Object.create(null));
    fail(CODE.FILE, 'dotenv file could not be read as UTF-8');
  }
  const parserOptions = Object.assign({}, options);
  delete parserOptions.required;
  return parseDotEnv(text, parserOptions);
}

const envcage = {
  CODE,
  EnvCageError,
  SecretString,
  t,
  defineEnv,
  redact,
  redactString,
  redactObject,
  safeSnapshot,
  parseDotEnv,
  loadEnvFile
};

export default envcage;
