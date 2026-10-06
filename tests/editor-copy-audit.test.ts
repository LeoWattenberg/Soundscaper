/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { auditEditorCopySource, auditEditorCopyTree } from '../scripts/lib/editor-copy-audit.mjs';
import { EDITOR_COPY_AUDIT_INVENTORY } from '../scripts/lib/editor-copy-audit-inventory.mjs';

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

test('both editor products expose authored UI copy through eager or lazy owned inventories', async () => {
	assert.deepEqual(await auditEditorCopyTree('src/common/editor/ui', EDITOR_COPY_AUDIT_INVENTORY), []);
});

test('local dictionaries and conditional JSX prose cannot bypass source ownership', () => {
	const issues = auditEditorCopySource('Fixture.tsx', `
		const TEXT = Object.freeze({ save: 'Save this file' });
		const view = <button>{ready ? 'Start playback' : 'Stop playback'}</button>;
		const unit = <span>{enabled ? 'Hz' : 'kHz'}</span>;
	`, {});
	assert.deepEqual(issues.map(({ kind }) => kind), ['dictionary', 'text', 'text']);
});

test('tree audits derive owned keys once across nested sources without changing diagnostics', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-copy-audit-'));
	t.after(async () => { await rm(root, { recursive: true, force: true }); });
	const nested = join(root, 'nested');
	await mkdir(nested);
	const script = join(root, 'script.js'), view = join(nested, 'view.tsx');
	await Promise.all([
		writeFile(script, 'const ignored = copy.missingProperty;\nconst missing = copy["missingCanonical"];\n'),
		writeFile(view, [
			'const scoped = copy.scoped;',
			'const canonical = copy["canonical.other"];',
			'const alias = copy.deleteClip;',
			'const view = <button aria-label="Owned label">{ready ? "Start playback" : "Stop playback"}</button>;',
			'const missing = copy.missingScoped;',
		].join('\n')),
		writeFile(join(nested, 'ignored.txt'), '<span>Ignored prose</span>'),
	]);
	let inventoryReads = 0;
	const inventory = new Proxy({ 'ui.owner.scoped': 'Scoped', 'canonical.other': 'Other' }, {
		ownKeys(target) { inventoryReads += 1; return Reflect.ownKeys(target); },
	});
	const issues: { readonly path: string }[] = await auditEditorCopyTree(root, inventory);
	assert.deepEqual(issues.sort((left, right) => left.path.localeCompare(right.path)), [
		{ path: view, line: 4, kind: 'attribute', key: 'Owned label' },
		{ path: view, line: 4, kind: 'text', key: 'Start playback' },
		{ path: view, line: 4, kind: 'text', key: 'Stop playback' },
		{ path: view, line: 5, kind: 'key', key: 'missingScoped' },
		{ path: script, line: 2, kind: 'key', key: 'missingCanonical' },
	]);
	assert.equal(inventoryReads, 1);
});

test('tree and standalone source audits refresh ownership after the inventory changes', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-copy-audit-refresh-'));
	t.after(async () => { await rm(root, { recursive: true, force: true }); });
	const path = join(root, 'view.jsx');
	const content = 'const view = <span>{copy.mutable}</span>;';
	await writeFile(path, content);
	const inventory: Record<string, string> = {};
	const expected = [{ path, line: 1, kind: 'key', key: 'mutable' }];
	assert.deepEqual(await auditEditorCopyTree(root, inventory), expected);
	inventory['ui.owner.mutable'] = 'Mutable';
	assert.deepEqual(await auditEditorCopyTree(root, inventory), []);
	assert.deepEqual(auditEditorCopySource(path, content, inventory), []);
	delete inventory['ui.owner.mutable'];
	assert.deepEqual(await auditEditorCopyTree(root, inventory), expected);
	assert.deepEqual(auditEditorCopySource(path, content, inventory), expected);
});
