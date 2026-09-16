/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { auditEditorCopySource, auditEditorCopyTree } from '../scripts/lib/editor-copy-audit.mjs';
import { EDITOR_ENGLISH_COPY } from '../src/common/i18n/editor-copy-inventory.ts';

test('editor copy audit detects unregistered fallbacks, reads and accessible prose', () => {
	const issues = auditEditorCopySource('Fixture.tsx', `
		const a = text(copy, 'missing', 'Owned default');
		const b = copy.missingLabel;
		const view = <button aria-label="Owned accessible name">Owned text</button>;
	`, { label: 'Label' });
	assert.deepEqual(issues.map(({ kind }) => kind), ['fallback', 'key', 'attribute', 'text']);
	assert.deepEqual(auditEditorCopySource('Fixture.tsx', `
		const view = <button aria-label={copy.label}>{copy.label}</button>;
		const scoped = copy['ui.owner.scoped'];
		const unit = <span>dB</span>;
	`, { label: 'Label', 'ui.owner.scoped': 'Scoped' }), []);
});

test('both editor products expose authored UI copy through the source inventory', async () => {
	assert.deepEqual(await auditEditorCopyTree('src/common/editor/ui', EDITOR_ENGLISH_COPY), []);
});

test('local dictionaries and conditional JSX prose cannot bypass source ownership', () => {
	const issues = auditEditorCopySource('Fixture.tsx', `
		const TEXT = Object.freeze({ save: 'Save this file' });
		const view = <button>{ready ? 'Start playback' : 'Stop playback'}</button>;
		const unit = <span>{enabled ? 'Hz' : 'kHz'}</span>;
	`, {});
	assert.deepEqual(issues.map(({ kind }) => kind), ['dictionary', 'text', 'text']);
});
