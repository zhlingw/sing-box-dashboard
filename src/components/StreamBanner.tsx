import type { StreamSnapshot } from "../api/stream";
import { useI18n, type MessageKey } from "../app/i18n";
import { Icon } from "./Icon";

export function StreamBanner(props: { snapshot: StreamSnapshot<unknown>; subject: MessageKey }) {
  const { t } = useI18n();
  if (props.snapshot.phase !== "error") {
    return null;
  }
  return (
    <div className="banner error">
      <Icon name="warning_amber" />
      <div>
        {t("Failed to subscribe to {subject}: {error}", {
          subject: t(props.subject),
          error: props.snapshot.error ?? "",
        })}
        <div className="hint">{t("Check the server address and secret in Settings.")}</div>
      </div>
    </div>
  );
}
