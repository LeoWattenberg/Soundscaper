/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateAudacityActionEnablement } from '../src/common/editor/audacity-action-parity.js';
import { AUDIO_EDITOR_DEFAULT_SHORTCUTS } from '../src/common/editor/preferences.js';
import createApplicationMenus from '../src/common/editor/ui/application-menus.js';
import { WORKSPACE_PANEL_IDS } from '../src/common/editor/ui/workspace/workspace-panel-model.ts';
import { ENGLISH_COPY, GERMAN_COPY } from '../src/common/i18n/catalogs.js';

type MenuItem = Record<string, unknown> & { items?: MenuItem[] };

const LABELED_ACTION_IDS = [
	'cut-labels', 'delete-labels', 'split-cut-labels', 'split-delete-labels',
	'silence-labels', 'copy-labels', 'split-labels', 'join-labels', 'disjoin-labels',
];

function project(selection: Record<string, unknown>, labels: readonly Record<string, unknown>[]) {
	return {
		id: 'project', sampleRate: 48_000, sources: [], clips: [{ id: 'clip', kind: 'audio' }],
		tracks: [
			{ id: 'track-a', type: 'audio', clipIds: ['clip'], effects: [] },
			{ id: 'labels', type: 'label', labels },
		],
		selection: { trackIds: [], clipIds: [], ...selection },
		loop: { enabled: false }, snap: { enabled: false, division: 'samples' },
	};
}

function menus(document: ReturnType<typeof project>, calls: string[], productId = 'soundscaper') {
	return createApplicationMenus({
		productId, aboutLabel: 'About', capabilities: { audioGenerators: true }, locale: 'en',
		copy: ENGLISH_COPY, project: document,
		snapshot: {
			project: document, selectedTrackId: 'track-a',
			preferences: { workspace: {
				activeId: 'editing', custom: [],
				panels: Object.fromEntries(WORKSPACE_PANEL_IDS.map((id) => [id, { visible: false }])),
			}, view: {}, shortcuts: AUDIO_EDITOR_DEFAULT_SHORTCUTS },
			history: { canUndo: false, canRedo: false, hasClipboard: false },
			effects: { selectionTypes: [], canRepeatLast: false },
		},
		blocked: false, editBlocked: false, handoffBlocked: false, showArmControls: false,
		selectionActive: true, selectedClip: null, durationFrames: 10_000,
		effectsPanelOpen: false, projectBinEffectivelyOpen: false, uiFlags: {},
		actionRuntime: null,
		actions: new Proxy({
			executeEdit: (action: string) => { calls.push(action); },
		} as Record<string, unknown>, {
			get: (target, property, receiver) => (Reflect.has(target, property)
				? Reflect.get(target, property, receiver)
				: () => undefined),
		}),
	}) as MenuItem[];
}

function labeledSubmenu(document: ReturnType<typeof project>, calls: string[] = []): MenuItem {
	const edit = menus(document, calls).find((menu) => menu.id === 'edit');
	assert.ok(edit, 'the Edit menu exists');
	const submenu = edit.items?.find((item) => item.id === 'labeled-audio');
	assert.ok(submenu, 'Edit holds the Labeled audio submenu');
	return submenu;
}

const labelled = (selection: Record<string, unknown>) => project(selection, [
	{ id: 'label', anchor: 'sample', startFrame: 1_000, endFrame: 2_000 },
]);

test('both locales label the submenu and all nine of its rows', () => {
	for (const copy of [ENGLISH_COPY, GERMAN_COPY]) {
		for (const key of [
			'labeledAudio', 'labeledCut', 'labeledDelete', 'labeledCutLeaveGap', 'labeledDeleteLeaveGap',
			'labeledSilence', 'labeledCopy', 'labeledSplit', 'labeledJoin', 'labeledDisjoin',
			'labeledAudioRequired', 'noSilencesInLabels',
		]) {
			assert.equal(typeof copy[key], 'string', `${key} is missing`);
			assert.ok((copy[key] as string).length > 0, `${key} is empty`);
		}
	}
});

test('the Edit menu carries Audacity\'s Labeled audio submenu in its own order', () => {
	const submenu = labeledSubmenu(labelled({ startFrame: 0, endFrame: 10_000 }));
	assert.equal(submenu.label, ENGLISH_COPY.labeledAudio);
	assert.deepEqual(submenu.items?.map((item) => item.id), LABELED_ACTION_IDS);
	assert.deepEqual(
		submenu.items?.map((item) => item.label),
		['Cut', 'Delete', 'Cut and leave gap', 'Delete and leave gap', 'Silence audio',
			'Copy', 'Split', 'Join', 'Detach at silences'],
	);
});

test('the rows carry the Audacity 3 shortcuts the profile does not import', () => {
	const submenu = labeledSubmenu(labelled({ startFrame: 0, endFrame: 10_000 }));
	assert.deepEqual(submenu.items?.map((item) => item.shortcut), [
		'Alt+X', 'Alt+K', 'Alt+Shift+X', 'Alt+Shift+K', 'Alt+L', 'Alt+Shift+C', 'Alt+I', 'Alt+J', 'Alt+Shift+J',
	]);
});

test('the rows run their labelled edits and are inert without a whole label selected', () => {
	const calls: string[] = [];
	const enabled = labeledSubmenu(labelled({ startFrame: 0, endFrame: 10_000 }), calls);
	for (const item of enabled.items!) {
		assert.equal(item.disabled, false, String(item.id));
		(item.onClick as () => void)();
	}
	assert.deepEqual(calls, [
		'labeledCut', 'labeledDelete', 'labeledCutLeaveGap', 'labeledDeleteLeaveGap', 'labeledSilence',
		'labeledCopy', 'labeledSplit', 'labeledJoin', 'labeledDisjoin',
	]);

	const narrow = labeledSubmenu(labelled({ startFrame: 1_500, endFrame: 3_000 }));
	for (const item of narrow.items!) assert.equal(item.disabled, true, String(item.id));
});

test('the parity predicate follows the labels the selection encloses', () => {
	const context = (document: ReturnType<typeof project>) => ({
		snapshot: { project: document, selectedTrackId: 'track-a' },
	});
	for (const id of LABELED_ACTION_IDS) {
		assert.equal(
			evaluateAudacityActionEnablement(id, context(labelled({ startFrame: 0, endFrame: 10_000 }))),
			true,
			id,
		);
		assert.equal(
			evaluateAudacityActionEnablement(id, context(labelled({ startFrame: 1_500, endFrame: 3_000 }))),
			false,
			id,
		);
		assert.equal(
			evaluateAudacityActionEnablement(id, context(project({ startFrame: 0, endFrame: 10_000 }, []))),
			false,
			id,
		);
	}
});

test('Framescaper is left to name a video equivalent instead of inheriting this one', () => {
	const edit = menus(labelled({ startFrame: 0, endFrame: 10_000 }), [], 'framescaper')
		.find((menu) => menu.id === 'edit');
	assert.ok(edit, 'the Edit menu exists');
	assert.equal(edit.items?.find((item) => item.id === 'labeled-audio'), undefined);
});
