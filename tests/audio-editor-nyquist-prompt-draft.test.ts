/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { loadNyquistPromptDraft, storeNyquistPromptDraft } from '../src/common/editor/ui/dialogs/nyquist-prompt-draft.ts';

test('saved SAL source retains the language required to run it after reopening', () => {
	const values = new Map<string, string>();
	const storage = {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => { values.set(key, value); },
	};
	storeNyquistPromptDraft({ source: 'return 42', language: 'sal' }, storage);
	assert.deepEqual(loadNyquistPromptDraft('42', storage), { source: 'return 42', language: 'sal' });
	storeNyquistPromptDraft({ source: '42', language: 'lisp' }, storage);
	assert.deepEqual(loadNyquistPromptDraft('default', storage), { source: '42', language: 'lisp' });
});

test('existing saved Lisp prompts retain their source without a stored language', () => {
	const storage = { getItem: (key: string) => key === 'soundscaper-nyquist-prompt-v1' ? '(+ 20 22)' : null };
	assert.deepEqual(loadNyquistPromptDraft('42', storage), { source: '(+ 20 22)', language: 'lisp' });
});

test('the prompt remains usable when browser storage is unavailable', () => {
	const storage = {
		getItem: () => { throw new Error('Storage unavailable'); },
		setItem: () => { throw new Error('Storage unavailable'); },
	};
	assert.deepEqual(loadNyquistPromptDraft('42', storage), { source: '42', language: 'lisp' });
	assert.doesNotThrow(() => storeNyquistPromptDraft({ source: 'return 42', language: 'sal' }, storage));
});
