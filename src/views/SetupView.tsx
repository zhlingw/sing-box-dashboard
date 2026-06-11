import { useEffect, useRef, useState } from "react";

import { createServerId, normalizeServerUrl, type Server } from "../api/config";
import { DaemonApi } from "../api/daemon";
import { LanguageSelect, useI18n, type Translate } from "../app/i18n";
import { Icon } from "../components/Icon";
import { Field, Spinner } from "../components/ui";

const CONNECT_TIMEOUT_MS = 8000;

// Probe the server by waiting for the first service-status message; any
// response (even an auth error) proves more than a generic fetch failure.
async function testConnection(server: Server, signal: AbortSignal, t: Translate): Promise<void> {
  const api = new DaemonApi(server);
  for await (const _ of api.client.subscribeServiceStatus({}, { signal })) {
    void _;
    return;
  }
  throw new Error(t("Stream ended without a status message"));
}

// Browsers report every blocked request as a bare "Failed to fetch"; the
// actual reason is only visible in the devtools console.
export function describeConnectError(error: unknown, t: Translate): string {
  return describeConnectMessage(error instanceof Error ? error.message : String(error), t);
}

export function describeConnectMessage(message: string, t: Translate): string {
  if (message.includes("Failed to fetch")) {
    return `${message} — ${t(
      "The server is unreachable, or the browser blocked the request (HTTPS page with an HTTP server, or access_control_allow_origin does not allow this origin); the exact reason is only shown in the browser console.",
    )}`;
  }
  return message;
}

export function SetupView(props: { onCreate: (server: Server) => void }) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const normalizedUrl = normalizeServerUrl(url);
  const valid = normalizedUrl !== "";

  const submit = async () => {
    if (!valid || connecting) {
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setConnecting(true);
    setError("");
    try {
      const server: Server = {
        id: createServerId(),
        name: name.trim(),
        url: normalizedUrl,
        secret,
      };
      // Race a hard timeout so the UI always recovers, even if the transport
      // swallows the abort signal.
      await Promise.race([
        testConnection(server, controller.signal, t),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(
              new Error(
                t("Connection timed out after {seconds} seconds", {
                  seconds: CONNECT_TIMEOUT_MS / 1000,
                }),
              ),
            );
          }, CONNECT_TIMEOUT_MS);
        }),
      ]);
      props.onCreate(server);
    } catch (connectError) {
      setError(describeConnectError(connectError, t));
    } finally {
      clearTimeout(timer);
      setConnecting(false);
    }
  };

  return (
    <div className="setup">
      <div className="setup-panel">
        <div className="setup-brand">
          sing-box
          <small>dashboard</small>
        </div>
        <h1>{t("Add a server")}</h1>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Field label={t("Name")}>
            <input
              className="input"
              value={name}
              placeholder={t("Optional")}
              disabled={connecting}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label={t("URL")}>
            <input
              className="input"
              value={url}
              placeholder={t("Required")}
              autoFocus
              disabled={connecting}
              onChange={(event) => setUrl(event.target.value)}
            />
          </Field>
          <Field label={t("Secret")}>
            <input
              className="input"
              value={secret}
              placeholder={t("Optional")}
              autoComplete="off"
              disabled={connecting}
              onChange={(event) => setSecret(event.target.value)}
            />
          </Field>
          {error !== "" && (
            <div className="banner error">
              <Icon name="warning_amber" />
              <div>{error}</div>
            </div>
          )}
          <div className="row-actions" style={{ marginTop: 6 }}>
            <button className="button primary" type="submit" disabled={!valid || connecting}>
              {connecting && <Spinner />}
              {connecting ? t("Connecting...") : t("Connect")}
            </button>
          </div>
        </form>
        <div className="setup-language">
          <Icon name="language" size={14} />
          <LanguageSelect className="select inline" />
        </div>
      </div>
    </div>
  );
}
