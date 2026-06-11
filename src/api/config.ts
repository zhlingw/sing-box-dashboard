export interface Server {
  id: string;
  name: string;
  url: string;
  secret: string;
}

export interface ServersState {
  servers: Server[];
  activeId: string | null;
}

const STORAGE_KEY = "sing-box-dashboard.servers";
const LEGACY_STORAGE_KEY = "sing-box-dashboard.server";

export function createServerId(): string {
  // crypto.randomUUID only exists in secure contexts; the dashboard is
  // commonly served over plain HTTP from a LAN address.
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeServerUrl(url: string): string {
  let value = url.trim().replace(/\/+$/, "");
  if (value !== "" && !/^https?:\/\//.test(value)) {
    value = `http://${value}`;
  }
  return value;
}

export function serverDisplayName(server: Server): string {
  if (server.name.trim() !== "") {
    return server.name;
  }
  try {
    return new URL(server.url).host;
  } catch {
    return server.url;
  }
}

function migrateLegacy(): ServersState | null {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as { url?: string; secret?: string };
    if (typeof parsed.url !== "string" || parsed.url === "") {
      return null;
    }
    const server: Server = {
      id: createServerId(),
      name: "",
      url: parsed.url,
      secret: typeof parsed.secret === "string" ? parsed.secret : "",
    };
    return { servers: [server], activeId: server.id };
  } catch {
    return null;
  } finally {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  }
}

export function loadServersState(): ServersState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ServersState>;
      const servers = (parsed.servers ?? []).filter(
        (server): server is Server =>
          typeof server === "object" &&
          server !== null &&
          typeof server.id === "string" &&
          typeof server.url === "string" &&
          server.url !== "",
      );
      const normalized = servers.map((server) => ({
        ...server,
        name: typeof server.name === "string" ? server.name : "",
        secret: typeof server.secret === "string" ? server.secret : "",
      }));
      const activeId =
        typeof parsed.activeId === "string" && normalized.some((server) => server.id === parsed.activeId)
          ? parsed.activeId
          : (normalized[0]?.id ?? null);
      return { servers: normalized, activeId };
    }
  } catch {
    // fall through
  }
  const migrated = migrateLegacy();
  if (migrated) {
    saveServersState(migrated);
    return migrated;
  }
  return { servers: [], activeId: null };
}

export function saveServersState(state: ServersState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
