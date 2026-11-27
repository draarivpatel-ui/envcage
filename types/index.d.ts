/** Error codes emitted by envcage. */
export const CODE: Readonly<{
  INVALID_INPUT: 'ERR_ENVCAGE_INVALID_INPUT';
  SCHEMA: 'ERR_ENVCAGE_SCHEMA';
  VALIDATION: 'ERR_ENVCAGE_VALIDATION';
  MISSING: 'ERR_ENVCAGE_MISSING';
  TYPE: 'ERR_ENVCAGE_TYPE';
  LENGTH: 'ERR_ENVCAGE_LENGTH';
  PATTERN: 'ERR_ENVCAGE_PATTERN';
  RANGE: 'ERR_ENVCAGE_RANGE';
  URL: 'ERR_ENVCAGE_URL';
  JSON: 'ERR_ENVCAGE_JSON';
  CSV: 'ERR_ENVCAGE_CSV';
  DURATION: 'ERR_ENVCAGE_DURATION';
  SECRET: 'ERR_ENVCAGE_SECRET';
  NULL_BYTE: 'ERR_ENVCAGE_NULL_BYTE';
  CONTROL_CHARACTER: 'ERR_ENVCAGE_CONTROL_CHARACTER';
  LIMIT_EXCEEDED: 'ERR_ENVCAGE_LIMIT_EXCEEDED';
  PROTOTYPE_KEY: 'ERR_ENVCAGE_PROTOTYPE_KEY';
  DOTENV_SYNTAX: 'ERR_ENVCAGE_DOTENV_SYNTAX';
  DUPLICATE_KEY: 'ERR_ENVCAGE_DUPLICATE_KEY';
  FILE: 'ERR_ENVCAGE_FILE';
}>;

export type EnvCageErrorCode =
  'ERR_ENVCAGE_INVALID_INPUT' | 'ERR_ENVCAGE_SCHEMA' | 'ERR_ENVCAGE_VALIDATION' |
  'ERR_ENVCAGE_MISSING' | 'ERR_ENVCAGE_TYPE' | 'ERR_ENVCAGE_LENGTH' |
  'ERR_ENVCAGE_PATTERN' | 'ERR_ENVCAGE_RANGE' | 'ERR_ENVCAGE_URL' |
  'ERR_ENVCAGE_JSON' | 'ERR_ENVCAGE_CSV' | 'ERR_ENVCAGE_DURATION' |
  'ERR_ENVCAGE_SECRET' | 'ERR_ENVCAGE_NULL_BYTE' | 'ERR_ENVCAGE_CONTROL_CHARACTER' |
  'ERR_ENVCAGE_LIMIT_EXCEEDED' | 'ERR_ENVCAGE_PROTOTYPE_KEY' |
  'ERR_ENVCAGE_DOTENV_SYNTAX' | 'ERR_ENVCAGE_DUPLICATE_KEY' | 'ERR_ENVCAGE_FILE';

export interface EnvCageIssue {
  readonly key: string | null;
  readonly code: EnvCageErrorCode | string;
  readonly reason: string;
  readonly line?: number;
}

/** Structured error thrown for validation failures and unsafe input. */
export declare class EnvCageError extends Error {
  constructor(code: EnvCageErrorCode | string, reason: string, details?: {
    issues?: ReadonlyArray<Partial<EnvCageIssue>>;
    line?: number;
    key?: string;
  });
  readonly name: 'EnvCageError';
  readonly code: EnvCageErrorCode | string;
  readonly reason: string;
  readonly issues: readonly EnvCageIssue[];
  readonly line?: number;
  readonly key?: string;
  toJSON(): {
    name: string;
    code: string;
    reason: string;
    message: string;
    issues: EnvCageIssue[];
  };
}

/**
 * Redacting wrapper returned for every t.secret() value.
 * Call reveal() explicitly when the secret is required by a client library.
 */
export declare class SecretString {
  constructor(value: string);
  reveal(): string;
  toString(): '[REDACTED]';
  valueOf(): '[REDACTED]';
  toJSON(): '[REDACTED]';
}

export interface EnvValidator<T> {
  /** Phantom type marker used for schema inference. It is not present at runtime. */
  readonly __envcageOutput?: T;
  readonly kind: string;
  readonly required: boolean;
  readonly secret: boolean;
  readonly multiline: boolean;
  optional(): EnvValidator<T | undefined>;
  /** Accepts a raw string or an already typed output value. */
  default(value: T | string): EnvValidator<T>;
}

export type EnvSchema = Record<string, EnvValidator<any>>;

export type InferConfig<S extends EnvSchema> = {
  readonly [K in keyof S]: S[K] extends { readonly __envcageOutput?: infer T } ? T : never;
};

export interface DefineEnvOptions {
  /** Maximum accepted length of any raw environment value. Default 16384. */
  maxValueLength?: number;
  /** Permit tab and line break characters in every value. Default false. */
  allowMultiline?: boolean;
}

export interface StringValidatorOptions {
  minLength?: number;
  maxLength?: number;
  allowEmpty?: boolean;
  trim?: boolean;
  multiline?: boolean;
  pattern?: RegExp;
}

export interface SecretValidatorOptions {
  /** Minimum length. Default 16. */
  minLength?: number;
  maxLength?: number;
}

export interface IntegerValidatorOptions {
  min?: number;
  max?: number;
}

export interface NumberValidatorOptions {
  min?: number;
  max?: number;
}

export interface UrlValidatorOptions {
  /** Allowed protocols. Default ['https:', 'http:']. */
  allowedProtocols?: string[];
  /** Require the https: protocol. Default false. */
  requireHttps?: boolean;
  /** Reject URLs containing a username or password. Default false. */
  disallowCredentials?: boolean;
  /** Exact lowercase host names that are allowed. */
  allowedHosts?: string[];
}

export interface EnumValidatorOptions {
  caseSensitive?: boolean;
}

export interface JsonValidatorOptions {
  /** Maximum object or array nesting depth. Default 32. */
  maxDepth?: number;
  /** Permit tab and line break characters in the raw JSON. Default false. */
  multiline?: boolean;
}

export interface CsvValidatorOptions {
  trim?: boolean;
  allowEmpty?: boolean;
  unique?: boolean;
  minItems?: number;
  maxItems?: number;
}

export interface DurationValidatorOptions {
  /** Minimum milliseconds. Default 0. */
  min?: number;
  /** Maximum milliseconds. Default Number.MAX_SAFE_INTEGER. */
  max?: number;
}

export declare const t: Readonly<{
  str(options?: StringValidatorOptions): EnvValidator<string>;
  secret(options?: SecretValidatorOptions): EnvValidator<SecretString>;
  bool(options?: Record<string, never>): EnvValidator<boolean>;
  int(options?: IntegerValidatorOptions): EnvValidator<number>;
  num(options?: NumberValidatorOptions): EnvValidator<number>;
  port(options?: Record<string, never>): EnvValidator<number>;
  url(options?: UrlValidatorOptions): EnvValidator<string>;
  enum<Values extends string>(
    values: readonly [Values, ...Values[]],
    options?: EnumValidatorOptions
  ): EnvValidator<Values>;
  enum(
    values: readonly string[],
    options?: EnumValidatorOptions
  ): EnvValidator<string>;
  json(options?: JsonValidatorOptions): EnvValidator<unknown>;
  csv(options?: CsvValidatorOptions): EnvValidator<string[]>;
  durationMs(options?: DurationValidatorOptions): EnvValidator<number>;
}>;

/** Validate and freeze selected variables from source. Throws EnvCageError with every issue. */
export declare function defineEnv<S extends EnvSchema>(
  schema: S,
  source?: Record<string, unknown>,
  options?: DefineEnvOptions
): InferConfig<S>;

/** Redact registered secret values from a string or clone them out of an object. */
export declare function redact(config: unknown, textOrObj: string): string;
export declare function redact<T>(config: unknown, textOrObj: T): Redacted<T>;

/** Redact registered secret values from one string. */
export declare function redactString(config: unknown, text: string): string;

export type Redacted<T> =
  T extends SecretString ? '[REDACTED]' :
  T extends string ? string :
  T extends readonly (infer Item)[] ? Array<Redacted<Item>> :
  T extends object ? { [Key in keyof T]: Redacted<T[Key]> } :
  T;

/** Clone an object with registered secret values replaced by [REDACTED]. */
export declare function redactObject<T>(config: unknown, object: T): Redacted<T>;

/** Return a deeply frozen diagnostic copy of config with every secret masked. */
export declare function safeSnapshot<T>(config: T): Redacted<T>;

export interface ParseDotEnvOptions {
  /** Maximum UTF-8 input size. Default 1048576. */
  maxBytes?: number;
  /** Maximum unique keys. Default 1000. */
  maxEntries?: number;
  /** Maximum key length. Default 256. */
  maxKeyLength?: number;
  /** Maximum parsed value length. Default 65536. */
  maxValueLength?: number;
  /** Duplicate policy. Default 'error'. */
  onDuplicate?: 'error' | 'first' | 'last';
}

/** Parse dotenv text without shell expansion, command execution or variable interpolation. */
export declare function parseDotEnv(
  text: string,
  options?: ParseDotEnvOptions
): Readonly<Record<string, string>>;

export interface LoadEnvFileOptions extends ParseDotEnvOptions {
  /** Return an empty object for ENOENT when false. Default true. */
  required?: boolean;
}

/** Read and parse a regular valid UTF-8 dotenv file. */
export declare function loadEnvFile(
  filePath: string,
  options?: LoadEnvFileOptions
): Readonly<Record<string, string>>;

declare const envcage: {
  CODE: typeof CODE;
  EnvCageError: typeof EnvCageError;
  SecretString: typeof SecretString;
  t: typeof t;
  defineEnv: typeof defineEnv;
  redact: typeof redact;
  redactString: typeof redactString;
  redactObject: typeof redactObject;
  safeSnapshot: typeof safeSnapshot;
  parseDotEnv: typeof parseDotEnv;
  loadEnvFile: typeof loadEnvFile;
};

export default envcage;
