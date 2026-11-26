import type { Template } from '../../api/types';

export type NoteMode = 'ai' | 'manual';

const KEY = 'vetscribe.newNoteMode';

export function readStoredMode(): NoteMode | null {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === 'ai' || v === 'manual' ? v : null;
  } catch {
    return null;
  }
}

export function storeMode(mode: NoteMode): void {
  try {
    window.localStorage.setItem(KEY, mode);
  } catch {
    // Storage can be blocked; the choice then only lasts for this page.
  }
}

export function parseMode(v: string | null): NoteMode | null {
  return v === 'ai' || v === 'manual' ? v : null;
}

/** Does this template have any section that "Start with normal findings" would fill in? */
export function templateHasDefaults(t: Template | undefined): boolean {
  return !!t?.sections.some((s) => s.missing_behavior === 'use_normal_defaults' && s.format !== 'key_value' && s.normal_defaults.trim() !== '');
}
