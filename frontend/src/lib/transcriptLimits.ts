import { MAX_TRANSCRIPT_BYTES, MAX_TRANSCRIPT_CHARS } from '../api/types';

/** Show the running count once either limit is this close. */
const NEAR = 0.85;
const encoder = new TextEncoder();
const n = (v: number) => v.toLocaleString('en-US');

export interface TranscriptUsage {
  chars: number;
  bytes: number;
  over: boolean;
  near: boolean;
  /** e.g. "170,000 of 200,000 characters", using whichever limit is closer. */
  label: string;
}

export function transcriptUsage(text: string): TranscriptUsage {
  const chars = text.length;
  const bytes = encoder.encode(text).length;
  const charRatio = chars / MAX_TRANSCRIPT_CHARS;
  const byteRatio = bytes / MAX_TRANSCRIPT_BYTES;
  const over = chars > MAX_TRANSCRIPT_CHARS || bytes > MAX_TRANSCRIPT_BYTES;
  const label = byteRatio > charRatio ? `${n(bytes)} of ${n(MAX_TRANSCRIPT_BYTES)} bytes` : `${n(chars)} of ${n(MAX_TRANSCRIPT_CHARS)} characters`;
  return { chars, bytes, over, near: Math.max(charRatio, byteRatio) >= NEAR, label };
}

/** What the limit is and how to fix it; shared by the form and the 413 response. */
export const TRANSCRIPT_LIMIT_HELP = `The limit is ${n(MAX_TRANSCRIPT_CHARS)} characters (${n(MAX_TRANSCRIPT_BYTES)} bytes). Shorten the transcript and try again.`;
