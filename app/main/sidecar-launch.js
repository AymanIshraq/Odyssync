// Keep packaged resources outside app.asar: Windows must execute the real file.
const fs = require('node:fs');
const path = require('node:path');

function sidecarLaunch({ isPackaged, resourcesPath, repoRoot }) {
  if (isPackaged) {
    const executable = path.join(resourcesPath, 'sidecar', 'odyssync-sidecar.exe');
    if (!fs.existsSync(executable)) throw new Error('Bundled Windows helper is missing: ' + executable);
    return { command: executable, args: [], cwd: path.dirname(executable) };
  }

  const script = path.join(repoRoot, 'sidecar', 'win32_daemon.py');
  if (!fs.existsSync(script)) throw new Error('Windows helper script is missing: ' + script);
  const venvPython = path.join(repoRoot, '.venv', 'Scripts', 'python.exe');
  return {
    command: fs.existsSync(venvPython) ? venvPython : 'python',
    args: [script],
    cwd: repoRoot,
  };
}

module.exports = { sidecarLaunch };
