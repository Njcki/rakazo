import { useContext, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { mobileTokens } from "../../lib/appearance";
import type { ContinuationStatus } from "../../lib/continuation";
import { ContinuationControlContext, continuationLabel } from "../../lib/continuation";
import { useI18n } from "../../lib/i18n";

/** Status line of a continue_later chain, with «Stop» while the next part is still scheduled. */
export function ContinuationLine({
  status,
  messageId,
}: {
  status: ContinuationStatus;
  messageId: string;
}) {
  const { t } = useI18n();
  const tokens = mobileTokens();
  const control = useContext(ContinuationControlContext);
  const [stopped, setStopped] = useState(false);
  const canStop =
    status.state === "scheduled" &&
    !stopped &&
    !!control.stop &&
    control.latestMessageId === messageId;
  return (
    <View
      testID="continuation-line"
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        flexWrap: "wrap",
        gap: 8,
        paddingVertical: 4,
      }}
    >
      <Text style={{ color: tokens.warning, fontSize: 13 }}>◷</Text>
      <Text style={{ color: tokens.mutedForeground, fontSize: 13 }}>
        {stopped ? t("Automatic continuation stopped") : continuationLabel(status)}
      </Text>
      {canStop ? (
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => {
            setStopped(true);
            void Promise.resolve(control.stop?.()).catch(() => setStopped(false));
          }}
        >
          <Text style={{ color: tokens.primary, fontSize: 13, fontWeight: "600" }}>
            {t("Stop")}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
