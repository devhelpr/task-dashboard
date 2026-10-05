import { useEffect, useRef, useState } from "react";
import {
  desktop,
  getPlatform,
  launchButton,
  loadSettings,
  changeSettings,
} from "./api";
import {
  browsers,
  services,
  validateButton,
  type Browser,
  type Settings,
  type SettingsChange,
  type TaskButton,
} from "./model";
import "./App.css";

function MailIcon({ small = false }: { small?: boolean }) {
  return (
    <svg
      width={small ? 22 : 28}
      height={small ? 22 : 28}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="m4 7 8 6 8-6" />
    </svg>
  );
}
function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [view, setView] = useState<"dashboard" | "settings">("dashboard");
  const [platform, setPlatform] = useState("");
  const [editing, setEditing] = useState<TaskButton | null>(null);
  const [deleting, setDeleting] = useState<TaskButton | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [launching, setLaunching] = useState<string | null>(null);
  const [formError, setFormError] = useState("");
  const editor = useRef<HTMLDialogElement>(null);
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    Promise.all([loadSettings(), getPlatform()])
      .then(([data, os]) => {
        if (!active) return;
        setSettings(data);
        setPlatform(os);
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (editing) {
      editor.current?.showModal();
      nameInput.current?.focus();
    } else editor.current?.close();
  }, [editing?.id]);
  useEffect(() => {
    if (deleting) deleteDialog.current?.showModal();
    else deleteDialog.current?.close();
  }, [deleting]);

  async function persist(change: SettingsChange): Promise<boolean> {
    setBusy(true);
    setError("");
    try {
      const next = await changeSettings(change);
      setSettings(next);
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  function edit(button?: TaskButton) {
    setFormError("");
    setError("");
    setNotice("");
    setEditing(
      button
        ? structuredClone(button)
        : {
            id: crypto.randomUUID(),
            name: "",
            action: {
              type: "webmail",
              browser: "default",
              url: services[0].url,
            },
          },
    );
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!editing || !settings) return;
    const button = {
      ...editing,
      name: editing.name.trim(),
      action: { ...editing.action, url: editing.action.url.trim() },
    };
    const message = validateButton(button);
    if (message) {
      setFormError(message);
      return;
    }
    const exists = settings.buttons.some((b) => b.id === button.id);
    if (await persist({ type: exists ? "update" : "add", button })) {
      setEditing(null);
      setNotice(exists ? "Button updated." : "Button added.");
    }
  }
  async function remove() {
    if (
      settings &&
      deleting &&
      (await persist({
        type: "delete",
        id: deleting.id,
      }))
    ) {
      setDeleting(null);
      setNotice("Button deleted.");
    }
  }
  async function move(id: string, direction: "up" | "down") {
    if (await persist({ type: "move", id, direction }))
      setNotice("Button order updated.");
  }
  async function launch(button: TaskButton) {
    setLaunching(button.id);
    setError("");
    setNotice("");
    try {
      await launchButton(button.id);
      setNotice(`Opened ${button.name}.`);
    } catch (e) {
      setError(String(e));
    } finally {
      setLaunching(null);
    }
  }
  const browserLabel = (browser: Browser) =>
    browsers.find((b) => b.value === browser)?.label;
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">
            <MailIcon small />
          </span>
          <span>
            task dashboard
            <span className="brand-caption">A little less clicking.</span>
          </span>
        </div>
        <nav aria-label="Main navigation">
          <button
            className={
              view === "dashboard" ? "nav-button selected" : "nav-button"
            }
            onClick={() => {
              setView("dashboard");
              setNotice("");
            }}
            aria-current={view === "dashboard" ? "page" : undefined}
          >
            Dashboard
          </button>
          <button
            className={
              view === "settings" ? "nav-button selected" : "nav-button"
            }
            onClick={() => {
              setView("settings");
              setNotice("");
            }}
            aria-current={view === "settings" ? "page" : undefined}
          >
            Settings
          </button>
        </nav>
      </header>
      <main>
        {!desktop && (
          <p className="preview-note">
            Browser preview · Settings are saved in this browser. Launch tasks
            from the desktop app.
          </p>
        )}
        <div className="page-heading">
          <div>
            <p className="eyebrow">
              {view === "dashboard" ? "YOUR DAILY SHORTCUTS" : "MAKE IT YOURS"}
            </p>
            <h1>
              {view === "dashboard"
                ? "Ready when you are."
                : "Your buttons, your way."}
            </h1>
            <p className="subtitle">
              {view === "dashboard"
                ? "Choose a task. We’ll take you straight there."
                : "Give every shortcut a name, a destination, and a browser."}
            </p>
          </div>
          {view === "settings" && (
            <button
              className="primary"
              disabled={!settings || busy || settings.buttons.length >= 100}
              onClick={() => edit()}
            >
              ＋ Add button
            </button>
          )}
        </div>
        <div aria-live="polite">
          {notice && <p className="notice">✓ {notice}</p>}
        </div>
        {error && !editing && !deleting && (
          <p role="alert" className="error">
            {error}
            {!settings && (
              <button
                onClick={() => {
                  setError("");
                  loadSettings()
                    .then(setSettings)
                    .catch((e) => setError(String(e)));
                }}
              >
                Retry
              </button>
            )}
          </p>
        )}
        {!settings && !error && <p role="status">Loading your dashboard…</p>}
        {settings && view === "dashboard" && (
          <section className="tasks" aria-label="Task buttons">
            {settings.buttons.map((button, index) => (
              <button
                className="task"
                key={button.id}
                onClick={() => launch(button)}
                disabled={launching !== null}
              >
                <span className={`task-icon tone-${index % 3}`}>
                  <MailIcon />
                </span>
                <span className="task-copy">
                  <strong>{button.name}</strong>
                  <span>
                    {new URL(button.action.url).hostname}{" "}
                    <span className="dot">·</span>{" "}
                    {browserLabel(button.action.browser)}
                  </span>
                </span>
                <span className="task-arrow" aria-hidden="true">
                  {launching === button.id ? "…" : "↗"}
                </span>
              </button>
            ))}
          </section>
        )}
        {settings && view === "settings" && (
          <section className="settings-list" aria-label="Manage buttons">
            <div className="list-heading">
              <span>BUTTONS</span>
              <span>{settings.buttons.length} configured</span>
            </div>
            {settings.buttons.map((button, index) => (
              <article className="settings-row" key={button.id}>
                <span className={`task-icon tone-${index % 3}`}>
                  <MailIcon small />
                </span>
                <div className="row-copy">
                  <h2>{button.name}</h2>
                  <p>
                    {browserLabel(button.action.browser)}{" "}
                    <span className="dot">·</span>{" "}
                    {new URL(button.action.url).hostname}
                  </p>
                </div>
                <div className="row-actions">
                  <button
                    className="icon-button"
                    aria-label={`Move ${button.name} up`}
                    disabled={busy || index === 0}
                    onClick={() => move(button.id, "up")}
                  >
                    ↑
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Move ${button.name} down`}
                    disabled={busy || index === settings.buttons.length - 1}
                    onClick={() => move(button.id, "down")}
                  >
                    ↓
                  </button>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => edit(button)}
                  >
                    Edit<span className="sr-only"> {button.name}</span>
                  </button>
                  <button
                    className="text-button danger"
                    disabled={busy}
                    onClick={() => {
                      setError("");
                      setDeleting(button);
                    }}
                  >
                    Delete<span className="sr-only"> {button.name}</span>
                  </button>
                </div>
              </article>
            ))}
          </section>
        )}
        {settings?.buttons.length === 0 && (
          <div className="empty">
            <span className="empty-icon">
              <MailIcon />
            </span>
            <h2>A fresh start.</h2>
            <p>Add your first button to put your email one click away.</p>
            <button className="primary" onClick={() => edit()}>
              ＋ Add a button
            </button>
          </div>
        )}
        {settings && (
          <footer>
            <span className="status-dot" />{" "}
            {view === "dashboard"
              ? `${settings.buttons.length} shortcuts. One place.`
              : "Changes are saved automatically after each action."}
            <span className="footer-right">TASK DASHBOARD / 01</span>
          </footer>
        )}
      </main>
      <dialog
        ref={editor}
        onCancel={(e) => {
          if (busy) e.preventDefault();
          else setEditing(null);
        }}
        aria-labelledby="editor-title"
      >
        {editing && (
          <form onSubmit={submit}>
            <div className="dialog-heading">
              <div>
                <p className="eyebrow">WEBMAIL SHORTCUT</p>
                <h2 id="editor-title">
                  {settings?.buttons.some((b) => b.id === editing.id)
                    ? "Edit button"
                    : "Add a button"}
                </h2>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Close editor"
                disabled={busy}
                onClick={() => setEditing(null)}
              >
                ×
              </button>
            </div>
            <label htmlFor="button-name">Button name</label>
            <input
              ref={nameInput}
              id="button-name"
              value={editing.name}
              placeholder="e.g. Work email"
              required
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            />
            <label htmlFor="service">Email environment</label>
            <select
              id="service"
              value={
                services.some((s) => s.url === editing.action.url)
                  ? editing.action.url
                  : "custom"
              }
              onChange={(e) =>
                setEditing({
                  ...editing,
                  action: {
                    ...editing.action,
                    url: e.target.value === "custom" ? "" : e.target.value,
                  },
                })
              }
            >
              {services.map((s) => (
                <option key={s.url} value={s.url}>
                  {s.name}
                </option>
              ))}
              <option value="custom">Custom webmail address</option>
            </select>
            <label htmlFor="url">Web address</label>
            <input
              id="url"
              type="url"
              required
              value={editing.action.url}
              placeholder="https://mail.example.com"
              onChange={(e) =>
                setEditing({
                  ...editing,
                  action: { ...editing.action, url: e.target.value },
                })
              }
            />
            <p className="field-hint">
              Use an HTTPS address. Sign in securely in your browser.
            </p>
            <label htmlFor="browser">Open with</label>
            <select
              id="browser"
              value={editing.action.browser}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  action: {
                    ...editing.action,
                    browser: e.target.value as Browser,
                  },
                })
              }
            >
              {browsers
                .filter((b) => b.value !== "safari" || platform === "macos")
                .map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.label}
                  </option>
                ))}
            </select>
            <p className="field-hint">
              The selected browser must be installed on this computer.
            </p>
            {(formError || error) && (
              <p className="error" role="alert">
                {formError || error}
              </p>
            )}
            <div className="dialog-actions">
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setEditing(null)}
              >
                Cancel
              </button>
              <button className="primary" disabled={busy}>
                {busy ? "Saving…" : "Save button"}
              </button>
            </div>
          </form>
        )}
      </dialog>
      <dialog
        ref={deleteDialog}
        onCancel={(e) => {
          if (busy) e.preventDefault();
          else setDeleting(null);
        }}
        aria-labelledby="delete-title"
      >
        <h2 id="delete-title">Delete this button?</h2>
        <p>“{deleting?.name}” will be removed from your dashboard.</p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button
            className="secondary"
            disabled={busy}
            onClick={() => setDeleting(null)}
          >
            Keep button
          </button>
          <button
            className="primary delete-button"
            disabled={busy}
            onClick={remove}
          >
            {busy ? "Deleting…" : "Delete button"}
          </button>
        </div>
      </dialog>
    </div>
  );
}
export default App;
