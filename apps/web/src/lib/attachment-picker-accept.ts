/**
 * RAKAZO: the fork accepts any file type (unknown formats are stored as
 * application/octet-stream), so the picker never filters files out. The API still
 * enforces the size limit. Upstream filtered by MIME type on desktop.
 */
export function attachmentPickerAccept(_userAgent: string): string {
  return "*/*";
}
