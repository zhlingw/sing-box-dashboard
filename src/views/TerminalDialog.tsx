import { useEffect, useRef, useState } from "react";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import { GrpcWebSocketStream } from "../api/websocket";
import { useApi } from "../app/context";
import { useI18n } from "../app/i18n";
import { Dialog } from "../components/ui";
import {
  TailscaleSSHClientMessageSchema,
  TailscaleSSHServerMessageSchema,
} from "../gen/daemon/started_service_pb";

export interface SSHSessionOptions {
  endpointTag: string;
  peerAddress: string;
  peerName: string;
  username: string;
  terminalType: string;
  hostKeys: string[];
}

export function TerminalDialog(props: { session: SSHSessionOptions; onClose: () => void }) {
  const api = useApi();
  const { t } = useI18n();
  const hostRef = useRef<HTMLDivElement>(null);
  const [statusLine, setStatusLine] = useState<string | null>(null);

  // Read t through a ref inside the stream callbacks: a language switch must
  // not re-run the effect, which would tear down a live SSH session.
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    const terminal = new Terminal({
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      fontSize: 13,
      cursorBlink: true,
      theme: {
        background: "#181818",
        foreground: "#ededed",
        cursor: "#ededed",
        selectionBackground: "rgba(255, 255, 255, 0.25)",
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    fit.fit();
    terminal.focus();

    let ready = false;
    const stream = new GrpcWebSocketStream({
      config: api.config,
      service: "daemon.StartedService",
      method: "StartTailscaleSSHSession",
      requestSchema: TailscaleSSHClientMessageSchema,
      responseSchema: TailscaleSSHServerMessageSchema,
      onMessage: (message) => {
        switch (message.message.case) {
          case "authBanner":
            terminal.write(message.message.value.message.replaceAll("\n", "\r\n"));
            break;
          case "ready":
            ready = true;
            setStatusLine(null);
            break;
          case "output":
            terminal.write(message.message.value.data);
            break;
          case "exit": {
            const exit = message.message.value;
            let text = tRef.current("Session exited with code {code}", { code: exit.exitCode });
            if (exit.signal !== "") {
              text += ` ${tRef.current("(signal {signal})", { signal: exit.signal })}`;
            }
            if (exit.errorMessage !== "") {
              text += `: ${exit.errorMessage}`;
            }
            setStatusLine(text);
            break;
          }
          case "error":
            setStatusLine(message.message.value.message);
            break;
        }
      },
      onEnd: (status, error) => {
        if (status && status.code !== 0) {
          setStatusLine(
            status.message || tRef.current("Stream ended with status {code}", { code: status.code }),
          );
        } else if (error && !ready) {
          setStatusLine(error);
        } else {
          setStatusLine((current) => current ?? tRef.current("Session closed"));
        }
        terminal.options.cursorBlink = false;
      },
    });

    stream.send({
      message: {
        case: "start",
        value: {
          endpointTag: props.session.endpointTag,
          peerAddress: props.session.peerAddress,
          username: props.session.username,
          terminalType: props.session.terminalType,
          columns: terminal.cols,
          rows: terminal.rows,
          hostKeys: props.session.hostKeys,
        },
      },
    });
    setStatusLine(tRef.current("Connecting..."));

    const encoder = new TextEncoder();
    const dataSubscription = terminal.onData((data) => {
      stream.send({
        message: {
          case: "input",
          value: { data: encoder.encode(data) },
        },
      });
    });
    const resizeSubscription = terminal.onResize((size) => {
      stream.send({
        message: {
          case: "resize",
          value: { columns: size.cols, rows: size.rows },
        },
      });
    });
    const resizeObserver = new ResizeObserver(() => {
      fit.fit();
    });
    resizeObserver.observe(host);

    return () => {
      resizeObserver.disconnect();
      dataSubscription.dispose();
      resizeSubscription.dispose();
      stream.close();
      terminal.dispose();
    };
  }, [api, props.session]);

  return (
    <Dialog onClose={props.onClose} className="terminal-dialog">
      <h3 style={{ marginBottom: 10 }}>
        {props.session.username}@{props.session.peerName}
        {statusLine && (
          <span className="hint" style={{ marginLeft: 10, fontFamily: "var(--font-sans)" }}>
            {statusLine}
          </span>
        )}
      </h3>
      <div className="terminal-host" ref={hostRef} />
    </Dialog>
  );
}
