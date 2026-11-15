import { useEffect, useRef, useState } from 'react';

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};
export function InstallApp() {
  const [event, setEvent] = useState<InstallEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const display = matchMedia('(display-mode: standalone)');
    const update = () => setInstalled(display.matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
    const capture = (e: Event) => { e.preventDefault(); setEvent(e as InstallEvent); };
    const complete = () => { setEvent(null); setInstalled(true); dialog.current?.close(); };
    const connect = () => setOnline(navigator.onLine);
    update();
    display.addEventListener('change', update);
    window.addEventListener('beforeinstallprompt', capture);
    window.addEventListener('appinstalled', complete);
    window.addEventListener('online', connect); window.addEventListener('offline', connect);
    return () => { display.removeEventListener('change', update); window.removeEventListener('beforeinstallprompt', capture); window.removeEventListener('appinstalled', complete); window.removeEventListener('online', connect); window.removeEventListener('offline', connect); };
  }, []);
  const install = async () => {
    if (event) {
      try { await event.prompt(); await event.userChoice; } catch { setError('The install prompt could not open. Use your browser menu instead.'); dialog.current?.showModal(); }
      setEvent(null);
    } else dialog.current?.showModal();
  };
  return <>
    {!online && <span className="offline-status" role="status">Offline. The demo is still available.</span>}
    {!installed && <button className="install-app-button" onClick={install}>Install app</button>}
    <dialog ref={dialog} className="install-dialog" aria-labelledby="install-heading" onClick={e => { if (e.target === e.currentTarget) dialog.current?.close(); }}>
      <div className="install-dialog-content">
        <button className="install-close" aria-label="Close install instructions" onClick={() => dialog.current?.close()}>×</button>
        <h2 id="install-heading">DeskMash on your device</h2>
        <p>Open the app in your device's browser, then add it to your home screen or desktop.</p>
        {error && <p role="alert">{error}</p>}
        <dl>
          <dt>iPhone and iPad</dt><dd>In Safari, open Share, choose Add to Home Screen, then tap Add.</dd>
          <dt>Android</dt><dd>In Chrome, open the menu and choose Install app or Add to Home screen.</dd>
          <dt>Windows</dt><dd>In Edge or Chrome, use the install icon in the address bar, or find Install in the browser menu.</dd>
        </dl>
        <p className="install-note">Installation needs a secure website address. The localhost preview works on this computer only.</p>
        <button className="button button-primary" onClick={() => dialog.current?.close()}>Got it</button>
      </div>
    </dialog>
  </>;
}
