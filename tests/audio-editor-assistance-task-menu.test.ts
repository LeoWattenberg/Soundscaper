/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	ASSISTANCE_TASKS, assistanceDialogRequest, assistanceDialogSurface,
	mergeAssistanceTaskMenus,
} from '../src/common/editor/ui/assistance-task-catalog.ts';
import { filterProductMenus } from '../src/common/editor/ui/application-menu-product-filter.js';

test('every guided task has one destination and opens its own workflow', () => {
	const requests: unknown[] = [];
	const menus = mergeAssistanceTaskMenus(['edit', 'generate', 'effect', 'analyze', 'tools'].map(
		(id) => ({ id, items: [] }),
	), { productId: 'framescaper', available: true, copy: {}, open: (request) => requests.push(request) });
	const visit = (items: Readonly<typeof menus>): void => {
		for (const item of items) {
			item.onClick?.();
			if (item.items) visit(item.items);
		}
	};
	visit(menus);
	assert.equal(ASSISTANCE_TASKS.length, 14);
	assert.equal(requests.length, 14);
	for (const task of ASSISTANCE_TASKS) {
		const request = { mode: 'task' as const, workflowId: task.workflowId };
		assert.deepEqual(assistanceDialogRequest(assistanceDialogSurface(request)), request);
		assert.ok(requests.some((value) => JSON.stringify(value) === JSON.stringify(request)));
	}
	assert.equal(assistanceDialogRequest('local-assistance:unknown'), null);
	assert.deepEqual(assistanceDialogRequest('local-assistance'), { mode: 'advanced' });
});

test('video tasks are product scoped and browser menus contain no local processing commands', () => {
	const input = [{ id: 'analyze', items: [] }, { id: 'effect', items: [] }];
	assert.deepEqual(mergeAssistanceTaskMenus(input, {
		productId: 'soundscaper', available: false, copy: {}, open: () => undefined,
	}), input);
	const menus = mergeAssistanceTaskMenus(input, {
		productId: 'soundscaper', available: true, copy: {}, open: () => undefined,
	});
	assert.doesNotMatch(JSON.stringify(menus), /mark-cuts|reframe/);
});

test('Framescaper retains assistance independently of built-in audio capabilities', () => {
	const menus = mergeAssistanceTaskMenus(['generate', 'effect', 'analyze'].map((id) => ({ id, items: [] })), {
		productId: 'framescaper', available: true, copy: {}, open: () => undefined,
	});
	const filtered = filterProductMenus(menus, { assistanceAssets: true }, 'framescaper');
	assert.deepEqual(filtered.map((menu: { id: string }) => menu.id), ['generate', 'effect', 'analyze']);
	assert.match(JSON.stringify(filtered), /enhance-dialogue/);
});

test('effects join existing categories and honor alphabetical organization', () => {
	const base = [{ id: 'effect', items: [{ id: 'noiseRepair', label: 'Repair', disabled: true, items: [
		{ id: 'existing', label: 'Existing effect' },
	] }] }];
	const options = { productId: 'soundscaper', available: true, copy: {}, open: () => undefined };
	const grouped = mergeAssistanceTaskMenus(base, options);
	assert.equal(grouped[0].items?.filter((item) => item.id === 'noiseRepair').length, 1);
	assert.equal(grouped[0].items?.find((item) => item.id === 'noiseRepair')?.items?.length, 4);
	assert.equal(grouped[0].items?.find((item) => item.id === 'noiseRepair')?.disabled, false);
	const sorted = mergeAssistanceTaskMenus([{ id: 'effect', items: [] }], {
		...options, organization: 'sortby:name',
	});
	const labels = sorted[0].items?.map((item) => item.label) ?? [];
	assert.deepEqual(labels, [...labels].sort((a, b) => (a ?? '').localeCompare(b ?? '', 'en')));
});

test('native configuration moves to preferences while effect use and management stay in Effect', async () => {
	const { organizeNativePreferences } = await import('../src/common/editor/ui/local-processing-menus.ts');
	const result = organizeNativePreferences([
		{ id: 'effect', items: [{ id: 'native-effect-manage' }, { id: 'native-effect-use' }] },
		{ id: 'tools', items: [{ id: 'native-audio', items: [{ id: 'native-audio-device' }] },
			{ id: 'desktop-services', items: [{ id: 'desktop-use-native-audio-helper' },
				{ id: 'desktop-use-native-probe-helper' }, { id: 'desktop-discover-native-effects' }] },
			{ id: 'framescaper-native-media-preferences' }, { id: 'manage-local-models' }] },
	]);
	assert.deepEqual(result[1].items?.map((entry) => entry.id), ['manage-local-models']);
	assert.deepEqual(result[0].items?.map((entry) => entry.id), ['native-effect-manage', 'native-effect-use']);
	assert.deepEqual((result[1].nativePreferences as { section: string }[]).map((entry) => entry.section),
		['audio', 'audio', 'media', 'effects', 'media']);
});

test('task destinations match the editing task, with no generic assistance submenu', () => {
	const expected: Readonly<Record<string, string>> = {
		'enhance-dialogue': 'effect/noiseRepair', 'reduce-reverb': 'effect/noiseRepair',
		'clean-filler-silence': 'effect/noiseRepair',
		'separate-dialogue-music-effects': 'effect/assistance-source-separation',
		'transcribe-captions': 'analyze/assistance-speech', 'identify-speakers': 'analyze/assistance-speech',
		'mark-reactions': 'analyze/assistance-speech', 'detect-beats-tempo': 'analyze/assistance-music',
		'mark-cuts': 'analyze/assistance-video', 'reframe': 'effect/framescaper-video-effects',
		'make-highlights': 'edit', 'generate-editorial-text': 'generate',
		'index-transcript': 'tools/assistance-search', 'index-video': 'tools/assistance-search',
	};
	assert.deepEqual(Object.fromEntries(ASSISTANCE_TASKS.map((task) => [
		task.workflowId, [task.menu, task.group].filter(Boolean).join('/'),
	])), expected);
});

test('moving native configuration into Preferences preserves its assignable command identity', async () => {
	const { organizeNativePreferences } = await import('../src/common/editor/ui/local-processing-menus.ts');
	const { collectAudacityShortcutCommands } = await import('../src/common/editor/ui/dialogs/workspace-preferences-shortcut-commands.ts');
	const { findShortcutMenuHandler } = await import('../src/common/editor/ui/workspace-shortcuts.ts');
	let opened = false;
	const menus = organizeNativePreferences([{ id: 'tools', items: [{ id: 'native-audio', items: [
		{ id: 'native-audio-preferences', label: 'Native audio and latency…', onClick: () => { opened = true; } },
	] }] }]);
	assert.equal(collectAudacityShortcutCommands(menus).find((command) => command.id === 'native-audio-preferences')?.label,
		'Native audio and latency…');
	findShortcutMenuHandler(menus, 'native-audio-preferences').handler?.();
	assert.equal(opened, true);
});
