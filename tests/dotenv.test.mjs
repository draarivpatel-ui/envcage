import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { esm, directError } from './helpers.mjs';

const { parseDotEnv, loadEnvFile, CODE } = esm;

test('parseDotEnv parses simple key value pairs', () => {
  const parsed = parseDotEnv('A=1\nB=two\n');
  assert.equal(parsed.A, '1');
  assert.equal(parsed.B, 'two');
});

test('parseDotEnv returns a frozen null-prototype object', () => {
  const parsed = parseDotEnv('A=1');
  assert.equal(Object.getPrototypeOf(parsed), null);
  assert.equal(Object.isFrozen(parsed), true);
});

test('parseDotEnv ignores blank lines and full-line comments', () => {
  const parsed = parseDotEnv('\n# hello\n  # indented\nA=1\n\n');
  assert.deepEqual({ ...parsed }, { A: '1' });
});

test('parseDotEnv accepts whitespace before keys and around equals', () => {
  const parsed = parseDotEnv('  A  =  value  \n');
  assert.equal(parsed.A, 'value');
});

test('parseDotEnv supports export prefixes', () => {
  const parsed = parseDotEnv('export A=1\nexport   B=two\n');
  assert.equal(parsed.A, '1');
  assert.equal(parsed.B, 'two');
});

test('parseDotEnv does not treat exportFOO as a prefix', () => {
  const parsed = parseDotEnv('exportFOO=1\n');
  assert.equal(parsed.exportFOO, '1');
});

test('parseDotEnv accepts empty unquoted values', () => {
  const parsed = parseDotEnv('A=\nB=   \n');
  assert.equal(parsed.A, '');
  assert.equal(parsed.B, '');
});

test('parseDotEnv strips inline comments preceded by whitespace', () => {
  const parsed = parseDotEnv('A=value # comment\n');
  assert.equal(parsed.A, 'value');
});

test('parseDotEnv keeps hash characters inside unquoted tokens', () => {
  const parsed = parseDotEnv('A=value#not-comment\n');
  assert.equal(parsed.A, 'value#not-comment');
});

test('parseDotEnv treats a leading hash after equals as a comment', () => {
  const parsed = parseDotEnv('A=#comment\n');
  assert.equal(parsed.A, '');
});

test('parseDotEnv single-quoted values are literal', () => {
  const parsed = parseDotEnv("A='a\\nb$c$(cmd)'\n");
  assert.equal(parsed.A, 'a\\nb$c$(cmd)');
});

test('parseDotEnv double-quoted values decode newline escape', () => {
  const parsed = parseDotEnv('A="one\\ntwo"\n');
  assert.equal(parsed.A, 'one\ntwo');
});

test('parseDotEnv double-quoted values decode carriage return escape in multiline values', () => {
  const parsed = parseDotEnv('A="one\\rtwo"\n');
  assert.equal(parsed.A, 'one\rtwo');
});

test('parseDotEnv double-quoted escaped tab is rejected in a single-line value', () => {
  const error = directError(() => parseDotEnv('A="one\\ttwo"\n'), CODE.CONTROL_CHARACTER);
  assert.equal(error.line, 1);
});

test('parseDotEnv double-quoted values decode escaped quote backslash and dollar', () => {
  const parsed = parseDotEnv('A="\\"x\\\\$home"\n');
  assert.equal(parsed.A, '"x\\$home');
});

test('parseDotEnv rejects unsupported double-quote escapes', () => {
  const error = directError(() => parseDotEnv('A="bad\\q"\n'), CODE.DOTENV_SYNTAX);
  assert.equal(error.line, 1);
  assert.equal(error.key, 'A');
});

test('parseDotEnv rejects a backslash at the end of a quoted line', () => {
  const error = directError(() => parseDotEnv('A="bad\\\nnext"\n'), CODE.DOTENV_SYNTAX);
  assert.equal(error.line, 1);
});

test('parseDotEnv supports multiline double-quoted values', () => {
  const parsed = parseDotEnv('A="one\ntwo\nthree"\nB=after\n');
  assert.equal(parsed.A, 'one\ntwo\nthree');
  assert.equal(parsed.B, 'after');
});

test('parseDotEnv supports multiline single-quoted values literally', () => {
  const parsed = parseDotEnv("A='one\ntwo\\nthree'\n");
  assert.equal(parsed.A, 'one\ntwo\\nthree');
});

test('parseDotEnv multiline values may contain tabs', () => {
  const parsed = parseDotEnv('A="one\n\tIndented"\n');
  assert.equal(parsed.A, 'one\n\tIndented');
});

test('parseDotEnv multiline values reject other control characters', () => {
  const error = directError(() => parseDotEnv('A="one\nbad\x07bell"\n'), CODE.CONTROL_CHARACTER);
  assert.equal(error.key, 'A');
});

test('parseDotEnv rejects unterminated double-quoted values', () => {
  const error = directError(() => parseDotEnv('A="one\ntwo\n'), CODE.DOTENV_SYNTAX);
  assert.equal(error.line, 1);
});

test('parseDotEnv rejects unterminated single-quoted values', () => {
  const error = directError(() => parseDotEnv("A='one\ntwo\n"), CODE.DOTENV_SYNTAX);
  assert.equal(error.line, 1);
});

test('parseDotEnv rejects trailing characters after a closing quote', () => {
  const error = directError(() => parseDotEnv('A="ok"extra\n'), CODE.DOTENV_SYNTAX);
  assert.equal(error.line, 1);
});

test('parseDotEnv permits comments after a closing quote', () => {
  const parsed = parseDotEnv('A="ok" # comment\n');
  assert.equal(parsed.A, 'ok');
});

test('parseDotEnv command substitution text is literal', () => {
  const payload = '$(definitely-not-a-real-command --bad)';
  const parsed = parseDotEnv('A=' + payload + '\n');
  assert.equal(parsed.A, payload);
});

test('parseDotEnv backtick command text is literal', () => {
  const payload = '`definitely-not-a-real-command`';
  const parsed = parseDotEnv('A=' + payload + '\n');
  assert.equal(parsed.A, payload);
});

test('parseDotEnv variable expansion text is literal', () => {
  const parsed = parseDotEnv('A=$HOME ${PATH} $B\n');
  assert.equal(parsed.A, '$HOME ${PATH} $B');
});

test('parseDotEnv quoted command substitution text is literal', () => {
  const payload = '$(printf forged)';
  const parsed = parseDotEnv('A="' + payload + '"\n');
  assert.equal(parsed.A, payload);
});

test('parseDotEnv duplicate keys throw by default', () => {
  const error = directError(() => parseDotEnv('A=1\nA=2\n'), CODE.DUPLICATE_KEY);
  assert.equal(error.line, 2);
  assert.equal(error.key, 'A');
});

test('parseDotEnv duplicate policy first keeps the first value', () => {
  const parsed = parseDotEnv('A=1\nA=2\n', { onDuplicate: 'first' });
  assert.equal(parsed.A, '1');
});

test('parseDotEnv duplicate policy last keeps the last value', () => {
  const parsed = parseDotEnv('A=1\nA=2\n', { onDuplicate: 'last' });
  assert.equal(parsed.A, '2');
});

test('parseDotEnv rejects an invalid duplicate policy', () => {
  directError(() => parseDotEnv('A=1', { onDuplicate: 'merge' }), CODE.INVALID_INPUT);
});

for (const key of ['__proto__', 'constructor', 'prototype']) {
  test('parseDotEnv rejects prototype pollution key ' + key, () => {
    const error = directError(() => parseDotEnv(key + '=1\n'), CODE.PROTOTYPE_KEY);
    assert.equal(error.key, key);
  });
}

test('parseDotEnv permits uppercase lookalikes that are not prototype keys', () => {
  const parsed = parseDotEnv('CONSTRUCTOR=1\nPROTOTYPE=2\n');
  assert.equal(parsed.CONSTRUCTOR, '1');
  assert.equal(parsed.PROTOTYPE, '2');
});

for (const line of ['1A=value', '-A=value', '.A=value', 'A B=value', 'export =value']) {
  test('parseDotEnv rejects invalid key line ' + JSON.stringify(line), () => {
    directError(() => parseDotEnv(line + '\n'), CODE.DOTENV_SYNTAX);
  });
}

for (const line of ['A', 'A value', 'A value=']) {
  test('parseDotEnv rejects missing equals in line ' + JSON.stringify(line), () => {
    directError(() => parseDotEnv(line + '\n'), CODE.DOTENV_SYNTAX);
  });
}

test('parseDotEnv rejects null bytes in values', () => {
  const error = directError(() => parseDotEnv('A=ok\0bad\n'), CODE.NULL_BYTE);
  assert.equal(error.key, 'A');
});

test('parseDotEnv rejects control characters in unquoted values', () => {
  directError(() => parseDotEnv('A=ok\x07bad\n'), CODE.CONTROL_CHARACTER);
});

test('parseDotEnv rejects control characters in single-line quoted values', () => {
  directError(() => parseDotEnv('A="ok\x07bad"\n'), CODE.CONTROL_CHARACTER);
});

test('parseDotEnv rejects Unicode line separator characters', () => {
  directError(() => parseDotEnv('A=ok\u2028bad\n'), CODE.CONTROL_CHARACTER);
});

test('parseDotEnv normalizes CRLF line endings', () => {
  const parsed = parseDotEnv('A=1\r\nB=2\r\n');
  assert.equal(parsed.A, '1');
  assert.equal(parsed.B, '2');
});

test('parseDotEnv multiline CR input is normalized to LF', () => {
  const parsed = parseDotEnv('A="one\rtwo"\n');
  assert.equal(parsed.A, 'one\ntwo');
});

test('parseDotEnv enforces maxBytes using UTF-8 bytes', () => {
  directError(() => parseDotEnv('A=éé\n', { maxBytes: 4 }), CODE.LIMIT_EXCEEDED);
});

test('parseDotEnv maxBytes accepts input at the exact boundary', () => {
  const parsed = parseDotEnv('A=1\n', { maxBytes: 4 });
  assert.equal(parsed.A, '1');
});

test('parseDotEnv enforces maxEntries', () => {
  directError(() => parseDotEnv('A=1\nB=2\n', { maxEntries: 1 }), CODE.LIMIT_EXCEEDED);
});

test('parseDotEnv maxEntries counts unique keys not duplicate lines', () => {
  const parsed = parseDotEnv('A=1\nA=2\n', { maxEntries: 1, onDuplicate: 'last' });
  assert.equal(parsed.A, '2');
});

test('parseDotEnv enforces maxKeyLength', () => {
  const key = 'A'.repeat(9);
  directError(() => parseDotEnv(key + '=1\n', { maxKeyLength: 8 }), CODE.LIMIT_EXCEEDED);
});

test('parseDotEnv enforces maxValueLength', () => {
  directError(() => parseDotEnv('A=123456789\n', { maxValueLength: 8 }), CODE.LIMIT_EXCEEDED);
});

test('parseDotEnv enforces maxValueLength after escape decoding', () => {
  directError(() => parseDotEnv('A="\\n\\n\\n\\n"\n', { maxValueLength: 3 }), CODE.LIMIT_EXCEEDED);
});

test('parseDotEnv rejects unknown options', () => {
  directError(() => parseDotEnv('A=1', { strict: true }), CODE.INVALID_INPUT);
});

test('parseDotEnv rejects non-string input', () => {
  for (const input of [null, undefined, 4, {}, []]) {
    directError(() => parseDotEnv(input), CODE.INVALID_INPUT);
  }
});

test('parseDotEnv positive limits must be valid integers', () => {
  for (const options of [
    { maxBytes: 0 }, { maxEntries: 0 }, { maxKeyLength: 0 }, { maxValueLength: 0 },
    { maxBytes: 1.5 }, { maxEntries: Number.MAX_SAFE_INTEGER + 1 }
  ]) {
    directError(() => parseDotEnv('A=1', options), CODE.INVALID_INPUT);
  }
});

test('parseDotEnv handles a key named export exactly', () => {
  const parsed = parseDotEnv('export=1\n');
  assert.equal(parsed.export, '1');
});

test('parseDotEnv does not expose object prototype pollution through output', () => {
  const parsed = parseDotEnv('A=1\n');
  assert.equal(parsed.polluted, undefined);
  assert.equal({}.polluted, undefined);
});

test('loadEnvFile reads and parses a UTF-8 file', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'envcage-test-'));
  try {
    const file = path.join(directory, '.env');
    fs.writeFileSync(file, 'A=1\nB="two\nthree"\n', 'utf8');
    const parsed = loadEnvFile(file);
    assert.equal(parsed.A, '1');
    assert.equal(parsed.B, 'two\nthree');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('loadEnvFile required false returns an empty frozen object for ENOENT', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'envcage-test-'));
  try {
    const missing = path.join(directory, 'missing.env');
    const parsed = loadEnvFile(missing, { required: false });
    assert.deepEqual({ ...parsed }, {});
    assert.equal(Object.isFrozen(parsed), true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('loadEnvFile required true throws for a missing file', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'envcage-test-'));
  try {
    const missing = path.join(directory, 'missing.env');
    directError(() => loadEnvFile(missing), CODE.FILE);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('loadEnvFile forwards parser options without leaking required', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'envcage-test-'));
  try {
    const file = path.join(directory, '.env');
    fs.writeFileSync(file, 'A=1\nA=2\n', 'utf8');
    const parsed = loadEnvFile(file, { required: false, onDuplicate: 'last' });
    assert.equal(parsed.A, '2');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('loadEnvFile rejects null byte paths', () => {
  directError(() => loadEnvFile('bad\0path'), CODE.NULL_BYTE);
});

test('loadEnvFile rejects invalid file paths', () => {
  for (const input of ['', null, undefined, 4]) {
    directError(() => loadEnvFile(input), CODE.INVALID_INPUT);
  }
});

test('loadEnvFile rejects unknown options', () => {
  directError(() => loadEnvFile('x', { strict: true }), CODE.INVALID_INPUT);
});

test('loadEnvFile enforces maxBytes while reading', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'envcage-test-'));
  try {
    const file = path.join(directory, '.env');
    fs.writeFileSync(file, 'A=' + 'x'.repeat(100), 'utf8');
    directError(() => loadEnvFile(file, { maxBytes: 16 }), CODE.LIMIT_EXCEEDED);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('loadEnvFile accepts a file at the exact maxBytes boundary', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'envcage-test-'));
  try {
    const file = path.join(directory, '.env');
    fs.writeFileSync(file, 'A=1', 'utf8');
    const parsed = loadEnvFile(file, { maxBytes: 3 });
    assert.equal(parsed.A, '1');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('loadEnvFile invalid required option uses invalid input', () => {
  directError(() => loadEnvFile('missing', { required: 'no' }), CODE.INVALID_INPUT);
});

test('parseDotEnv rejects bidirectional formatting controls in values', () => {
  directError(() => parseDotEnv('A=safe\u202Eevil\n'), CODE.CONTROL_CHARACTER);
});

test('parseDotEnv accepts one UTF-8 byte order mark at the start', () => {
  const parsed = parseDotEnv('\uFEFFA=1\nB=2\n');
  assert.equal(parsed.A, '1');
  assert.equal(parsed.B, '2');
});

test('parseDotEnv rejects a byte order mark away from the start', () => {
  directError(() => parseDotEnv('A=safe\uFEFFevil\n'), CODE.CONTROL_CHARACTER);
});

test('parseDotEnv rejects Unicode format controls in values', () => {
  directError(() => parseDotEnv('A=safe\u200Bevil\n'), CODE.CONTROL_CHARACTER);
});

test('parseDotEnv rejects non-ASCII whitespace around keys and equals', () => {
  directError(() => parseDotEnv('\u00A0A=1\n'), CODE.DOTENV_SYNTAX);
  directError(() => parseDotEnv('A\u00A0=1\n'), CODE.DOTENV_SYNTAX);
});

test('loadEnvFile accepts a UTF-8 byte order mark', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'envcage-test-'));
  try {
    const file = path.join(directory, '.env');
    fs.writeFileSync(file, '\uFEFFA=1\n', 'utf8');
    assert.equal(loadEnvFile(file).A, '1');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('loadEnvFile rejects malformed UTF-8 instead of inserting replacement characters', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'envcage-test-'));
  try {
    const file = path.join(directory, '.env');
    fs.writeFileSync(file, Buffer.from([0x41, 0x3d, 0xff, 0x0a]));
    directError(() => loadEnvFile(file), CODE.FILE);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('loadEnvFile rejects non-regular file paths', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'envcage-test-'));
  try {
    directError(() => loadEnvFile(directory), CODE.FILE);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('parseDotEnv parses a dense quoted value without quote-state errors', () => {
  const payload = 'x'.repeat(100000);
  const parsed = parseDotEnv('A="' + payload + '"', { maxValueLength: 100001 });
  assert.equal(parsed.A, payload);
});

