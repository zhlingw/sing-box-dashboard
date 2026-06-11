import { useEffect, useMemo, useRef, useState } from "react";

import {
  loadServersState,
  saveServersState,
  serverDisplayName,
  type Server,
  type ServersState,
} from "./api/config";
import { DaemonApi } from "./api/daemon";
import { useStream } from "./api/stream";
import { formatUptime } from "./api/format";
import { ServiceStatus_Type, type DeprecatedWarning } from "./gen/daemon/started_service_pb";
import {
  ApiContext,
  applyTheme,
  loadThemePreference,
  navigate,
  saveThemePreference,
  useApi,
  useNow,
  watchSystemTheme,
  type ThemePreference,
} from "./app/context";
import { I18nProvider, useI18n } from "./app/i18n";
import { Icon, type IconName } from "./components/Icon";
import { Dialog } from "./components/ui";
import { ConnectionErrorView } from "./views/ConnectionErrorView";
import { ConnectionsView } from "./views/ConnectionsView";
import { GroupsView } from "./views/GroupsView";
import { LogsView } from "./views/LogsView";
import { OverviewView } from "./views/OverviewView";
import { SettingsView } from "./views/SettingsView";
import { SetupView } from "./views/SetupView";
import { NetworkQualityView, STUNTestView, ToolsView } from "./views/ToolsView";
import { TailscaleEndpointView } from "./views/TailscaleView";

export type Route =
  | { page: "overview" }
  | { page: "groups" }
  | { page: "connections" }
  | { page: "logs" }
  | { page: "tools" }
  | { page: "tools/network-quality" }
  | { page: "tools/stun" }
  | { page: "tools/tailscale"; tag: string }
  | { page: "settings" };

function routeFromHash(): Route {
  const segments = location.hash
    .replace(/^#\/?/, "")
    .split("/")
    .map(decodeURIComponent);
  switch (segments[0]) {
    case "groups":
      return { page: "groups" };
    case "connections":
      return { page: "connections" };
    case "logs":
      return { page: "logs" };
    case "tools":
      switch (segments[1]) {
        case "network-quality":
          return { page: "tools/network-quality" };
        case "stun":
          return { page: "tools/stun" };
        case "tailscale":
          return { page: "tools/tailscale", tag: segments[2] ?? "" };
        default:
          return { page: "tools" };
      }
    case "settings":
      return { page: "settings" };
    default:
      return { page: "overview" };
  }
}

export function App() {
  const [serversState, setServersState] = useState<ServersState>(() => loadServersState());
  const [theme, setTheme] = useState<ThemePreference>(() => loadThemePreference());
  const [route, setRoute] = useState<Route>(() => routeFromHash());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => watchSystemTheme(() => loadThemePreference()), []);

  useEffect(() => {
    const onHashChange = () => setRoute(routeFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const updateServers = (next: ServersState) => {
    saveServersState(next);
    setServersState(next);
  };

  const updateTheme = (next: ThemePreference) => {
    saveThemePreference(next);
    setTheme(next);
  };

  const activeServer =
    serversState.servers.find((server) => server.id === serversState.activeId) ?? null;

  return (
    <I18nProvider>
      {!activeServer ? (
        <SetupView
          onCreate={(server) => {
            updateServers({ servers: [...serversState.servers, server], activeId: server.id });
            navigate("overview");
          }}
        />
      ) : (
        <Shell
          key={activeServer.id}
          server={activeServer}
          serversState={serversState}
          onServersChange={updateServers}
          route={route}
          theme={theme}
          onThemeChange={updateTheme}
        />
      )}
    </I18nProvider>
  );
}

function Shell(props: {
  server: Server;
  serversState: ServersState;
  onServersChange: (state: ServersState) => void;
  route: Route;
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
}) {
  // Bumping the generation recreates the api, restarting every stream —
  // the manual "Retry" path, also needed for terminal errors (e.g. a wrong
  // secret) where the automatic reconnect loop has given up.
  const [generation, setGeneration] = useState(0);
  const api = useMemo(() => new DaemonApi(props.server), [props.server, generation]);
  return (
    <ApiContext.Provider value={api}>
      <ShellContent {...props} onRetry={() => setGeneration(generation + 1)} />
    </ApiContext.Provider>
  );
}

// How long an error must persist before the connection-failed screen takes
// over: long enough to span the stream's first reconnect attempt, so a
// transient blip recovers without flashing the takeover.
const CONNECTION_LOST_DELAY_MS = 1500;

function ShellContent(props: {
  server: Server;
  serversState: ServersState;
  onServersChange: (state: ServersState) => void;
  route: Route;
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  onRetry: () => void;
}) {
  const api = useApi();
  const { t } = useI18n();
  const route = props.route;
  const serviceStatus = useStream(api.serviceStatus);
  const groups = useStream(api.groups);
  const [menuOpen, setMenuOpen] = useState(false);
  const [version, setVersion] = useState<string | null>(null);

  // Latched while the daemon is unreachable: set after an error persists,
  // cleared only once the stream delivers again — the reconnect loop cycling
  // back through "connecting" keeps the takeover screen up.
  const [lostError, setLostError] = useState<string | null>(null);
  useEffect(() => {
    if (serviceStatus.phase === "active") {
      setLostError(null);
      return;
    }
    if (serviceStatus.phase !== "error") {
      return;
    }
    const message = serviceStatus.error ?? "";
    const timer = setTimeout(() => setLostError(message), CONNECTION_LOST_DELAY_MS);
    return () => clearTimeout(timer);
  }, [serviceStatus.phase, serviceStatus.error]);

  // Fetch the version once the daemon is reachable; daemons predating
  // GetVersion reject with Unimplemented, leaving the subtitle absent.
  const reachable = serviceStatus.phase === "active";
  useEffect(() => {
    if (!reachable || version !== null) {
      return;
    }
    let cancelled = false;
    api.getVersion().then(
      (value) => {
        if (!cancelled && value) {
          setVersion(value);
        }
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [api, reachable, version]);

  // Mobile drawer: close whenever navigation lands on a new page.
  useEffect(() => {
    setMenuOpen(false);
  }, [route]);

  const started = serviceStatus.data.status?.status === ServiceStatus_Type.STARTED;
  const hasGroups = started && groups.data.loaded && groups.data.groups.length > 0;
  const known = serviceStatus.phase !== "connecting" || serviceStatus.data.status !== null;

  // Mirror the macOS sidebar: Groups and Connections exist only while the
  // service runs; fall back to Overview when the current page disappears.
  // While the groups stream has not delivered yet, visibility is unknown —
  // don't redirect, or a refresh on the Groups page would bounce away.
  const groupsKnown = groups.data.loaded || groups.phase === "error";
  useEffect(() => {
    if (!known) {
      return;
    }
    const invisible =
      (route.page === "groups" && (!started || (groupsKnown && !hasGroups))) ||
      (route.page === "connections" && !started) ||
      (route.page === "tools/tailscale" && !started);
    if (invisible) {
      navigate(route.page === "tools/tailscale" ? "tools" : "overview");
    }
  }, [known, started, groupsKnown, hasGroups, route]);

  if (lostError !== null) {
    return (
      <ConnectionErrorView
        server={props.server}
        error={lostError}
        reconnecting={serviceStatus.phase === "connecting"}
        onRetry={props.onRetry}
        serversState={props.serversState}
        onServersChange={props.onServersChange}
      />
    );
  }

  const navItem = (page: string, title: string, icon: IconName, active: boolean) => (
    <button
      key={page}
      className={active ? "nav-item active" : "nav-item"}
      onClick={() => {
        setMenuOpen(false);
        navigate(page);
      }}
    >
      <Icon name={icon} />
      {title}
    </button>
  );

  return (
    <div className="app">
      <header className="mobile-topbar">
        <button
          className="icon-button"
          aria-label={t("Toggle navigation")}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <Icon name={menuOpen ? "close" : "menu"} size={18} />
        </button>
        <div className="mobile-topbar-brand">sing-box</div>
        <ServiceStateLine />
      </header>
      {menuOpen && <div className="sidebar-scrim" onClick={() => setMenuOpen(false)} />}
      <nav className={menuOpen ? "sidebar open" : "sidebar"}>
        <div className="sidebar-brand">
          sing-box
          {version && <span className="sidebar-brand-version">{version}</span>}
        </div>
        <ServerPicker
          serversState={props.serversState}
          onServersChange={props.onServersChange}
        />
        {navItem("overview", t("Overview"), "dashboard", route.page === "overview")}
        {hasGroups && navItem("groups", t("Groups"), "folder", route.page === "groups")}
        {started && navItem("connections", t("Connections"), "swap_vert", route.page === "connections")}
        {navItem("logs", t("Logs"), "text_snippet", route.page === "logs")}
        {navItem("tools", t("Tools"), "terminal", route.page.startsWith("tools"))}
        {navItem("settings", t("Settings"), "settings", route.page === "settings")}
        <div className="sidebar-footer">
          <ServiceStateLine />
        </div>
      </nav>
      <main className="content">
        {route.page === "overview" && <OverviewView />}
        {route.page === "groups" && <GroupsView />}
        {route.page === "connections" && <ConnectionsView />}
        {route.page === "logs" && <LogsView />}
        {route.page === "tools" && <ToolsView />}
        {route.page === "tools/network-quality" && <NetworkQualityView />}
        {route.page === "tools/stun" && <STUNTestView />}
        {route.page === "tools/tailscale" && <TailscaleEndpointView tag={route.tag} />}
        {route.page === "settings" && (
          <SettingsView
            serversState={props.serversState}
            onServersChange={props.onServersChange}
            theme={props.theme}
            onThemeChange={props.onThemeChange}
          />
        )}
      </main>
      <DeprecatedWarningsGate started={started} />
    </div>
  );
}

function ServerPicker(props: {
  serversState: ServersState;
  onServersChange: (state: ServersState) => void;
}) {
  const { t } = useI18n();
  const { servers, activeId } = props.serversState;
  const active = servers.find((server) => server.id === activeId);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  if (!active) {
    return null;
  }

  return (
    <div className="server-picker" ref={ref}>
      <button className="server-picker-button" onClick={() => setOpen(!open)}>
        <Icon name="dns" size={14} />
        <span className="server-name">{serverDisplayName(active)}</span>
        <Icon name="unfold_more" size={13} />
      </button>
      {open && (
        <div className="menu">
          {servers.map((server) => (
            <button
              key={server.id}
              className="menu-item"
              onClick={() => {
                setOpen(false);
                if (server.id !== activeId) {
                  props.onServersChange({ ...props.serversState, activeId: server.id });
                }
              }}
            >
              <span className="menu-check">{server.id === activeId && <Icon name="check" size={13} />}</span>
              {serverDisplayName(server)}
            </button>
          ))}
          <div className="menu-divider" />
          <button
            className="menu-item"
            onClick={() => {
              setOpen(false);
              navigate("settings");
            }}
          >
            <span className="menu-check" />
            {t("Manage servers...")}
          </button>
        </div>
      )}
    </div>
  );
}

// Mirrors GlobalChecksModifier in sing-box-for-apple: when the service
// reaches the started state, fetch deprecated notes once and present them
// as a chain of alerts.
function DeprecatedWarningsGate(props: { started: boolean }) {
  const api = useApi();
  const [queue, setQueue] = useState<DeprecatedWarning[]>([]);
  const [visible, setVisible] = useState(false);
  const wasStarted = useRef(false);

  useEffect(() => {
    if (props.started === wasStarted.current) {
      return;
    }
    wasStarted.current = props.started;
    if (!props.started) {
      return;
    }
    let stale = false;
    api
      .getDeprecatedWarnings()
      .then((warnings) => {
        if (!stale && warnings.length > 0) {
          setQueue(warnings);
          setVisible(true);
        }
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [api, props.started]);

  const current = queue[0];
  if (!current || !visible) {
    return null;
  }

  const dismiss = () => {
    setVisible(false);
    setTimeout(() => {
      setQueue((value) => value.slice(1));
      setVisible(true);
    }, 300);
  };

  return <DeprecatedWarningDialog warning={current} onDismiss={dismiss} />;
}

function DeprecatedWarningDialog(props: { warning: DeprecatedWarning; onDismiss: () => void }) {
  const { t } = useI18n();
  return (
    <Dialog onClose={props.onDismiss}>
      <h3>{t("Deprecated Warning")}</h3>
      <p className="dialog-message">{props.warning.message}</p>
      <div className="row-actions" style={{ marginTop: 16 }}>
        <button className="button" onClick={props.onDismiss}>
          {t("Ok")}
        </button>
        {props.warning.migrationLink !== "" && (
          <a
            className="button primary"
            href={props.warning.migrationLink}
            target="_blank"
            rel="noreferrer"
            onClick={props.onDismiss}
          >
            {t("Documentation")}
          </a>
        )}
      </div>
    </Dialog>
  );
}

function ServiceStateLine() {
  const api = useApi();
  const { t } = useI18n();
  const serviceStatus = useStream(api.serviceStatus);
  const now = useNow();
  const [startedAt, setStartedAt] = useState<number | null>(null);

  const statusType = serviceStatus.data.status?.status;
  const started = statusType === ServiceStatus_Type.STARTED;

  useEffect(() => {
    if (!started) {
      setStartedAt(null);
      return;
    }
    let stale = false;
    api
      .getStartedAt()
      .then((value) => {
        if (!stale) {
          setStartedAt(value);
        }
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [api, started]);

  let dotClass = "state-dot";
  let label: string;
  if (serviceStatus.phase === "error") {
    dotClass += " bad";
    label = t("Unreachable");
  } else if (serviceStatus.phase === "connecting") {
    dotClass += " medium pulse";
    label = t("Connecting");
  } else {
    switch (statusType) {
      case ServiceStatus_Type.STARTED:
        dotClass += " good";
        label = t("Running");
        break;
      case ServiceStatus_Type.STARTING:
        dotClass += " medium pulse";
        label = t("Starting");
        break;
      case ServiceStatus_Type.STOPPING:
        dotClass += " medium";
        label = t("Stopping");
        break;
      case ServiceStatus_Type.FATAL:
        dotClass += " bad";
        label = t("Fatal");
        break;
      default:
        label = t("Idle");
        break;
    }
  }

  return (
    <div className="service-state" title={serviceStatus.error}>
      <span className={dotClass} />
      {label}
      {started && startedAt !== null && <span className="uptime">{formatUptime(startedAt, now)}</span>}
    </div>
  );
}
