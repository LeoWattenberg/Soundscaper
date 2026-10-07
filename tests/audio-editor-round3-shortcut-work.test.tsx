/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { installReactTestDom } from './helpers/react-test-dom.ts';
import { createShortcutDraftConflictIndex } from '../src/common/editor/ui/dialogs/shortcut-draft-conflict-index.ts';
import { useShortcutCommandGroups, useShortcutCommands } from '../src/common/editor/ui/dialogs/useShortcutPresentation.ts';
import { findAudioEditorShortcutConflicts } from '../src/common/editor/preferences.js';
import type { AudacityShortcutCommand } from '../src/common/editor/ui/dialogs/workspace-preferences-shortcut-commands.ts';

void test('shortcut draft conflicts preserve whole-map order and reserved keys without repeated map reads', () => {
	let reads = 0;
	const shortcuts = Object.fromEntries(Array.from({ length: 200 }, (_, index) => [`action${index}`, ['Ctrl+F'+String(index + 1)]]));
	Object.defineProperty(shortcuts, 'target', { enumerable: true, get() { reads++; return ['Alt+T']; } });
	const find = createShortcutDraftConflictIndex(shortcuts);
	const initial = reads;
	for (let index = 0; index < 100; index++) find('target', ['Ctrl+F50']);
	assert.equal(reads, initial);
	for (const bindings of [['Ctrl+F50'], ['Ctrl+K'], ['Meta+F50', 'Ctrl+F10'], ['Alt+T'], ['Shift+F1']]) {
		assert.deepEqual(find('target', bindings), findAudioEditorShortcutConflicts({ ...shortcuts, target: bindings }).find(entry => entry.actionIds.includes('target')) ?? null);
	}
	const early = { target: ['Alt+T'], other: ['Ctrl+A', 'Ctrl+B'] };
	assert.deepEqual(createShortcutDraftConflictIndex(early)('target', ['Meta+B', 'Ctrl+A']),
		findAudioEditorShortcutConflicts({ ...early, target: ['Meta+B', 'Ctrl+A'] }).find(entry => entry.actionIds.includes('target')) ?? null);
	const originalMaps: Readonly<Record<string, readonly string[]>>[] = [early, { other: ['Alt+T'] }, { 'application-search': ['Ctrl+K'], other: ['Ctrl+B'] }, { play: ['Space'], other: ['Alt+T'] }];
	for (const original of originalMaps) {
		for (const id of ['target', 'new-action', 'application-search', 'play']) for (const bindings of [['Meta+K'], ['Ctrl+B', 'Meta+K'], ['Alt+T'], ['Space']]) {
			assert.deepEqual(createShortcutDraftConflictIndex(original)(id, bindings), findAudioEditorShortcutConflicts({ ...original, [id]: bindings }).find(entry => entry.actionIds.includes(id)) ?? null);
		}
	}
});

void test('inactive shortcut page skips catalog work, and search reuses prepared command text', async () => {
	const dom = installReactTestDom(); const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
	let reads = 0; const menus = [{ get id() { reads++; return 'test'; }, label: 'Test' }];
	let enabled = false, query = '', searchReads = 0; let groups: ReturnType<typeof useShortcutCommandGroups> = [];
	const searchable: AudacityShortcutCommand[] = Array.from({ length: 500 }, (_, index) => ({ id: `action${index}`, preferenceId: `action${index}`,
		get label() { searchReads++; return `Play ${index}`; }, shortcut: '', parityStatus: null, disabled: false, disabledReason: null,
		categoryId: 'group', categoryLabel: 'Group', categoryOrder: 1, order: index }));
	const options = { locale: 'en' };
	function Harness() { const commands = useShortcutCommands(menus, options, enabled); groups = useShortcutCommandGroups(commands, query, 'categorized'); useShortcutCommandGroups(searchable, query, 'categorized'); return null; }
	const { createRoot } = await import('react-dom/client'); const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<Harness />)); assert.equal(reads, 0); assert.equal(groups.length, 0);
		enabled = true; await act(async () => root.render(<Harness />)); assert.ok(reads > 0); const work = reads;
		const preparedReads = searchReads;
		query = 'play'; await act(async () => root.render(<Harness />)); assert.equal(reads, work); assert.equal(searchReads, preparedReads);
		assert.ok(groups.flatMap(group => group.commands).every(command => `${command.label} ${command.id}`.toLowerCase().includes('play')));
	} finally { await act(async () => root.unmount()); globals.IS_REACT_ACT_ENVIRONMENT = previous; dom.restore(); }
});
