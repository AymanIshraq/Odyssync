const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { sidecarLaunch } = require('./sidecar-launch');

test('packaged helper runs from resources even with spaces and no Python on PATH', t => {
  const resourcesPath = fs.mkdtempSync(path.join(os.tmpdir(), 'Odyssync packaged '));
  t.after(() => fs.rmSync(resourcesPath, { recursive: true, force: true }));
  const executable = path.join(resourcesPath, 'sidecar', 'odyssync-sidecar.exe');
  fs.mkdirSync(path.dirname(executable));
  fs.writeFileSync(executable, '');
  const launch = sidecarLaunch({ isPackaged: true, resourcesPath });
  assert.equal(launch.command, executable);
  assert.deepEqual(launch.args, []);
  assert.equal(launch.cwd, path.dirname(executable));
});

test('missing packaged helper fails instead of using a system Python', () => {
  assert.throws(() => sidecarLaunch({ isPackaged: true, resourcesPath: path.join(os.tmpdir(), 'missing-odyssync-resources') }), /Bundled Windows helper is missing/);
});

test('source runs use the project environment when present, with a PATH fallback', t => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'Odyssync source '));
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(repoRoot, 'sidecar'));
  const script = path.join(repoRoot, 'sidecar', 'win32_daemon.py');
  fs.writeFileSync(script, '');
  assert.equal(sidecarLaunch({ isPackaged: false, repoRoot }).command, 'python');
  const venv = path.join(repoRoot, '.venv', 'Scripts');
  fs.mkdirSync(venv, { recursive: true });
  fs.writeFileSync(path.join(venv, 'python.exe'), '');
  const launch = sidecarLaunch({ isPackaged: false, repoRoot });
  assert.equal(launch.command, path.join(venv, 'python.exe'));
  assert.deepEqual(launch.args, [script]);
  assert.equal(launch.cwd, repoRoot);
});
