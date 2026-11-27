import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walk(directory, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'coverage') continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full, output);
    else if (entry.isFile()) output.push(full);
  }
  return output;
}

function trackedTextFiles() {
  return walk(root).filter((file) => {
    const base = path.basename(file);
    if (base.endsWith('.tgz') || base.endsWith('.log')) return false;
    return true;
  });
}

function readRelative(file) {
  return fs.readFileSync(file, 'utf8');
}

test('repository has the required contributor surface files', () => {
  for (const file of [
    'README.md', 'SECURITY.md', 'CONTRIBUTING.md', 'GOOD_FIRST_ISSUES.md',
    'LICENSE', '.gitattributes', '.github/workflows/ci.yml',
    '.github/ISSUE_TEMPLATE/bug_report.md',
    '.github/ISSUE_TEMPLATE/feature_request.md',
    '.github/PULL_REQUEST_TEMPLATE.md'
  ]) {
    assert.equal(fs.existsSync(path.join(root, file)), true, file);
  }
});

test('license is the MIT license text', () => {
  const license = readRelative(path.join(root, 'LICENSE'));
  assert.match(license, /MIT License/);
  assert.match(license, /Permission is hereby granted/);
});

test('good first issues file contains exactly 10 scoped ideas', () => {
  const text = readRelative(path.join(root, 'GOOD_FIRST_ISSUES.md'));
  const count = (text.match(/^## \d+\./gm) || []).length;
  assert.equal(count, 10);
});

test('README reports a numeric verified test count', () => {
  const readme = readRelative(path.join(root, 'README.md'));
  assert.match(readme, /\*\*Tests:\*\* [1-9][0-9]+ passing with `npm test`/);
});

test('README documents honest scope and limitations', () => {
  const readme = readRelative(path.join(root, 'README.md'));
  assert.match(readme, /## Scope and limitations/);
  assert.match(readme, /not a secret manager/);
  assert.match(readme, /does not implement shell expansion/);
});

test('SECURITY documents private reporting and scope', () => {
  const security = readRelative(path.join(root, 'SECURITY.md'));
  assert.match(security, /Report a vulnerability/);
  assert.match(security, /## Scope/);
  assert.match(security, /out of scope/);
});

test('no tracked file contains em dash or en dash characters', () => {
  const emDash = String.fromCharCode(8212);
  const enDash = String.fromCharCode(8211);
  const offenders = [];
  for (const file of trackedTextFiles()) {
    const text = readRelative(file);
    if (text.includes(emDash) || text.includes(enDash)) offenders.push(path.relative(root, file));
  }
  assert.deepEqual(offenders, []);
});

test('no tracked file contains a local absolute user path', () => {
  const offenders = [];
  const unixHome = '/' + 'Users' + '/';
  const windowsHome = 'C:' + '\\' + 'Users' + '\\';
  for (const file of trackedTextFiles()) {
    const text = readRelative(file);
    if (text.includes(unixHome) || text.includes(windowsHome)) offenders.push(path.relative(root, file));
  }
  assert.deepEqual(offenders, []);
});

test('no tracked file contains personal contact or address markers', () => {
  const offenders = [];
  const markers = [
    'someone@' + 'gmail.com',
    'handle-redacted' + '286',
    'Exampleton' + ' Manor'
  ];
  for (const file of trackedTextFiles()) {
    const text = readRelative(file);
    if (markers.some((marker) => text.includes(marker))) offenders.push(path.relative(root, file));
  }
  assert.deepEqual(offenders, []);
});

test('no tracked file contains a co-author trailer', () => {
  const trailer = 'Co-' + 'Authored-' + 'By:';
  const offenders = [];
  for (const file of trackedTextFiles()) {
    if (readRelative(file).includes(trailer)) offenders.push(path.relative(root, file));
  }
  assert.deepEqual(offenders, []);
});

test('tracked text files use LF line endings', () => {
  const offenders = [];
  for (const file of trackedTextFiles()) {
    if (readRelative(file).includes('\r')) offenders.push(path.relative(root, file));
  }
  assert.deepEqual(offenders, []);
});

test('gitattributes forces LF checkout for every text file', () => {
  const attributes = readRelative(path.join(root, '.gitattributes'));
  assert.match(attributes, /^\* text=auto eol=lf$/m);
});

test('package manifest has no install lifecycle scripts', () => {
  const pkg = JSON.parse(readRelative(path.join(root, 'package.json')));
  for (const script of ['preinstall', 'install', 'postinstall', 'prepublish', 'prepublishOnly']) {
    assert.equal(pkg.scripts[script], undefined, script);
  }
});

test('package manifest has zero dependencies of every kind', () => {
  const pkg = JSON.parse(readRelative(path.join(root, 'package.json')));
  assert.deepEqual(pkg.dependencies, {});
  assert.deepEqual(pkg.devDependencies, {});
  assert.equal(pkg.peerDependencies, undefined);
  assert.equal(pkg.optionalDependencies, undefined);
});

test('library source imports only node:fs', () => {
  const source = readRelative(path.join(root, 'src', 'index.mjs'));
  const imports = source.match(/^import .*$/gm) || [];
  assert.deepEqual(imports, ["import { openSync, readSync, closeSync, fstatSync, constants as fsConstants } from 'node:fs';"]);
});

test('library source contains no eval Function constructor child process or network API', () => {
  const source = readRelative(path.join(root, 'src', 'index.mjs'));
  for (const forbidden of ['eval(', 'new Function', 'child_process', 'fetch(', 'XMLHttpRequest', 'node:http', 'node:https']) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});

test('README avoids unsupported marketing claims', () => {
  const readme = readRelative(path.join(root, 'README.md')).toLowerCase();
  for (const word of ['blazing', 'revolutionary', 'world-class', 'unhackable', 'military grade']) {
    assert.equal(readme.includes(word), false, word);
  }
});

test('gitignore excludes dependency and archive artifacts', () => {
  const gitignore = readRelative(path.join(root, '.gitignore'));
  assert.match(gitignore, /node_modules\//);
  assert.match(gitignore, /\*\.tgz/);
});

test('CI does not publish packages', () => {
  const ci = readRelative(path.join(root, '.github', 'workflows', 'ci.yml'));
  const publishText = 'npm' + ' ' + 'publish';
  assert.equal(ci.includes(publishText), false);
});

test('README test count is at least the required red-team floor', () => {
  const readme = readRelative(path.join(root, 'README.md'));
  const match = /\*\*Tests:\*\* ([0-9]+) passing/.exec(readme);
  assert.ok(match, 'missing test count');
  assert.ok(Number(match[1]) >= 220, 'test count below floor');
});
