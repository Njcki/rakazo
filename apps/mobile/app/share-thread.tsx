import type { ThreadMessage, ThreadShare } from "@rakazo/contracts";
import * as Clipboard from "expo-clipboard";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Share,
  Text,
  TextInput,
  View,
} from "react-native";
import { glassHeaderOptions } from "../components/glass-title";
import { NativeSymbol } from "../components/native-symbol";
import { currentApiBase, rpc } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { native, useMobileTokens } from "../lib/native";
import { useSideInsets } from "../lib/side-insets";
import { errorText } from "../lib/user-error";

function shareable(blocks: ThreadMessage["blocks"]): boolean {
  return blocks.some(
    (block) => (block.kind === "text" && block.text.trim()) || block.kind === "image",
  );
}

function preview(blocks: ThreadMessage["blocks"]): string {
  for (const block of blocks) {
    if (block.kind === "text" && block.text.trim()) {
      const text = block.text.trim().replace(/\s+/g, " ");
      return text.length > 90 ? `${text.slice(0, 90)}…` : text;
    }
  }
  if (blocks.some((block) => block.kind === "image")) return "🖼";
  return "";
}

function shareUrl(token: string): string {
  return `${currentApiBase()}/share/${token}`;
}

/**
 * Create a public link for a 1:1 or group conversation: pick messages, optional
 * title/expiry, then copy or system-share the URL.
 */
export default function ShareThreadScreen() {
  const sideInsets = useSideInsets();
  const { t } = useI18n();
  const tokens = useMobileTokens();
  const router = useRouter();
  const params = useLocalSearchParams<{
    botId?: string;
    groupId?: string;
    name?: string;
  }>();
  const botId = typeof params.botId === "string" && params.botId ? params.botId : undefined;
  const groupId =
    typeof params.groupId === "string" && params.groupId ? params.groupId : undefined;
  const displayName =
    typeof params.name === "string" && params.name.trim() ? params.name.trim() : t("Conversation");
  const threadInput = botId ? { botId } : groupId ? { groupId } : null;

  const [messages, setMessages] = useState<ThreadMessage[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [shares, setShares] = useState<ThreadShare[]>([]);
  const [title, setTitle] = useState("");
  const [expiryDays, setExpiryDays] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    if (!threadInput) return [] as ThreadMessage[];
    let all: ThreadMessage[] = [];
    let before: number | undefined;
    for (;;) {
      const page = await rpc("threads/messages", { ...threadInput, before });
      all = [...page.messages, ...all];
      if (page.olderCursor == null) break;
      before = page.olderCursor;
    }
    return all;
  }, [botId, groupId]);

  useEffect(() => {
    if (!threadInput) {
      setLoadError(t("Missing chat"));
      return;
    }
    let cancelled = false;
    void loadAll()
      .then((all) => {
        if (cancelled) return;
        setMessages(all);
        setSelected(new Set(all.filter((m) => shareable(m.blocks)).map((m) => m.id)));
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(errorText(err, t("Could not load messages")));
      });
    void rpc("threadShares/list", threadInput)
      .then((rows) => {
        if (!cancelled) setShares(rows);
      })
      .catch(() => {
        if (!cancelled) setShares([]);
      });
    return () => {
      cancelled = true;
    };
  }, [botId, groupId, loadAll, t]);

  const selectable = useMemo(
    () => (messages ?? []).filter((m) => shareable(m.blocks)),
    [messages],
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function createLink() {
    if (!threadInput || creating || !messages) return;
    const messageIds = messages.filter((m) => selected.has(m.id)).map((m) => m.id);
    if (messageIds.length === 0) {
      Alert.alert(t("Pick at least one message"));
      return;
    }
    setCreating(true);
    try {
      const result = await rpc("threadShares/create", {
        ...threadInput,
        messageIds,
        title: title.trim() || undefined,
        expiresInDays: expiryDays ?? undefined,
      });
      const url = result.url || shareUrl(result.token);
      setCreatedUrl(url);
      void Clipboard.setStringAsync(url).catch(() => undefined);
      setShares(await rpc("threadShares/list", threadInput));
      await Share.share({ message: url }).catch(() => undefined);
    } catch (err: unknown) {
      Alert.alert(t("Could not create the share"), errorText(err, t("Try again.")));
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    if (!threadInput) return;
    try {
      await rpc("threadShares/revoke", { id });
      setShares(await rpc("threadShares/list", threadInput));
      if (createdUrl) {
        const token = createdUrl.split("/").pop();
        const match = shares.find((s) => s.id === id);
        if (token && match?.token === token) setCreatedUrl(null);
      }
    } catch (err: unknown) {
      Alert.alert(t("Could not revoke the share"), errorText(err, t("Try again.")));
    }
  }

  const expiryOptions: Array<{ value: number | null; label: string }> = [
    { value: null, label: t("No expiration") },
    { value: 7, label: t("After 7 days") },
    { value: 30, label: t("After 30 days") },
    { value: 90, label: t("After 90 days") },
  ];

  return (
    <>
      <Stack.Screen options={glassHeaderOptions(t("Share conversation"))} />
      <ScrollView
        style={[{ flex: 1, backgroundColor: tokens.background }, sideInsets]}
        contentContainerStyle={{ padding: 24, paddingBottom: 48, gap: 16 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <Text style={{ color: tokens.mutedForeground, fontSize: 14, lineHeight: 20 }}>
          {t(
            "Pick the messages to include. The link is public: anyone who has it can read the conversation without an account. Only text and images are shared.",
          )}
        </Text>

        {loadError ? (
          <Text style={{ color: tokens.destructive, fontSize: 14 }}>{loadError}</Text>
        ) : messages === null ? (
          <View style={{ paddingVertical: 24, alignItems: "center", gap: 8 }}>
            <ActivityIndicator color={tokens.foreground} />
            <Text style={{ color: tokens.mutedForeground }}>{t("Loading messages…")}</Text>
          </View>
        ) : (
          <>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <Text style={{ color: tokens.mutedForeground, fontSize: 13 }}>
                {t("{selected} of {total} messages", {
                  selected: String(selected.size),
                  total: String(selectable.length),
                })}
              </Text>
              <View style={{ flexDirection: "row", gap: 16 }}>
                <Pressable
                  onPress={() => setSelected(new Set(selectable.map((m) => m.id)))}
                  hitSlop={8}
                >
                  <Text style={{ color: tokens.foreground, fontSize: 13 }}>{t("Select all")}</Text>
                </Pressable>
                <Pressable onPress={() => setSelected(new Set())} hitSlop={8}>
                  <Text style={{ color: tokens.foreground, fontSize: 13 }}>{t("Deselect all")}</Text>
                </Pressable>
              </View>
            </View>

            <View
              style={{
                borderRadius: 12,
                borderWidth: 1,
                borderColor: tokens.border,
                overflow: "hidden",
                maxHeight: 320,
              }}
            >
              <ScrollView nestedScrollEnabled>
                {selectable.length === 0 ? (
                  <Text
                    style={{
                      padding: 16,
                      textAlign: "center",
                      color: tokens.mutedForeground,
                      fontSize: 14,
                    }}
                  >
                    {t("This conversation has no shareable messages yet.")}
                  </Text>
                ) : (
                  selectable.map((message) => {
                    const checked = selected.has(message.id);
                    return (
                      <Pressable
                        key={message.id}
                        onPress={() => toggle(message.id)}
                        style={{
                          flexDirection: "row",
                          gap: 12,
                          paddingHorizontal: 14,
                          paddingVertical: 10,
                          borderBottomWidth: 1,
                          borderBottomColor: tokens.border,
                          backgroundColor: checked ? tokens.accent : "transparent",
                        }}
                      >
                        <NativeSymbol
                          ios={checked ? "checkmark.circle.fill" : "circle"}
                          android={checked ? "checkbox" : "square-outline"}
                          size={22}
                          color={checked ? tokens.foreground : tokens.mutedForeground}
                        />
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={{ color: tokens.mutedForeground, fontSize: 12 }}>
                            {message.role === "user" ? t("You") : displayName}
                          </Text>
                          <Text
                            numberOfLines={2}
                            style={{ color: tokens.foreground, fontSize: 14 }}
                          >
                            {preview(message.blocks) || "—"}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })
                )}
              </ScrollView>
            </View>

            <View>
              <Text style={{ color: tokens.mutedForeground, fontSize: 13, marginBottom: 8 }}>
                {t("Title (optional)")}
              </Text>
              <TextInput
                value={title}
                onChangeText={setTitle}
                maxLength={200}
                placeholder={displayName}
                placeholderTextColor={tokens.mutedForeground}
                style={{
                  backgroundColor: native.fill,
                  borderRadius: 11,
                  padding: 14,
                  color: tokens.foreground,
                  fontSize: 16,
                }}
              />
            </View>

            <View>
              <Text style={{ color: tokens.mutedForeground, fontSize: 13, marginBottom: 8 }}>
                {t("Link expires")}
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {expiryOptions.map((option) => {
                  const active = expiryDays === option.value;
                  return (
                    <Pressable
                      key={String(option.value)}
                      onPress={() => setExpiryDays(option.value)}
                      style={{
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                        borderRadius: 10,
                        borderWidth: 1,
                        borderColor: active ? tokens.foreground : tokens.border,
                        backgroundColor: active ? tokens.accent : "transparent",
                      }}
                    >
                      <Text style={{ color: tokens.foreground, fontSize: 13 }}>{option.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {createdUrl ? (
              <Pressable
                onPress={() => void Clipboard.setStringAsync(createdUrl)}
                style={{
                  flexDirection: "row",
                  gap: 8,
                  alignItems: "center",
                  padding: 12,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: tokens.border,
                  backgroundColor: tokens.accent,
                }}
              >
                <NativeSymbol
                  ios="link"
                  android="link-outline"
                  size={18}
                  color={tokens.mutedForeground}
                />
                <Text
                  style={{ flex: 1, color: tokens.foreground, fontSize: 13 }}
                  numberOfLines={2}
                >
                  {createdUrl}
                </Text>
                <Text style={{ color: tokens.foreground, fontSize: 13 }}>{t("Copy")}</Text>
              </Pressable>
            ) : null}

            <Pressable
              accessibilityRole="button"
              disabled={creating || selectable.length === 0}
              onPress={() => void createLink()}
              style={{
                backgroundColor: tokens.primary,
                borderRadius: 12,
                paddingVertical: 14,
                alignItems: "center",
                opacity: creating || selectable.length === 0 ? 0.5 : 1,
              }}
            >
              {creating ? (
                <ActivityIndicator color={tokens.primaryForeground} />
              ) : (
                <Text style={{ color: tokens.primaryForeground, fontSize: 16, fontWeight: "600" }}>
                  {t("Create link")}
                </Text>
              )}
            </Pressable>
          </>
        )}

        <View style={{ gap: 8, marginTop: 8 }}>
          <Text style={{ color: tokens.mutedForeground, fontSize: 13, fontWeight: "600" }}>
            {t("Active shares")}
          </Text>
          {shares.length === 0 ? (
            <Text style={{ color: tokens.mutedForeground, fontSize: 13 }}>
              {t("No active shares.")}
            </Text>
          ) : (
            shares.map((share) => (
              <View
                key={share.id}
                style={{
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: tokens.border,
                  padding: 12,
                  gap: 8,
                }}
              >
                <Text style={{ color: tokens.foreground, fontSize: 14 }} numberOfLines={1}>
                  {share.title ?? t("Untitled share")}
                </Text>
                <Text style={{ color: tokens.mutedForeground, fontSize: 12 }}>
                  {t("{count} messages", { count: String(share.messageCount) })}
                  {share.expiresAt
                    ? ` · ${t("expires {date}", {
                        date: new Date(share.expiresAt).toLocaleDateString(),
                      })}`
                    : ""}
                </Text>
                <View style={{ flexDirection: "row", gap: 16 }}>
                  <Pressable
                    onPress={() => {
                      const url = shareUrl(share.token);
                      void Clipboard.setStringAsync(url);
                      void Share.share({ message: url }).catch(() => undefined);
                    }}
                    hitSlop={8}
                  >
                    <Text style={{ color: tokens.foreground, fontSize: 13 }}>{t("Copy link")}</Text>
                  </Pressable>
                  <Pressable onPress={() => void revoke(share.id)} hitSlop={8}>
                    <Text style={{ color: tokens.destructive, fontSize: 13 }}>{t("Revoke")}</Text>
                  </Pressable>
                </View>
              </View>
            ))
          )}
        </View>

        <Pressable onPress={() => router.back()} style={{ paddingVertical: 8 }}>
          <Text style={{ color: tokens.mutedForeground, fontSize: 15, textAlign: "center" }}>
            {t("Close")}
          </Text>
        </Pressable>
      </ScrollView>
    </>
  );
}
