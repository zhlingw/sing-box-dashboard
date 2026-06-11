import { useState } from "react";

import {
  createServerId,
  normalizeServerUrl,
  serverDisplayName,
  type Server,
  type ServersState,
} from "../api/config";
import type { ThemePreference } from "../app/context";
import { LanguageSelect, useI18n } from "../app/i18n";
import { Icon } from "../components/Icon";
import { Dialog, Field } from "../components/ui";

export function SettingsView(props: {
  serversState: ServersState;
  onServersChange: (state: ServersState) => void;
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
}) {
  const { t } = useI18n();
  const { servers, activeId } = props.serversState;
  const [editing, setEditing] = useState<Server | "new" | null>(null);

  const saveServer = (server: Server) => {
    const exists = servers.some((entry) => entry.id === server.id);
    const next = exists
      ? servers.map((entry) => (entry.id === server.id ? server : entry))
      : [...servers, server];
    props.onServersChange({ servers: next, activeId: exists ? activeId : activeId ?? server.id });
    setEditing(null);
  };

  const removeServer = (id: string) => {
    const next = servers.filter((entry) => entry.id !== id);
    props.onServersChange({
      servers: next,
      activeId: activeId === id ? (next[0]?.id ?? null) : activeId,
    });
    setEditing(null);
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">{t("Settings")}</h1>
      </div>
      <div className="settings-section">
        <div className="settings-section-header">
          <h2 className="settings-section-title">{t("Servers")}</h2>
          <button className="icon-button" title={t("Add server")} onClick={() => setEditing("new")}>
            <Icon name="add" size={15} />
          </button>
        </div>
        {servers.map((server) => (
          <div className="settings-row" key={server.id}>
            <button className="settings-row-main" onClick={() => setEditing(server)}>
              <span className="server-row-name">{serverDisplayName(server)}</span>
              <span className="server-row-url">{server.url}</span>
              <span className="settings-row-chevron">
                <Icon name="keyboard_arrow_right" size={14} />
              </span>
            </button>
          </div>
        ))}
      </div>
      <div className="settings-section">
        <h2 className="settings-section-title">{t("Preferences")}</h2>
        <div className="settings-row">
          <span className="settings-row-label">{t("Appearance")}</span>
          <div className="icon-segmented">
            {(
              [
                { value: "auto", icon: "brightness_auto", title: t("System") },
                { value: "light", icon: "light_mode", title: t("Light") },
                { value: "dark", icon: "dark_mode", title: t("Dark") },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                title={option.title}
                className={props.theme === option.value ? "active" : ""}
                onClick={() => props.onThemeChange(option.value)}
              >
                <Icon name={option.icon} size={15} />
              </button>
            ))}
          </div>
        </div>
        <div className="settings-row">
          <span className="settings-row-label">{t("Language")}</span>
          <LanguageSelect className="select inline" />
        </div>
      </div>
      {editing !== null && (
        <ServerDialog
          server={editing === "new" ? null : editing}
          canDelete={editing !== "new" && servers.length > 0}
          onSave={saveServer}
          onDelete={removeServer}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

export function ServerDialog(props: {
  server: Server | null;
  canDelete: boolean;
  onSave: (server: Server) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(props.server?.name ?? "");
  const [url, setUrl] = useState(props.server?.url ?? "");
  const [secret, setSecret] = useState(props.server?.secret ?? "");

  const normalizedUrl = normalizeServerUrl(url);
  const valid = normalizedUrl !== "";

  return (
    <Dialog onClose={props.onClose}>
      <h3>{props.server ? t("Edit Server") : t("New Server")}</h3>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid) {
            return;
          }
          props.onSave({
            id: props.server?.id ?? createServerId(),
            name: name.trim(),
            url: normalizedUrl,
            secret,
          });
        }}
      >
        <Field label={t("Name")}>
          <input
            className="input"
            value={name}
            placeholder={t("Optional")}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label={t("URL")}>
          <input
            className="input"
            value={url}
            placeholder={t("Required")}
            autoFocus={!props.server}
            onChange={(event) => setUrl(event.target.value)}
          />
        </Field>
        <Field label={t("Secret")}>
          <input
            className="input"
            value={secret}
            placeholder={t("Optional")}
            autoComplete="off"
            onChange={(event) => setSecret(event.target.value)}
          />
        </Field>
        <div className="row-actions" style={{ marginTop: 14 }}>
          {props.server && props.canDelete && (
            <button
              className="button danger"
              type="button"
              style={{ marginInlineEnd: "auto" }}
              onClick={() => props.onDelete(props.server!.id)}
            >
              {t("Delete")}
            </button>
          )}
          <button className="button" type="button" onClick={props.onClose}>
            {t("Cancel")}
          </button>
          <button className="button primary" type="submit" disabled={!valid}>
            {t("Save")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
