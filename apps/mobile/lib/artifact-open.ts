import { Directory, File, Paths } from "expo-file-system";
import { getContentUriAsync } from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { Image, Platform } from "react-native";
import type { ApiRequestContext } from "./api";
import { captureApiRequestContext, currentApiBase, rpc, selectedSpaceId } from "./api";
import { artifactCacheSession } from "./artifact-cache-session";
import { artifactCacheFileName, artifactShareFileName } from "./artifact-file";
import { t } from "./i18n";
import type { ImageSize } from "./inline-image";
import { createKeyedPromiseCache } from "./inline-image";
import { currentSessionGeneration, loadSessionToken } from "./session";

export type MobileArtifactTarget = { botId: string } | { groupId: string };

/**
 * An artifact travels as base64 inside the RPC body: up to the attachment limit (10 MiB) plus
 * a third of encoding overhead. The default RPC timeout is sized for small JSON replies and
 * gives up on a multi-megabyte photo over a relayed cellular link, so downloads get a budget
 * of their own.
 */
export const ARTIFACT_DOWNLOAD_TIMEOUT_MS = 120_000;

/** Writes an artifact's bytes to its cache file; no network call. */
export function writeArtifactCacheFile(
  artifactId: string,
  mimeType: string,
  contentBase64: string,
): File {
  const file = new File(Paths.cache, artifactCacheFileName(artifactId, mimeType));
  file.create({ overwrite: true });
  file.write(contentBase64, { encoding: "base64" });
  return file;
}

type ArtifactScope = {
  context: ApiRequestContext;
  generation: number;
  selectionId: string | null;
  namespace: string;
  userId: string;
};
let identity: { key: string; scope: Promise<ArtifactScope> } | undefined;

function assertCurrent(scope: ArtifactScope): void {
  if (
    scope.generation !== currentSessionGeneration() ||
    scope.context.apiBase !== currentApiBase() ||
    scope.selectionId !== selectedSpaceId()
  ) {
    throw new Error("Artifact session changed");
  }
}

function artifactScope(): Promise<ArtifactScope> {
  const generation = currentSessionGeneration();
  const apiBase = currentApiBase();
  const selectionId = selectedSpaceId();
  const key = JSON.stringify([apiBase, generation, selectionId]);
  if (identity?.key === key) return identity.scope;
  imageArtifactUris.clear();
  imageArtifactSizes.clear();
  imageArtifactRequests.clear();
  const scope = (async () => {
    const context = await captureApiRequestContext();
    const token = await loadSessionToken();
    if (
      apiBase !== context.apiBase ||
      generation !== currentSessionGeneration() ||
      selectionId !== selectedSpaceId()
    )
      throw new Error("Artifact session changed");
    const me = await rpc("me", {}, { requestContext: context });
    if (generation !== currentSessionGeneration()) throw new Error("Artifact session changed");
    if (!me.userId) throw new Error("Missing artifact owner");
    const result = {
      context,
      generation,
      selectionId,
      userId: me.userId,
      namespace: await artifactCacheSession(token),
    };
    assertCurrent(result);
    return result;
  })();
  const entry = { key, scope };
  identity = entry;
  void scope.catch(() => {
    if (identity === entry) identity = undefined;
  });
  return scope;
}

function requestKey(target: MobileArtifactTarget, artifactId: string, mimeType: string): string {
  return JSON.stringify([
    "botId" in target ? "bot" : "group",
    "botId" in target ? target.botId : target.groupId,
    artifactId,
    mimeType,
  ]);
}

async function cacheMobileArtifact(
  target: MobileArtifactTarget,
  artifactId: string,
  mimeType: string,
  cachedScope?: ArtifactScope,
): Promise<File> {
  const scope = cachedScope ?? (await artifactScope());
  assertCurrent(scope);
  const key = requestKey(target, artifactId, mimeType);
  const root = new Directory(
    Paths.cache,
    "artifact-previews",
    scope.namespace,
    `endpoint-${encodeURIComponent(scope.context.apiBase)}`,
    `user-${encodeURIComponent(scope.userId)}`,
    `target-${encodeURIComponent("botId" in target ? `bot:${target.botId}` : `group:${target.groupId}`)}`,
    `artifact-${encodeURIComponent(artifactId)}`,
    `mime-${encodeURIComponent(mimeType)}`,
  );
  if (!root.exists) root.create({ intermediates: true });
  const file = new File(root, artifactCacheFileName(artifactId, mimeType));
  const metadata = new File(root, `${file.name}.json`);
  // Legacy unscoped files and incomplete writes are never authorized cache entries.
  if (file.exists && metadata.exists) {
    try {
      if (JSON.parse(metadata.textSync()).key === key) return file;
    } catch {
      // A corrupt sidecar is a cache miss.
    }
  }
  const artifact = await rpc(
    "artifacts/get",
    { ...target, artifactId },
    { timeoutMs: ARTIFACT_DOWNLOAD_TIMEOUT_MS, requestContext: scope.context },
  );
  assertCurrent(scope);
  // Invalidate first so an interrupted overwrite cannot leave valid metadata for wrong bytes.
  if (metadata.exists) metadata.delete();
  file.create({ overwrite: true });
  file.write(artifact.contentBase64, { encoding: "base64" });
  metadata.create({ overwrite: true });
  metadata.write(JSON.stringify({ key }));
  return file;
}

/** Local playback URI using the same authenticated, session-scoped artifact cache. */
export async function audioArtifactUri(
  target: MobileArtifactTarget,
  artifactId: string,
  mimeType: string,
): Promise<string> {
  return (await cacheMobileArtifact(target, artifactId, mimeType)).uri;
}

export async function readMobileArtifactText(
  target: MobileArtifactTarget,
  artifactId: string,
  mimeType: string,
): Promise<string> {
  const file = await cacheMobileArtifact(target, artifactId, mimeType);
  return file.text();
}


/** FLAG_GRANT_READ_URI_PERMISSION: lets the viewer app read our FileProvider content:// URI. */
const FLAG_GRANT_READ_URI_PERMISSION = 1;

export const APK_MIME_TYPE = "application/vnd.android.package-archive";

/**
 * The type the viewer intent carries. Attachments often arrive as a generic
 * `application/octet-stream`; an `.apk` must still go out as a package archive, or the
 * system package installer is offered for a wildcard type and then refuses the file without a word.
 */
export function intentMimeType(mimeType: string, fileName = ""): string {
  const normalized = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (fileName.toLowerCase().endsWith(".apk")) return APK_MIME_TYPE;
  if (!normalized || normalized === "application/octet-stream") return "*/*";
  return normalized;
}

/**
 * ACTION_VIEW resolves only when the viewer returns (startActivityForResult), so do not wait for
 * it: a launch failure (no app for this type) rejects right away, anything slower means the viewer
 * is open. Returns false only when no viewer could be started.
 */
async function launchAndroidViewer(file: File, mimeType: string): Promise<boolean> {
  let IntentLauncher: typeof import("expo-intent-launcher");
  let contentUri: string;
  try {
    IntentLauncher = await import("expo-intent-launcher");
    contentUri = await getContentUriAsync(file.uri);
  } catch {
    return false;
  }
  const launch = IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
    data: contentUri,
    // Installing an .apk also needs REQUEST_INSTALL_PACKAGES in the manifest (app.json); with it
    // Android asks once to allow installs from this app, without it the installer quits silently.
    type: intentMimeType(mimeType, file.name),
    flags: FLAG_GRANT_READ_URI_PERMISSION,
  }).then(
    () => true,
    () => false,
  );
  const started = new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 1200));
  return Promise.race([launch, started]);
}

/**
 * Tap on an attachment. Android: open the file in a viewer app (ACTION_VIEW on a FileProvider
 * content:// URI); falls back to the share sheet only when no app can view it. iOS keeps the
 * system share sheet (which also offers Quick Look / "Open in").
 */
export async function openMobileArtifact(
  target: MobileArtifactTarget,
  artifactId: string,
  name: string,
  mimeType: string,
): Promise<void> {
  const file = await cacheMobileArtifact(target, artifactId, mimeType);
  if (
    Platform.OS === "android" &&
    (await launchAndroidViewer(namedCopy(file, mimeType, name), mimeType))
  )
    return;
  await shareNamedFile(file, mimeType, name);
}

/** Explicit "Share" action: always the system share sheet. */
export async function shareMobileArtifact(
  target: MobileArtifactTarget,
  artifactId: string,
  name: string,
  mimeType: string,
): Promise<void> {
  const file = await cacheMobileArtifact(target, artifactId, mimeType);
  await shareNamedFile(file, mimeType, name);
}

const imageArtifactUris = createKeyedPromiseCache<string>(async (key) => {
  const request = imageArtifactRequests.get(key);
  if (!request) throw new Error("unknown image artifact");
  const file = await cacheMobileArtifact(
    request.target,
    request.artifactId,
    request.mimeType,
    request.scope,
  );
  return file.uri;
});
const imageArtifactRequests = new Map<
  string,
  { target: MobileArtifactTarget; artifactId: string; mimeType: string; scope: ArtifactScope }
>();

/**
 * Local file URI of an image artifact, downloaded through the authenticated RPC and cached on
 * disk. Concurrent callers (every bubble showing the same image) share one download.
 */
export async function imageArtifactUri(
  target: MobileArtifactTarget,
  artifactId: string,
  mimeType: string,
): Promise<string> {
  const scope = await artifactScope();
  assertCurrent(scope);
  const key = JSON.stringify([
    scope.context.apiBase,
    scope.userId,
    scope.namespace,
    scope.generation,
    requestKey(target, artifactId, mimeType),
  ]);
  imageArtifactRequests.set(key, { target, artifactId, mimeType, scope });
  const entry = imageArtifactUris.get(key);
  const uri = await entry;
  assertCurrent(scope);
  if (new File(uri).exists) return uri;
  imageArtifactUris.forget(key, entry);
  const refreshed = await imageArtifactUris.get(key);
  assertCurrent(scope);
  return refreshed;
}

// Natural dimensions share the URI cache's session lifetime; fitted sizes stay per layout.
const imageArtifactSizes = createKeyedPromiseCache<ImageSize>(
  (uri) =>
    new Promise((resolve, reject) => {
      Image.getSize(uri, (width, height) => resolve({ width, height }), reject);
    }),
);

export async function imageArtifactPreview(
  target: MobileArtifactTarget,
  artifactId: string,
  mimeType: string,
): Promise<{ uri: string; size: ImageSize }> {
  const scope = await artifactScope();
  const uri = await imageArtifactUri(target, artifactId, mimeType);
  assertCurrent(scope);
  const size = await imageArtifactSizes.get(uri);
  assertCurrent(scope);
  return { uri, size };
}

/** Share a file already on disk (for example an image the viewer is showing) without downloading it again. */
export async function shareLocalFile(uri: string, mimeType: string, name: string): Promise<void> {
  await shareNamedFile(new File(uri), mimeType, name);
}

function namedCopy(source: File, mimeType: string, name: string): File {
  const root = new Directory(Paths.cache, "artifact-shares");
  if (!root.exists) root.create();
  const dir = new Directory(root, source.name || "attachment");
  if (!dir.exists) dir.create();
  const shared = new File(dir, artifactShareFileName(name, mimeType));
  source.copySync(shared, { overwrite: true });
  return shared;
}

async function shareNamedFile(source: File, mimeType: string, name: string): Promise<void> {
  const shared = namedCopy(source, mimeType, name);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(shared.uri, { mimeType });
    return;
  }
  throw new Error(t("Saved {name} locally", { name }));
}
