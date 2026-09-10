// Adapted from PI-Desktop clipboard-history.ts, LGPL-3.0; see third_party/pi-desktop/NOTICE.md.
import { createHash } from "node:crypto";

export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_TEXT_BYTES = 100 * 1024;
export const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
const MAX_ENTRIES = 500, MAX_BYTES = 256 * 1024 * 1024;
const sizeOf = (entry) => entry.type === "text" ? Buffer.byteLength(entry.text) : entry.data.byteLength;

export class ClipboardHistory {
  constructor({ now = Date.now } = {}) { this.now = now; this.entries = []; this.totalBytes = 0; }
  record(capture) {
    const content = capture.type === "text" ? capture.text : capture.data;
    const signature = createHash("sha256").update(capture.type).update(capture.format ?? "").update(content).digest("hex");
    const repeated = signature === this.lastSignature; this.lastSignature = signature;
    const capturedAt = new Date(this.now()).toISOString();
    if (repeated && this.lastRecordedSignature === signature && this.entries[0]) {
      this.entries[0] = { ...this.entries[0], capturedAt }; return;
    }
    this.lastRecordedSignature = null;
    const size = sizeOf(capture), max = capture.type === "text" ? MAX_TEXT_BYTES : MAX_IMAGE_BYTES;
    if (!size || size > max) return;
    const entry = { ...capture, capturedAt, signature };
    if (capture.type === "image") entry.data = Buffer.from(capture.data);
    this.entries.unshift(entry); this.totalBytes += size; this.lastRecordedSignature = signature;
    this.prune();
  }
  prune() {
    const cutoff = this.now() - RETENTION_MS;
    this.entries = this.entries.filter((entry) => {
      if (Date.parse(entry.capturedAt) >= cutoff) return true;
      this.totalBytes -= sizeOf(entry); return false;
    });
    while (this.entries.length > MAX_ENTRIES || this.totalBytes > MAX_BYTES) this.totalBytes -= sizeOf(this.entries.pop());
    if (this.entries[0]?.signature !== this.lastRecordedSignature) this.lastRecordedSignature = null;
  }
  snapshot() {
    this.prune();
    return this.entries.map(({ signature, ...entry }) => entry);
  }
}
