import { useEffect, useRef, useState } from "react";

import { formatRelativeTime } from "../api/format";
import { useStream } from "../api/stream";
import { useApi, useIsMobile, useNow } from "../app/context";
import { useI18n } from "../app/i18n";
import { Icon } from "../components/Icon";
import { StreamBanner } from "../components/StreamBanner";
import {
  Badge,
  Card,
  CopyValue,
  DataLine,
  Dialog,
  Drawer,
  EmptyState,
  Field,
  Sparkline,
} from "../components/ui";
import type {
  TailscaleEndpointStatus,
  TailscalePeer,
  TailscalePingResponse,
} from "../gen/daemon/started_service_pb";
import { TerminalDialog, type SSHSessionOptions } from "./TerminalDialog";
import { ToolsPageHeader } from "./ToolsView";

export function TailscaleEndpointView(props: { tag: string }) {
  const api = useApi();
  const { t } = useI18n();
  const tailscale = useStream(api.tailscale);
  const isMobile = useIsMobile();
  const [sshSession, setSSHSession] = useState<SSHSessionOptions | null>(null);
  const [peerDetail, setPeerDetail] = useState<string | null>(null);

  const endpoint = tailscale.data.endpoints.find((entry) => entry.endpointTag === props.tag);
  const detailPeer =
    peerDetail === "self"
      ? endpoint?.self
      : endpoint?.userGroups
          .flatMap((group) => group.peers)
          .find((peer) => peer.stableID === peerDetail);

  // On mobile the peer detail replaces the endpoint page as a pushed
  // sub-page, like the Tools sub-pages; on desktop it stays a side drawer.
  if (isMobile && endpoint && detailPeer) {
    return (
      <div className="page">
        <div className="page-header">
          <button className="back-button" onClick={() => setPeerDetail(null)}>
            <Icon name="arrow_back" size={15} />
            Tailscale
          </button>
          <h1 className="page-title">{peerDisplayName(detailPeer)}</h1>
        </div>
        <div className="hint" style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span className={`state-dot ${detailPeer.online ? "good" : ""}`} />
          {detailPeer.online ? t("Connected") : t("Not connected")}
        </div>
        <PeerDetailBody
          endpoint={endpoint}
          peer={detailPeer}
          isSelf={peerDetail === "self"}
          onClose={() => setPeerDetail(null)}
          onOpenSSH={setSSHSession}
        />
      </div>
    );
  }

  return (
    <div className="page">
      <ToolsPageHeader
        title={props.tag === "" ? "Tailscale" : t("Tailscale: {tag}", { tag: props.tag })}
      />
      <StreamBanner snapshot={tailscale} subject="Tailscale status" />
      {!tailscale.data.loaded && tailscale.phase !== "error" && (
        <EmptyState>{t("Loading...")}</EmptyState>
      )}
      {tailscale.data.loaded && !endpoint && (
        <EmptyState icon="hub">{t("Endpoint not found")}</EmptyState>
      )}
      {endpoint && <EndpointCard endpoint={endpoint} onShowPeer={setPeerDetail} />}
      {endpoint && detailPeer && (
        <PeerDetail
          endpoint={endpoint}
          peer={detailPeer}
          isSelf={peerDetail === "self"}
          onClose={() => setPeerDetail(null)}
          onOpenSSH={setSSHSession}
        />
      )}
      {sshSession && <TerminalDialog session={sshSession} onClose={() => setSSHSession(null)} />}
    </div>
  );
}

function backendStateTone(state: string): string {
  switch (state) {
    case "Running":
      return "good";
    case "NeedsLogin":
    case "NeedsMachineAuth":
      return "bad";
    case "Starting":
      return "medium";
    default:
      return "";
  }
}

function peerDisplayName(peer: TailscalePeer | undefined): string {
  if (!peer) {
    return "";
  }
  if (peer.dnsName !== "") {
    return peer.dnsName.split(".")[0];
  }
  return peer.hostName;
}

function EndpointCard(props: {
  endpoint: TailscaleEndpointStatus;
  onShowPeer: (id: string) => void;
}) {
  const { t } = useI18n();
  const endpoint = props.endpoint;
  const [exitPickerOpen, setExitPickerOpen] = useState(false);

  const allPeers = endpoint.userGroups.flatMap((group) => group.peers);
  const exitNodeCandidates = allPeers.filter((peer) => peer.exitNodeOption);

  return (
    <div className="group-card">
      <Card title={t("Status")}>
        <DataLine
          label={t("State")}
          value={
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
              <span className={`state-dot ${backendStateTone(endpoint.backendState)}`} />
              {endpoint.backendState || t("Unknown")}
            </span>
          }
        />
        {endpoint.authURL !== "" && (
          <DataLine
            label={t("Login")}
            value={
              <a href={endpoint.authURL} target="_blank" rel="noreferrer">
                {t("Open auth URL")}
              </a>
            }
          />
        )}
        {endpoint.backendState === "Running" && (
          <>
            {endpoint.self && (
              <DataLine
                label={t("This device")}
                value={
                  <button className="button small" onClick={() => props.onShowPeer("self")}>
                    {peerDisplayName(endpoint.self)}
                  </button>
                }
              />
            )}
            {exitNodeCandidates.length > 0 && (
              <DataLine
                label={t("Exit node")}
                value={
                  <button className="button small" onClick={() => setExitPickerOpen(true)}>
                    {endpoint.exitNode ? peerDisplayName(endpoint.exitNode) : t("Disabled")}
                    <Icon name="unfold_more" size={12} />
                  </button>
                }
              />
            )}
            {endpoint.userGroups.map((group) => (
              <div key={group.userID.toString()}>
                <div className="drawer-section">{group.displayName || group.loginName}</div>
                {group.peers.map((peer) => (
                  <PeerRow
                    key={peer.stableID}
                    peer={peer}
                    onOpen={() => props.onShowPeer(peer.stableID)}
                  />
                ))}
              </div>
            ))}
          </>
        )}
      </Card>
      {exitPickerOpen && (
        <ExitNodePicker
          endpoint={endpoint}
          candidates={exitNodeCandidates}
          onClose={() => setExitPickerOpen(false)}
        />
      )}
    </div>
  );
}

function PeerRow(props: { peer: TailscalePeer; onOpen: () => void }) {
  const { t, language } = useI18n();
  const peer = props.peer;
  const now = useNow(30_000);
  return (
    <button className="peer-row" onClick={props.onOpen}>
      <span className={`state-dot ${peer.online ? "good" : ""}`} />
      <span className="peer-name">{peerDisplayName(peer)}</span>
      <span className="peer-address">{peer.tailscaleIPs[0] ?? ""}</span>
      <span className="badges">
        {peer.shareeNode && <Badge tone="danger">{t("Shared in")}</Badge>}
        {peer.exitNode && <Badge tone="info">{t("Exit node")}</Badge>}
        {peer.expired && <Badge tone="danger">{t("Expired")}</Badge>}
        {!peer.expired &&
          peer.keyExpiry > 0n &&
          Number(peer.keyExpiry) * 1000 - now < 30 * 86400_000 && (
            <Badge>
              {t("Expires {time}", {
                time: formatRelativeTime(Number(peer.keyExpiry) * 1000, now, language),
              })}
            </Badge>
          )}
        {peer.sshHostKeys.length > 0 && <Badge tone="good">SSH</Badge>}
      </span>
    </button>
  );
}

function PeerDetail(props: {
  endpoint: TailscaleEndpointStatus;
  peer: TailscalePeer;
  isSelf: boolean;
  onClose: () => void;
  onOpenSSH: (session: SSHSessionOptions) => void;
}) {
  const { t } = useI18n();
  const peer = props.peer;
  return (
    <Drawer onClose={props.onClose}>
      <h3>
        <span className={`state-dot ${peer.online ? "good" : ""}`} />
        {peerDisplayName(peer)}
      </h3>
      <div className="hint">{peer.online ? t("Connected") : t("Not connected")}</div>
      <PeerDetailBody {...props} />
    </Drawer>
  );
}

function PeerDetailBody(props: {
  endpoint: TailscaleEndpointStatus;
  peer: TailscalePeer;
  isSelf: boolean;
  onClose: () => void;
  onOpenSSH: (session: SSHSessionOptions) => void;
}) {
  const api = useApi();
  const { t, language } = useI18n();
  const peer = props.peer;
  const now = useNow(30_000);
  const [sshPromptOpen, setSSHPromptOpen] = useState(false);
  const ipv4 = peer.tailscaleIPs.find((address) => !address.includes(":"));
  const ipv6 = peer.tailscaleIPs.find((address) => address.includes(":"));
  const sshAvailable = !props.isSelf && peer.online && peer.sshHostKeys.length > 0;
  const canLogout = props.isSelf && !props.endpoint.keyAuth;

  return (
    <>
      {props.isSelf && (props.endpoint.networkName !== "" || canLogout) && (
        <>
          <div className="drawer-section">{t("Network")}</div>
          {props.endpoint.networkName !== "" && (
            <DataLine label={t("Network")} value={props.endpoint.networkName} />
          )}
          {canLogout && (
            <div className="row-actions" style={{ marginTop: 6 }}>
              <button
                className="button danger small"
                onClick={() => {
                  if (confirm(t("Log out from this Tailscale network?"))) {
                    void api.tailscaleLogout(props.endpoint.endpointTag).catch(() => {});
                    props.onClose();
                  }
                }}
              >
                <Icon name="logout" size={13} />
                {t("Log out")}
              </button>
            </div>
          )}
        </>
      )}

      <div className="drawer-section">{t("Addresses")}</div>
      {peer.dnsName !== "" && (
        <DataLine label="MagicDNS" value={<CopyValue value={peer.dnsName.replace(/\.$/, "")} />} />
      )}
      <DataLine label={t("Hostname")} value={<CopyValue value={peer.hostName} />} />
      {ipv4 && <DataLine label="IPv4" value={<CopyValue value={ipv4} />} />}
      {ipv6 && <DataLine label="IPv6" value={<CopyValue value={ipv6} />} />}

      {!props.isSelf && peer.online && (
        <PingSection endpoint={props.endpoint} peer={peer} />
      )}

      <div className="drawer-section">{t("Details")}</div>
      {peer.os !== "" && <DataLine label={t("OS")} value={peer.os} />}
      <DataLine
        label={t("Key expiry")}
        value={
          peer.expired
            ? t("Expired")
            : peer.keyExpiry > 0n
              ? formatRelativeTime(Number(peer.keyExpiry) * 1000, now, language)
              : t("Disabled")
        }
      />
      {!peer.online && peer.lastSeen > 0n && (
        <DataLine
          label={t("Last seen")}
          value={formatRelativeTime(Number(peer.lastSeen) * 1000, now, language)}
        />
      )}
      {peer.exitNodeOption && (
        <DataLine label={t("Exit node")} value={peer.exitNode ? t("Active") : t("Available")} />
      )}
      {peer.shareeNode && <DataLine label={t("Shared in")} value={t("Yes")} />}
      {sshAvailable && (
        <>
          <hr className="divider" />
          <div className="row-actions">
            <button className="button primary" onClick={() => setSSHPromptOpen(true)}>
              <Icon name="terminal" size={13} />
              {t("Connect via SSH")}
            </button>
          </div>
        </>
      )}
      {sshPromptOpen && (
        <SSHPrompt
          onCancel={() => setSSHPromptOpen(false)}
          onConnect={(username, terminalType) => {
            setSSHPromptOpen(false);
            props.onClose();
            props.onOpenSSH({
              endpointTag: props.endpoint.endpointTag,
              peerAddress: ipv4 ?? peer.tailscaleIPs[0] ?? peer.dnsName,
              peerName: peerDisplayName(peer),
              username,
              terminalType,
              hostKeys: peer.sshHostKeys,
            });
          }}
        />
      )}
    </>
  );
}

function PingSection(props: { endpoint: TailscaleEndpointStatus; peer: TailscalePeer }) {
  const api = useApi();
  const { t } = useI18n();
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<number[]>([]);
  const [latest, setLatest] = useState<TailscalePingResponse | null>(null);
  const [error, setError] = useState("");
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const start = async () => {
    const controller = new AbortController();
    controllerRef.current = controller;
    setRunning(true);
    setError("");
    setHistory([]);
    setLatest(null);
    try {
      for await (const response of api.client.startTailscalePing(
        {
          endpointTag: props.endpoint.endpointTag,
          peerIP: props.peer.tailscaleIPs[0] ?? "",
        },
        { signal: controller.signal },
      )) {
        if (response.error !== "") {
          setError(response.error);
          continue;
        }
        setLatest(response);
        setHistory((current) => {
          const next = current.concat(response.latencyMs);
          return next.length > 30 ? next.slice(next.length - 30) : next;
        });
      }
    } catch (streamError) {
      if (!controller.signal.aborted) {
        setError(String(streamError));
      }
    } finally {
      setRunning(false);
    }
  };

  const stop = () => {
    controllerRef.current?.abort();
    setRunning(false);
  };

  return (
    <>
      <div className="drawer-section" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {t("Ping")}
        <button
          className="icon-button"
          style={{ marginInlineStart: "auto" }}
          title={running ? t("Stop") : t("Start")}
          onClick={() => (running ? stop() : void start())}
        >
          <Icon name={running ? "stop" : "play_arrow"} size={13} />
        </button>
      </div>
      {error !== "" && <div className="hint" style={{ color: "var(--danger)" }}>{error}</div>}
      {latest && (
        <>
          <DataLine
            label={latest.isDirect ? t("Direct connection") : t("DERP-relayed connection")}
            value={`${latest.latencyMs.toFixed(1)} ms`}
          />
          {!latest.isDirect && latest.derpRegionCode !== "" && (
            <DataLine label={t("DERP region")} value={latest.derpRegionCode} />
          )}
          {latest.isDirect && latest.endpoint !== "" && (
            <DataLine label={t("Endpoint")} value={latest.endpoint} />
          )}
          <Sparkline
            data={history}
            color={latest.isDirect ? "var(--good)" : "var(--info)"}
            height={56}
          />
        </>
      )}
      {!latest && !running && <div className="hint">{t("No data")}</div>}
    </>
  );
}

function ExitNodePicker(props: {
  endpoint: TailscaleEndpointStatus;
  candidates: TailscalePeer[];
  onClose: () => void;
}) {
  const api = useApi();
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const current = props.endpoint.exitNode?.stableID ?? "";

  const select = (stableID: string) => {
    void api.setTailscaleExitNode(props.endpoint.endpointTag, stableID).catch(() => {});
    props.onClose();
  };

  const filtered = props.candidates.filter((peer) => {
    if (search.trim() === "") {
      return true;
    }
    const query = search.trim().toLowerCase();
    return (
      peerDisplayName(peer).toLowerCase().includes(query) ||
      peer.tailscaleIPs.some((address) => address.includes(query))
    );
  });

  return (
    <Dialog onClose={props.onClose}>
      <h3>{t("Exit node")}</h3>
      <Field label={t("Search")}>
        <input
          className="input"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          autoFocus
        />
      </Field>
      <button className="peer-row" onClick={() => select("")}>
        <span className="peer-name">{t("Disabled")}</span>
        {current === "" && (
          <span className="badges">
            <Icon name="check" size={14} />
          </span>
        )}
      </button>
      {filtered.map((peer) => (
        <button className="peer-row" key={peer.stableID} onClick={() => select(peer.stableID)}>
          <span className={`state-dot ${peer.online ? "good" : ""}`} />
          <span className="peer-name">{peerDisplayName(peer)}</span>
          <span className="peer-address">{peer.tailscaleIPs[0] ?? ""}</span>
          {current === peer.stableID && (
            <span className="badges">
              <Icon name="check" size={14} />
            </span>
          )}
        </button>
      ))}
    </Dialog>
  );
}

function SSHPrompt(props: {
  onCancel: () => void;
  onConnect: (username: string, terminalType: string) => void;
}) {
  const { t } = useI18n();
  const [username, setUsername] = useState("root");
  const [terminalType, setTerminalType] = useState("xterm-256color");
  return (
    <Dialog onClose={props.onCancel}>
      <h3>{t("Connect via SSH")}</h3>
      <Field label={t("Username")}>
        <input
          className="input"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoFocus
        />
      </Field>
      <Field label={t("Terminal type")}>
        <input
          className="input"
          value={terminalType}
          onChange={(event) => setTerminalType(event.target.value)}
        />
      </Field>
      <div className="row-actions" style={{ marginTop: 14 }}>
        <button className="button" onClick={props.onCancel}>
          {t("Cancel")}
        </button>
        <button className="button primary" onClick={() => props.onConnect(username, terminalType)}>
          {t("Connect")}
        </button>
      </div>
    </Dialog>
  );
}
