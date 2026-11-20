import { MAX_TRANSCRIPT_BYTES, MAX_TRANSCRIPT_CHARS } from '../api/types';
import { transcriptUsage } from './transcriptLimits';

describe('transcriptUsage', () => {
  it('is quiet for short text', () => {
    expect(transcriptUsage('hello')).toMatchObject({ chars: 5, bytes: 5, over: false, near: false });
  });
  it('counts UTF-8 bytes, not characters', () => {
    expect(transcriptUsage('é').bytes).toBe(2);
    expect(transcriptUsage('😀').bytes).toBe(4);
  });
  it('flags the byte limit even when characters are fine', () => {
    const u = transcriptUsage('é'.repeat(MAX_TRANSCRIPT_BYTES / 2 + 1));
    expect(u.over).toBe(true);
    expect(u.label).toMatch(/bytes$/);
  });
  it('flags the character limit', () => {
    const u = transcriptUsage('x'.repeat(MAX_TRANSCRIPT_CHARS + 1));
    expect(u.over).toBe(true);
    expect(u.label).toMatch(/characters$/);
  });
});
