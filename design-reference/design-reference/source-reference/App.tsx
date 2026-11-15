import { useEffect, useRef, useState } from "react";

import { InstallApp } from "./components/InstallApp";
import { useLocalPreference } from "./useLocalPreference";

type Mode = "focus" | "collaborative" | "approval";
type View = "landing" | "workspace";
type Dialog = "create" | "join" | "requests" | "permissions" | "rename" | null;

const icons = {
  plus: <path d="M12 5v14M5 12h14" />,
  users: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" />
    </>
  ),
  lock: (
    <>
      <rect width="14" height="11" x="5" y="11" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  chevron: <path d="m9 18 6-6-6-6" />,
  shield: (
    <>
      <path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  layout: (
    <>
      <rect width="7" height="7" x="3" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="3" rx="1" />
      <rect width="7" height="7" x="3" y="14" rx="1" />
      <rect width="7" height="7" x="14" y="14" rx="1" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3A1.7 1.7 0 0 0 14 21v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14h-.2v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9A1.7 1.7 0 0 0 21 10h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
    </>
  ),
  bell: (
    <>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M10 21h4" />
    </>
  ),
  file: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6" />
    </>
  ),
  close: <path d="m6 6 12 12M18 6 6 18" />,
  check: <path d="m5 12 4 4L19 6" />,
  logOut: (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5M21 12H9" />
    </>
  ),
  moon: <path d="M20.8 15.2A9 9 0 1 1 8.8 3.2a7 7 0 0 0 12 12Z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
};

function Icon({ name, size = 20 }: { name: keyof typeof icons; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {icons[name]}
    </svg>
  );
}

function Logo() {
  return (
    <div className="logo">
      <span className="logo-symbol">
        <i />
        <i />
      </span>
      <strong>deskmash</strong>
    </div>
  );
}

function LaptopArt({ color = "blue" }: { color?: "blue" | "orange" | "lime" }) {
  return (
    <div className={`laptop-art ${color}`}>
      <div className="laptop-screen">
        <span />
        <span />
      </div>
      <div className="laptop-base" />
    </div>
  );
}

function ParticleField({ dark }: { dark: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const pointer = { x: -9999, y: -9999, active: false };
    let width = 0;
    let height = 0;
    let frame = 0;
    let visible = true;
    let particles: {
      x: number;
      y: number;
      vx: number;
      vy: number;
      radius: number;
      accent: boolean;
    }[] = [];

    const textColor = dark ? "226,234,248" : "22,54,112";
    const accentColor = dark ? "203,255,24" : "255,118,24";
    const connectionDistance = () => (width < 640 ? 110 : 150);

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = bounds.width;
      height = bounds.height;
      canvas.width = width * pixelRatio;
      canvas.height = height * pixelRatio;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      const baseCount = width < 640 ? 26 : 52;
      const count = Math.round(baseCount * Math.min(1.4, Math.max(0.7, width / 1100)));
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.22,
        vy: (Math.random() - 0.5) * 0.22,
        radius: Math.random() * 1.4 + 0.8,
        accent: Math.random() < 0.12,
      }));
    };

    const drawConnections = (staticOpacity = false) => {
      const threshold = connectionDistance();
      for (let index = 0; index < particles.length; index += 1) {
        for (let next = index + 1; next < particles.length; next += 1) {
          const first = particles[index];
          const second = particles[next];
          const distance = Math.hypot(first.x - second.x, first.y - second.y);
          if (distance < threshold) {
            const opacity = (1 - distance / threshold) * (staticOpacity ? 0.22 : 0.25);
            context.strokeStyle = `rgba(${textColor},${opacity})`;
            context.lineWidth = 0.7;
            context.beginPath();
            context.moveTo(first.x, first.y);
            context.lineTo(second.x, second.y);
            context.stroke();
          }
        }
      }
    };

    const drawStatic = () => {
      context.clearRect(0, 0, width, height);
      drawConnections(true);
      particles.forEach((particle) => {
        context.fillStyle = particle.accent
          ? `rgba(${accentColor},0.75)`
          : `rgba(${textColor},0.5)`;
        context.beginPath();
        context.arc(particle.x, particle.y, particle.radius, 0, 7);
        context.fill();
      });
    };

    const animate = () => {
      frame = window.requestAnimationFrame(animate);
      if (!visible) return;
      context.clearRect(0, 0, width, height);
      drawConnections();

      particles.forEach((particle) => {
        particle.x += particle.vx;
        particle.y += particle.vy;
        if (particle.x < 0 || particle.x > width) particle.vx *= -1;
        if (particle.y < 0 || particle.y > height) particle.vy *= -1;

        let pointerActive = false;
        if (pointer.active) {
          const deltaX = pointer.x - particle.x;
          const deltaY = pointer.y - particle.y;
          const distance = Math.hypot(deltaX, deltaY);
          if (distance < 170) {
            pointerActive = true;
            const attraction = (1 - distance / 170) * 0.035;
            particle.x += deltaX * attraction;
            particle.y += deltaY * attraction;
            context.strokeStyle = `rgba(${accentColor},${(1 - distance / 170) * 0.55})`;
            context.lineWidth = 0.8;
            context.beginPath();
            context.moveTo(pointer.x, pointer.y);
            context.lineTo(particle.x, particle.y);
            context.stroke();
          }
        }

        context.fillStyle =
          particle.accent || pointerActive
            ? `rgba(${accentColor},${pointerActive ? 0.95 : 0.75})`
            : `rgba(${textColor},0.5)`;
        context.beginPath();
        context.arc(particle.x, particle.y, particle.radius + (pointerActive ? 1.2 : 0), 0, 7);
        context.fill();
      });
    };

    const trackPointer = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      pointer.x = event.clientX - bounds.left;
      pointer.y = event.clientY - bounds.top;
      pointer.active = true;
    };
    const clearPointer = () => {
      pointer.active = false;
      pointer.x = -9999;
      pointer.y = -9999;
    };

    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    const intersectionObserver = new IntersectionObserver(
      (entries) => {
        visible = entries[0].isIntersecting;
      },
      { threshold: 0 },
    );
    intersectionObserver.observe(canvas);

    if (reducedMotion) {
      drawStatic();
    } else {
      window.addEventListener("pointermove", trackPointer, { passive: true });
      window.addEventListener("pointerleave", clearPointer);
      frame = window.requestAnimationFrame(animate);
    }

    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      window.removeEventListener("pointermove", trackPointer);
      window.removeEventListener("pointerleave", clearPointer);
    };
  }, [dark]);

  return <canvas ref={canvasRef} className="particle-field" aria-hidden="true" />;
}

const modes: { id: Mode; label: string; description: string }[] = [
  { id: "focus", label: "Focus", description: "Block all incoming shares" },
  { id: "collaborative", label: "Collaborative", description: "Share without approval" },
  { id: "approval", label: "Approval", description: "Ask before every share" },
];

export default function App() {
  const [view, setView] = useState<View>("landing");
  const [dark, setDark] = useLocalPreference("dark", true);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [mode, setMode] = useLocalPreference<Mode>("mode", "approval");
  const [isManager, setIsManager] = useState(true);
  const [memberApproved, setMemberApproved] = useState(false);
  const [workspaceName, setWorkspaceName] = useLocalPreference("workspaceName", "Creative Room");
  const [renameDraft, setRenameDraft] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [requestStatus, setRequestStatus] = useLocalPreference<"pending" | "approved" | "declined">(
    "requestStatus", "pending",
  );
  const [requestTab, setRequestTab] = useState<"joining" | "leaving">("joining");
  const [shareRequest, setShareRequest] = useState(true);
  const [toast, setToast] = useState("");
  const [deviceLayout, setDeviceLayout] = useLocalPreference<"grid" | "list">("deviceLayout", "grid");
  const [showAllActivity, setShowAllActivity] = useState(false);
  const [permissions, setPermissions] = useLocalPreference<Record<string, boolean>>("permissions", { Adil: true, Ayman: true, Sara: false });
  const [permissionDraft, setPermissionDraft] = useState(permissions);

  useEffect(() => {
    if (!dialog) return;
    const root = document.querySelector<HTMLElement>('[role="dialog"]');
    const previous = document.activeElement as HTMLElement;
    const controls = () => Array.from(root?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select') ?? []);
    (root?.querySelector<HTMLInputElement>('input:not([type="checkbox"])') ?? controls()[0])?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDialog(null);
      if (event.key === "Tab") {
        const items = controls();
        if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items[items.length - 1]?.focus(); }
        else if (!event.shiftKey && document.activeElement === items[items.length - 1]) { event.preventDefault(); items[0]?.focus(); }
      }
    };
    const containFocus = (event: FocusEvent) => { if (root && !root.contains(event.target as Node)) controls()[0]?.focus(); };
    document.addEventListener("keydown", key);
    document.addEventListener("focusin", containFocus);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", key); document.removeEventListener("focusin", containFocus); document.body.style.overflow = overflow; previous?.focus(); };
  }, [dialog]);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2800);
  };

  const enterWorkspace = (manager: boolean) => {
    setIsManager(manager);
    setMemberApproved(manager);
    setView("workspace");
    setDialog(null);
    setMode(manager ? "approval" : "collaborative");
  };

  return (
    <div className={`page ${dark ? "dark" : "light"}`}>
      <div className="backdrop-shape shape-orange" />
      <div className="backdrop-shape shape-lime" />
      <div className="backdrop-lines" aria-hidden="true">
        <span />
        <span />
      </div>
      <ParticleField dark={dark} />

      {view === "landing" ? (
        <main className="landing-shell">
          <header className="window-bar">
            <Logo />
            <div className="window-actions">
              <button
                className="theme-toggle"
                onClick={() => setDark((value) => !value)}
                aria-label={dark ? "Use light theme" : "Use dark theme"}
              >
                <Icon name={dark ? "sun" : "moon"} size={16} />
              </button>
              <span className="desktop-decoration" aria-hidden="true">−</span>
              <span className="desktop-decoration" aria-hidden="true">□</span>
              <span className="desktop-decoration" aria-hidden="true">×</span>
            </div>
          </header>

          <section className="landing-content">
            <div className="hero-copy">
              <div className="product-kicker">
                <span className="live-dot" />
                Nearby sharing for laptops
              </div>
              <h1>
                Your screens.
                <br />
                One shared space.
              </h1>
              <p>Move browser tabs and files between nearby laptops on the same Wi-Fi network.</p>
              <div className="hero-actions">
                <button className="button button-primary" onClick={() => setDialog("create")}>
                  <Icon name="plus" />
                  Create a workspace
                </button>
                <button className="button button-secondary" onClick={() => setDialog("join")}>
                  <Icon name="users" />
                  Join a workspace
                </button>
              </div>
              <small>Demo workspace. No files leave this device.</small>
            </div>

            <div className="hero-visual" aria-label="Three connected laptops">
              <div className="orbit orbit-one" />
              <div className="orbit orbit-two" />
              <div className="hero-laptop top">
                <LaptopArt color="blue" />
              </div>
              <div className="hero-laptop left">
                <LaptopArt color="orange" />
              </div>
              <div className="hero-laptop right">
                <LaptopArt color="lime" />
              </div>
              <div className="connection-pulse pulse-one" />
              <div className="connection-pulse pulse-two" />
            </div>
          </section>

          <footer className="landing-footer">
            <span>DeskMash demo</span>
            <InstallApp />
            <span>Private by network design</span>
          </footer>
        </main>
      ) : (
        <main className="workspace-window">
          <header className="workspace-bar">
            <Logo />
            <button className="workspace-name" aria-label={`Rename workspace: ${workspaceName}`} onClick={() => { setRenameDraft(workspaceName); setDialog("rename"); }}>
              <strong>{workspaceName}</strong>
              <span aria-hidden="true">⌄</span>
            </button>
            {isManager && (
              <div className="room-code">
                <Icon name="lock" size={16} />
                <span>Room code</span>
                <strong>482 739</strong>
                <button onClick={async () => {
                  try {
                    await navigator.clipboard.writeText("482739");
                    notify("Room code copied");
                  } catch {
                    notify("Could not copy. Room code: 482739");
                  }
                }}>Copy</button>
              </div>
            )}
            <button
              className="icon-button"
              onClick={() => setDark((value) => !value)}
              aria-label={dark ? "Use light theme" : "Use dark theme"}
            >
              <Icon name={dark ? "sun" : "moon"} size={18} />
            </button>
          </header>

          <div className={`workspace-body ${!isManager ? "member-body" : ""}`}>
            {!isManager && !memberApproved ? (
              <section className="approval-gate" aria-labelledby="approval-title">
                <div className="approval-visual">
                  <span className="approval-ring ring-one" />
                  <span className="approval-ring ring-two" />
                  <span className="waiting-device">
                    <LaptopArt color="blue" />
                  </span>
                  <span className="manager-stamp">
                    <Icon name="shield" size={22} />
                  </span>
                </div>
                <div className="approval-copy">
                  <span className="section-index">Request sent</span>
                  <h1 id="approval-title">Waiting for the manager</h1>
                  <p>
                    Adil must approve this laptop before it can enter {workspaceName}. You cannot
                    see participants or share content while you wait.
                  </p>
                  <div className="pending-status">
                    <span className="pending-pulse" />
                    Approval pending
                  </div>
                  <div className="approval-actions">
                    <button
                      className="button button-primary"
                      onClick={() => {
                        setMemberApproved(true);
                        notify("Adil approved your laptop");
                      }}
                    >
                      Check approval
                    </button>
                    <button
                      className="cancel-request"
                      onClick={() => {
                        setView("landing");
                        setJoinCode("");
                      }}
                    >
                      Cancel request
                    </button>
                  </div>
                  <small>This prototype confirms approval when you check the request.</small>
                </div>
              </section>
            ) : (
              <>
                {isManager ? (
                  <section className="manager-tools" aria-label="Manager controls">
                    <button className="tool-card" onClick={() => setDialog("requests")}>
                      <span className="tool-icon blue">
                        <Icon name="users" />
                      </span>
                      <span>
                        <strong>People requests</strong>
                        <small>Approve joins and requests to leave.</small>
                      </span>
                      {requestStatus === "pending" && <b>1</b>}
                      <Icon name="chevron" size={18} />
                    </button>
                    <button className="tool-card" onClick={() => { setPermissionDraft({ ...permissions }); setDialog("permissions"); }}>
                      <span className="tool-icon orange">
                        <Icon name="shield" />
                      </span>
                      <span>
                        <strong>Sharing permissions</strong>
                        <small>Choose who can send tabs and files.</small>
                      </span>
                      <Icon name="chevron" size={18} />
                    </button>
                  </section>
                ) : (
                  <section className="member-welcome" aria-label="Member workspace status">
                    <span className="member-check">
                      <Icon name="check" size={17} />
                    </span>
                    <span>
                      <strong>Approved by Adil</strong>
                      <small>You can now receive content and see nearby devices.</small>
                    </span>
                    <span className="member-role">Participant</span>
                  </section>
                )}

                <section className="devices-section" aria-labelledby="devices-title">
                  <div className="section-heading">
                    <div>
                      <span className="section-index">01</span>
                      <h2 id="devices-title">Workspace devices</h2>
                    </div>
                    <button className="text-button" onClick={() => setDeviceLayout(deviceLayout === "grid" ? "list" : "grid")} aria-pressed={deviceLayout === "list"}>
                      <Icon name="layout" size={17} />
                      {deviceLayout === "grid" ? "Arrange as list" : "Arrange as grid"}
                    </button>
                  </div>
                  <div className={`device-grid ${deviceLayout === "list" ? "device-list" : ""}`}>
                    <article className="device-card manager-device">
                      <span className="device-accent blue" />
                      <LaptopArt color="blue" />
                      <h3>{isManager ? "Your laptop" : "Adil's laptop"}</h3>
                      <span className="role-badge">{isManager ? "You · Manager" : "Manager"}</span>
                    </article>
                    <article className="device-card">
                      <span className="device-accent orange" />
                      <LaptopArt color="orange" />
                      <h3>{isManager ? "Ayman's laptop" : "Your laptop"}</h3>
                      <span className="online-badge">
                        <i />
                        {isManager ? "Online" : "You · Online"}
                      </span>
                    </article>
                    <article className="device-card">
                      <span className="device-accent lime" />
                      <LaptopArt color="lime" />
                      <h3>Sara’s laptop</h3>
                      <span className="online-badge">
                        <i />
                        Online
                      </span>
                    </article>
                  </div>
                </section>

                <section className="mode-section" aria-labelledby="mode-title">
                  <div className="section-heading">
                    <div>
                      <span className="section-index">02</span>
                      <h2 id="mode-title">Incoming share mode</h2>
                    </div>
                    <p>This setting only changes what arrives on your laptop.</p>
                  </div>
                  <div className="mode-grid">
                    {modes.map((item) => (
                      <button
                        key={item.id}
                        className={`mode-card ${mode === item.id ? "selected" : ""}`}
                        onClick={() => {
                          setMode(item.id);
                          setShareRequest(item.id === "approval");
                          notify(`${item.label} mode is on`);
                        }}
                        aria-pressed={mode === item.id}
                      >
                        <span className="radio">
                          <i />
                        </span>
                        <span>
                          <strong>{item.label}</strong>
                          <small>{item.description}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                </section>

                <section className="activity-section" aria-labelledby="activity-title">
                  <div className="section-heading compact">
                    <div>
                      <span className="section-index">03</span>
                      <h2 id="activity-title">Recent activity</h2>
                    </div>
                    <button className="text-button" onClick={() => setShowAllActivity(!showAllActivity)} aria-expanded={showAllActivity}>{showAllActivity ? "Show recent" : "View all"}</button>
                  </div>
                  <div className="activity-row">
                    <span className="file-type">
                      <Icon name="file" size={17} />
                    </span>
                    <span className="activity-copy">
                      <strong>Local-network-notes.pdf</strong>
                      <small>Received from Adil</small>
                    </span>
                    <span className="activity-time">2 min ago</span>
                    <span className="complete">
                      <Icon name="check" size={14} />
                    </span>
                  </div>
                  {showAllActivity && <p className="manager-note">You are viewing all activity in this workspace. No earlier transfers.</p>}
                </section>

                <button
                  className="leave-button"
                  onClick={() => {
                    setDialog(null);
                    setToast("");
                    setView("landing");
                  }}
                >
                  <Icon name="logOut" size={17} />
                  {isManager ? "End workspace" : "Request to leave"}
                </button>
              </>
            )}
          </div>

          {(isManager || memberApproved) && mode === "approval" && shareRequest && (
            <aside className="share-notification" aria-label="Incoming share request">
              <div className="browser-icon">
                <span />
                <span />
                <span />
              </div>
              <div>
                <strong>Adil wants to send a browser tab</strong>
                <small>Understanding local network collaboration</small>
              </div>
              <button
                className="allow"
                onClick={() => {
                  setShareRequest(false);
                  notify("Browser tab accepted");
                }}
              >
                Allow
              </button>
              <button
                className="reject"
                onClick={() => {
                  setShareRequest(false);
                  notify("Browser tab declined");
                }}
              >
                Decline
              </button>
              <button
                className="notification-close"
                aria-label="Dismiss"
                onClick={() => setShareRequest(false)}
              >
                <Icon name="close" size={15} />
              </button>
            </aside>
          )}
        </main>
      )}

      {dialog === "rename" && (
        <div className="modal-backdrop" onMouseDown={() => setDialog(null)}>
          <form className="entry-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-title"
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => { if (event.key === "Escape") setDialog(null); }}
            onSubmit={(event) => {
              event.preventDefault();
              if (!renameDraft.trim()) return;
              setWorkspaceName(renameDraft.trim());
              setDialog(null);
              notify("Workspace renamed");
            }}>
            <button type="button" className="modal-close" onClick={() => setDialog(null)} aria-label="Close"><Icon name="close" /></button>
            <h2 id="rename-title">Rename workspace</h2>
            <label className="field">
              <span>Workspace name</span>
              <input autoFocus maxLength={28} value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)} />
            </label>
            <button type="submit" className="button button-primary dialog-submit" disabled={!renameDraft.trim()}>Save name</button>
            <button type="button" className="button button-secondary" onClick={() => setDialog(null)}>Cancel</button>
          </form>
        </div>
      )}

      {(dialog === "create" || dialog === "join") && (
        <div className="modal-backdrop" onMouseDown={() => setDialog(null)}>
          <section
            className="entry-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="entry-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button className="modal-close" onClick={() => setDialog(null)} aria-label="Close">
              <Icon name="close" />
            </button>
            <Logo />
            <div className={`dialog-illustration ${dialog}`}>
              {dialog === "create" ? (
                <Icon name="plus" size={27} />
              ) : (
                <Icon name="users" size={27} />
              )}
            </div>
            <h2 id="entry-title">
              {dialog === "create" ? "Create your workspace" : "Join a nearby workspace"}
            </h2>
            <p>
              {dialog === "create"
                ? "You will manage join requests and sharing permissions."
                : "Ask the workspace manager for the six-digit room code."}
            </p>

            {dialog === "create" ? (
              <label className="field">
                <span>Workspace name</span>
                <input
                  autoFocus
                  value={workspaceName}
                  maxLength={28}
                  onChange={(event) => setWorkspaceName(event.target.value)}
                />
              </label>
            ) : (
              <label className="field code-field">
                <span>Six-digit room code</span>
                <input
                  autoFocus
                  inputMode="numeric"
                  placeholder="000 000"
                  value={joinCode}
                  maxLength={6}
                  onChange={(event) =>
                    setJoinCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                />
                <small>{joinCode.length}/6 digits</small>
              </label>
            )}

            <button
              className="button button-primary dialog-submit"
              disabled={dialog === "create" ? !workspaceName.trim() : joinCode.length !== 6}
              onClick={() => enterWorkspace(dialog === "create")}
            >
              {dialog === "create" ? "Create room" : "Request to join"}
              <Icon name="chevron" size={18} />
            </button>
            <small className="privacy-note">
              DeskMash discovers devices only on your current network.
            </small>
          </section>
        </div>
      )}

      {dialog === "requests" && (
        <div className="modal-backdrop" onMouseDown={() => setDialog(null)}>
          <section
            className="manage-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="request-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button className="modal-close" onClick={() => setDialog(null)} aria-label="Close">
              <Icon name="close" />
            </button>
            <div className="dialog-heading">
              <span className="tool-icon blue">
                <Icon name="users" />
              </span>
              <div>
                <span className="section-index">Manager control</span>
                <h2 id="request-title">People requests</h2>
              </div>
            </div>
            {isManager ? (
              <>
                <div className="request-tabs">
                  <button className={requestTab === "joining" ? "active" : ""} onClick={() => setRequestTab("joining")}>
                    Joining <span>{requestStatus === "pending" ? 1 : 0}</span>
                  </button>
                  <button className={requestTab === "leaving" ? "active" : ""} onClick={() => setRequestTab("leaving")}>
                    Leaving <span>0</span>
                  </button>
                </div>
                {requestTab === "joining" && requestStatus === "pending" ? (
                <div className={`person-request ${requestStatus}`}>
                  <span className="person-avatar">MK</span>
                  <span>
                    <strong>Mika’s ThinkPad</strong>
                    <small>Wants to join this workspace</small>
                  </span>
                  {requestStatus === "pending" ? (
                    <div className="request-actions">
                      <button
                        className="approve"
                        onClick={() => {
                          setRequestStatus("approved");
                          notify("Mika can now join");
                        }}
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => {
                          setRequestStatus("declined");
                          notify("Join request declined");
                        }}
                      >
                        Decline
                      </button>
                    </div>
                  ) : (
                    <b>{requestStatus === "approved" ? "Approved" : "Declined"}</b>
                  )}
                </div>
                ) : (
                  <div className="person-request" role="status">
                    <span>
                      <strong>{requestTab === "joining" ? "No pending join requests" : "No pending leave requests"}</strong>
                      <small>{requestTab === "joining" ? "New requests to join will appear here." : "Requests to leave the workspace will appear here."}</small>
                    </span>
                  </div>
                )}
                <p className="manager-note">
                  Only the manager can approve people entering or leaving this workspace.
                </p>
              </>
            ) : (
              <div className="member-access">
                <span className="complete">
                  <Icon name="check" />
                </span>
                <h3>You are approved</h3>
                <p>Adil manages membership for this workspace.</p>
              </div>
            )}
          </section>
        </div>
      )}

      {dialog === "permissions" && (
        <div className="modal-backdrop" onMouseDown={() => setDialog(null)}>
          <section
            className="manage-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="permission-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button className="modal-close" onClick={() => setDialog(null)} aria-label="Close">
              <Icon name="close" />
            </button>
            <div className="dialog-heading">
              <span className="tool-icon orange">
                <Icon name="shield" />
              </span>
              <div>
                <span className="section-index">Room policy</span>
                <h2 id="permission-title">Sharing permissions</h2>
              </div>
            </div>
            <p className="dialog-intro">
              {isManager
                ? "Choose which people can send browser tabs and files in this room."
                : "The workspace manager controls these permissions."}
            </p>
            <div className="permission-list">
              {[
                { name: "Adil", detail: "Manager", initials: "AD", checked: true },
                {
                  name: "Ayman",
                  detail: isManager ? "You" : "Member",
                  initials: "AY",
                  checked: true,
                },
                { name: "Sara", detail: "Member", initials: "SA", checked: false },
              ].map((person) => (
                <label key={person.name} className="permission-person">
                  <span className="person-avatar">{person.initials}</span>
                  <span>
                    <strong>{person.name}</strong>
                    <small>{person.detail}</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={permissionDraft[person.name]}
                    onChange={(event) => setPermissionDraft({ ...permissionDraft, [person.name]: event.target.checked })}
                    disabled={!isManager || person.detail === "Manager"}
                  />
                  <i />
                </label>
              ))}
            </div>
            {isManager && (
              <button
                className="button button-primary save-permissions"
                onClick={() => {
                  setDialog(null);
                  setPermissions({ ...permissionDraft });
                  notify("Sharing permissions saved");
                }}
              >
                Save permissions
              </button>
            )}
          </section>
        </div>
      )}

      <div className={`toast ${toast ? "visible" : ""}`} role="status" aria-live="polite">
        <span>
          <Icon name="check" size={14} />
        </span>
        {toast}
      </div>
    </div>
  );
}
