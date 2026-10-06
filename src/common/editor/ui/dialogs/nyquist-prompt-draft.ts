/* SPDX-License-Identifier: AGPL-3.0-only */

export interface NyquistPromptDraft {
	readonly source: string;
	readonly language: 'lisp' | 'sal';
}

const SOURCE_KEY = 'soundscaper-nyquist-prompt-v1';
const LANGUAGE_KEY = 'soundscaper-nyquist-prompt-language-v1';

export function loadNyquistPromptDraft(
	fallback: string, storage?: Pick<Storage, 'getItem'>,
): NyquistPromptDraft {
	try {
		const available = storage ?? globalThis.localStorage;
		return {
			source: available?.getItem(SOURCE_KEY) || fallback,
			language: available?.getItem(LANGUAGE_KEY) === 'sal' ? 'sal' : 'lisp',
		};
	} catch {
		return { source: fallback, language: 'lisp' };
	}
}

export function storeNyquistPromptDraft(
	draft: NyquistPromptDraft, storage?: Pick<Storage, 'setItem'>,
): void {
	try {
		const available = storage ?? globalThis.localStorage;
		available?.setItem(SOURCE_KEY, draft.source);
		available?.setItem(LANGUAGE_KEY, draft.language);
	} catch {
		// Local persistence can be unavailable in privacy modes.
	}
}
