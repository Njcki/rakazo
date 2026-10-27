import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import type { ComponentProps } from "react";
import Ionicons from "@react-native-vector-icons/ionicons";
import { rpc } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { native, useMobileTokens } from "../lib/native";
import { NativeSymbol } from "./native-symbol";

type PlanStepStatus = "todo" | "in_progress" | "done" | "blocked" | "skipped";
type PlanStep = {
  id: string;
  index: number;
  title: string;
  status: PlanStepStatus;
  notes: string;
  blockedBy: number[];
};
type AgentPlan = {
  id: string;
  title: string;
  status: "active" | "completed" | "cancelled";
  progress: { done: number; total: number; percent: number };
  steps: PlanStep[];
};

type IonName = ComponentProps<typeof Ionicons>["name"];

/** Vector icons matching web PlanSection (lucide Check / CircleDot / Circle / Lock / Minus). */
function statusIcon(
  status: PlanStepStatus,
  muted: string,
): { ios: string; android: IonName; color: string } {
  switch (status) {
    case "done":
      return { ios: "checkmark", android: "checkmark", color: "#10b981" };
    case "in_progress":
      return { ios: "circle.inset.filled", android: "radio-button-on", color: "#0ea5e9" };
    case "blocked":
      return { ios: "lock.fill", android: "lock-closed", color: "#f59e0b" };
    case "skipped":
      return { ios: "minus", android: "remove", color: muted };
    default:
      return { ios: "circle", android: "ellipse-outline", color: muted };
  }
}

/** Native mirror of the web PlanSection: active plan, or the last completed one until replaced. */
export function PlanSection({ botId, pollMs = 4000 }: { botId: string; pollMs?: number }) {
  const tokens = useMobileTokens();
  const { t } = useI18n();
  const [plan, setPlan] = useState<AgentPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  async function refresh() {
    const current = ++generation.current;
    try {
      const result = await rpc<AgentPlan | null>("plans/active", { botId });
      if (current !== generation.current) return;
      setPlan(result ?? null);
      setError(null);
    } catch {
      if (current !== generation.current) return;
      setError(t("Could not load plan"));
    }
  }

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), pollMs);
    return () => {
      generation.current += 1;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botId, pollMs]);

  const completed = plan?.status === "completed";
  return (
    <View style={{ marginTop: 20 }} testID="bot-plan">
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <NativeSymbol ios="checklist" android="list-outline" size={16} color={tokens.mutedForeground} />
        <Text style={{ color: tokens.mutedForeground, fontSize: 14, flex: 1 }} numberOfLines={1}>
          {t("Plan")}
          {plan?.title ? ` · ${plan.title}` : ""}
        </Text>
        {completed ? (
          <Text
            style={{
              color: "#10b981",
              backgroundColor: "rgba(16,185,129,0.15)",
              fontSize: 11,
              fontWeight: "600",
              paddingHorizontal: 8,
              paddingVertical: 2,
              borderRadius: 10,
              overflow: "hidden",
            }}
          >
            {t("Completed")}
          </Text>
        ) : null}
        {plan ? (
          <Text style={{ color: tokens.mutedForeground, fontSize: 12 }}>
            {plan.progress.done}/{plan.progress.total} · {plan.progress.percent}%
          </Text>
        ) : null}
      </View>
      {plan ? (
        <View
          style={{
            marginTop: 8,
            borderRadius: 14,
            backgroundColor: native.fill,
            padding: 12,
            gap: 6,
          }}
        >
          <View
            accessibilityRole="progressbar"
            accessibilityLabel={t("Plan progress")}
            accessibilityValue={{ min: 0, max: 100, now: plan.progress.percent }}
            style={{ height: 5, borderRadius: 3, backgroundColor: tokens.border, overflow: "hidden" }}
          >
            <View
              style={{
                height: 5,
                width: `${plan.progress.percent}%`,
                backgroundColor: completed ? "#10b981" : "#0ea5e9",
              }}
            />
          </View>
          {plan.steps.map((step) => {
            const doneLike = step.status === "done" || step.status === "skipped";
            const icon = statusIcon(step.status, tokens.mutedForeground);
            return (
              <View key={step.id} style={{ flexDirection: "row", gap: 8, paddingVertical: 2 }}>
                <View style={{ marginTop: 2 }}>
                  <NativeSymbol ios={icon.ios} android={icon.android} size={15} color={icon.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      fontSize: 14,
                      color: doneLike ? tokens.mutedForeground : tokens.foreground,
                      textDecorationLine: doneLike ? "line-through" : "none",
                      fontWeight: step.status === "in_progress" ? "600" : "400",
                    }}
                  >
                    {step.index}. {step.title}
                  </Text>
                  {step.blockedBy.length > 0 ? (
                    <Text style={{ fontSize: 12, color: tokens.mutedForeground }}>
                      {t("Depends on")} {step.blockedBy.map((n) => `#${n}`).join(", ")}
                    </Text>
                  ) : null}
                  {step.notes ? (
                    <Text style={{ fontSize: 12, color: tokens.mutedForeground }}>{step.notes}</Text>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      ) : (
        <Text style={{ color: tokens.mutedForeground, fontSize: 13, marginTop: 6, opacity: 0.8 }}>
          {t(
            "No plan yet. The bot creates one for multi-step work; completed plans stay here until replaced.",
          )}
        </Text>
      )}
      {error ? <Text style={{ color: tokens.destructive, fontSize: 12.5, marginTop: 4 }}>{error}</Text> : null}
    </View>
  );
}
