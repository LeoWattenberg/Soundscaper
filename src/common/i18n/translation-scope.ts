/* SPDX-License-Identifier: AGPL-3.0-only */

/** Executable examples are editable program input, rather than translated copy. */
export const TRANSLATION_EXCLUDED_KEYS = Object.freeze(['nyquistPromptDefault']);

export function isTranslatableMessageKey(key: string): boolean {
	return !TRANSLATION_EXCLUDED_KEYS.includes(key);
}
