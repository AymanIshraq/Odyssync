"""Run the self-contained browser checks, optionally capture preview screenshots.

Usage: python app/control/check_browser.py [--screenshots]
Requires installed Chrome; no Python packages or Node installation needed.
"""
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse
import os
import subprocess
import tempfile
import threading

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        if self.path.startswith('/phone-review?'):
            # Chrome clamps native headless windows to ~500px. Use an actual
            # 390px iframe instead of mislabelling a clipped desktop viewport.
            scene = self.path.split('?')[-1]
            if scene not in ('landing', 'room', 'join'):
                scene = 'landing'
            html = ('<!doctype html><html><body style="margin:0;background:#061630">'
                    '<iframe title="390px phone preview" style="display:block;width:390px;'
                    'height:1000px;margin:20px auto;border:0" '
                    f'src="/app/control/preview.html?scene={scene}"></iframe></body></html>')
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.end_headers()
            self.wfile.write(html.encode())
        else:
            super().do_GET()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--screenshots', action='store_true')
    args = parser.parse_args()
    chrome = Path(os.environ.get('PROGRAMFILES', 'C:/Program Files')) / 'Google/Chrome/Application/chrome.exe'
    if not chrome.exists():
        raise SystemExit('Chrome was not found in Program Files.')
    root = Path(__file__).resolve().parents[2]
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(root)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    output = Path(tempfile.mkdtemp(prefix='odyssync-ui1-review-'))
    base = f'http://127.0.0.1:{server.server_port}/app/control/'
    def run(url, extra):
        profile = tempfile.mkdtemp(prefix='odyssync-chrome-')
        process = subprocess.run([str(chrome), '--headless', '--disable-gpu', '--no-first-run',
            '--user-data-dir='+profile, '--virtual-time-budget=3000', *extra, base+url],
            capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=45)
        if process.returncode:
            raise RuntimeError(process.stderr[-2000:])
        return process.stdout
    try:
        html = run('tests.html', ['--dump-dom'])
        (output/'tests-result.html').write_text(html, encoding='utf-8')
        start = html.find('<pre id="results">') + len('<pre id="results">')
        print(html[start:html.find('</pre>',start)])
        passed = '<title>PASS</title>' in html
        if args.screenshots:
            scenes = [('landing',1440,1000),('room',1440,1320),('join',1440,1000),
                      ('create',1440,1000),('requests',1440,1000),('permissions',1440,1000),('landing-phone',390,1000),('room-phone',390,1000),('join-phone',390,1000)]
            def capture(scene):
                label,width,height=scene
                path=output/(label+'.png')
                url=('../../phone-review?'+label.split('-')[0]) if 'phone' in label else 'preview.html?scene='+label
                if 'phone' in label:
                    width,height=500,1040
                run(url, [f'--window-size={width},{height}', '--hide-scrollbars', '--screenshot='+str(path)])
                if not path.exists():
                    raise RuntimeError('Screenshot was not written: '+str(path))
            with ThreadPoolExecutor(max_workers=3) as executor:
                list(executor.map(capture,scenes))
        print('Review artifacts:',output)
        return 0 if passed else 1
    finally:
        server.shutdown()

if __name__ == '__main__':
    raise SystemExit(main())
