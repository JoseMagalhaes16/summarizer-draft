import { ApiError } from '../api/client';
import { TRANSCRIPT_LIMIT_HELP } from './transcriptLimits';

export function isPayloadTooLarge(e: unknown): boolean {
  return e instanceof ApiError && (e.code === 'PAYLOAD_TOO_LARGE' || e.status === 413);
}

/** Message safe to show to a person: says what happened, and how to fix it where we know. */
export function errorMessage(e: unknown, fallback: string): string {
  if (isPayloadTooLarge(e)) return `This transcript is too large. ${TRANSCRIPT_LIMIT_HELP}`;
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}
