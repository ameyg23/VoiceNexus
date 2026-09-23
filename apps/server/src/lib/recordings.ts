// Call recordings on local disk (ARCHITECTURE.md §13). Demo calls upload browser MediaRecorder audio
// (.webm); phone calls download Twilio's recording (.mp3). Either way the file lands in
// storage/recordings/{conversationId}.{ext} and conversations.audio_path points at it.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "@voice-nexus/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const RECORDINGS_DIR = path.join(REPO_ROOT, "storage", "recordings");

export function saveRecording(conversationId: string, data: Buffer, ext: "webm" | "mp3"): string {
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
  const fileName = `${conversationId}.${ext}`;
  fs.writeFileSync(path.join(RECORDINGS_DIR, fileName), data);

  const audioPath = `storage/recordings/${fileName}`;
  db.prepare(`UPDATE conversations SET audio_path = @audioPath WHERE id = @id`).run({ "@audioPath": audioPath, "@id": conversationId });
  return audioPath;
}

// Resolves a stored audio_path to an absolute file, refusing anything outside the recordings dir.
export function resolveRecording(audioPath: string): string | null {
  const absolute = path.resolve(REPO_ROOT, audioPath);
  if (!absolute.startsWith(RECORDINGS_DIR + path.sep) || !fs.existsSync(absolute)) return null;
  return absolute;
}
