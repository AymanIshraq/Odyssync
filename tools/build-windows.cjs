// Run from app/: npm run dist:win. All outputs stay under build/ and dist/.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('Build this Windows x64 distribution on a Windows x64 computer.');
}
const root = path.resolve(__dirname, '..');
const appDir = path.join(root, 'app');
const venvPython = path.join(root, '.venv', 'Scripts', 'python.exe');
const python = fs.existsSync(venvPython) ? venvPython : 'python';

function run(command, args, cwd = root, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(command + ' failed (exit ' + result.status + ')');
}

run(python, ['-c', "import struct, sys; assert sys.version_info >= (3, 11) and struct.calcsize('P') == 8, 'Use 64-bit Python 3.11 or newer'"]);
run(python, ['-m', 'pip', 'install', '-r', path.join(root, 'sidecar', 'requirements-build.txt')]);
// Ready-made wake words are git-ignored; fetch them before bundling sidecar/models.
run(python, [path.join(root, 'tools', 'fetch-voice-models.py')]);
run(python, [
  '-m', 'PyInstaller', '--noconfirm', '--clean', '--onedir', '--console', '--noupx',
  '--name', 'odyssync-sidecar', '--paths', root,
  '--distpath', path.join(root, 'dist', 'sidecar'),
  '--workpath', path.join(root, 'build', 'sidecar'),
  '--specpath', path.join(root, 'build'),
  '--collect-all', 'uiautomation', '--collect-submodules', 'comtypes.gen',
  '--hidden-import', 'win32timezone', '--hidden-import', 'websockets.asyncio.client',
  '--hidden-import', 'openwakeword', '--hidden-import', 'sounddevice',
  '--add-data', path.join(root, 'sidecar', 'models') + ';sidecar/models',
  path.join(root, 'tools', 'sidecar-entry.py'),
]);

// Prove the helper can start without Python or Node directories on PATH.
const isolatedEnv = Object.fromEntries(Object.entries(process.env)
  .filter(([key]) => !/^(path|pythonhome|pythonpath)$/i.test(key)));
isolatedEnv.Path = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
run(path.join(root, 'dist', 'sidecar', 'odyssync-sidecar', 'odyssync-sidecar.exe'),
  ['--self-test'], root, isolatedEnv);

// Electron 45 installs its runtime explicitly, rather than via postinstall.
const electronDir = path.dirname(require.resolve('electron/package.json', { paths: [appDir] }));
if (!fs.existsSync(path.join(electronDir, 'dist', 'electron.exe'))) {
  run(process.execPath, [path.join(electronDir, 'install.js')], appDir);
}
const builder = require.resolve('electron-builder/cli.js', { paths: [appDir] });
run(process.execPath, [builder, '--win', '--x64', '--publish', 'never'], appDir);
console.log('Ready: portable and installer EXEs in dist/windows/');
