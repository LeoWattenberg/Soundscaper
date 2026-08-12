/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import createApplicationMenus from '../src/common/editor/ui/application-menus.js';
import { createClipSelectionNavigationMenuModel } from '../src/common/editor/ui/clip-selection-navigation-menu-model.ts';
import { createWorkspaceApplicationMenus } from '../src/common/editor/ui/workspace/workspace-application-menu-runtime.js';
import { WORKSPACE_PANEL_IDS } from '../src/common/editor/ui/workspace/workspace-panel-model.ts';

const ACTION_NAMES = Object.freeze([
	'selectNoTracks',
	'selectPreviousClipBoundaryToCursor',
	'selectCursorToNextClipBoundary',
	'selectPreviousClip',
	'selectNextClip',
	'skipToSelectionStart',
	'skipToSelectionEnd',
] as const);

test('Select and View menus expose all seven navigation actions as executable leaves', () => {
	const calls: string[] = [];
	const menus = createApplicationMenus(menuInput(actionPorts(Object.fromEntries(ACTION_NAMES.map((name) => [
		name,
		() => { calls.push(name); },
	])))));
	const select = topLevelMenu(menus, 'select');
	const tracks = child(select, 'select-tracks');
	const audioClips = child(select, 'menu-selection-audio-clips');
	const skip = child(topLevelMenu(menus, 'view'), 'menu-skip');
	const leaves = [
		child(tracks, 'select-no-tracks'),
		...audioClips.items ?? [],
		...skip.items ?? [],
	];
	assert.deepEqual(leaves.map(({ id }) => id), [
		'select-no-tracks',
		'select-previous-clip-boundary-to-cursor',
		'select-cursor-to-next-clip-boundary',
		'select-previous-clip',
		'select-next-clip',
		'skip-to-selection-start',
		'skip-to-selection-end',
	]);
	for (const leaf of leaves) {
		assert.equal(leaf.disabled, false, String(leaf.id));
		assert.equal(typeof leaf.onClick, 'function', String(leaf.id));
		leaf.onClick?.();
	}
	assert.deepEqual(calls, ACTION_NAMES);
});

test('menu model disables navigation only when its exact state prerequisite is absent', () => {
	const actions = actionPorts({});
	const empty = createClipSelectionNavigationMenuModel({
		blocked: false,
		copy: copyValues() as Readonly<Record<string, string>>,
		project: { tracks: [{ id: 'track-a', type: 'audio', clipIds: [] }], clips: [], selection: { trackIds: [] } },
		selectedTrackId: null,
	}, actions as never);
	assert.equal(empty.selectNoTracks.disabled, true);
	assert.ok(empty.audioClips.items.every(({ disabled }) => disabled));
	assert.ok(empty.skip.items.every(({ disabled }) => !disabled));

	const closed = createClipSelectionNavigationMenuModel({
		blocked: false,
		copy: copyValues() as Readonly<Record<string, string>>,
		project: null,
		selectedTrackId: null,
	}, actions as never);
	assert.ok(closed.skip.items.every(({ disabled }) => disabled));
});

test('workspace menu runtime delegates the seven menu leaves to controller timeline actions', () => {
	const calls: string[] = [];
	const timeline = Object.fromEntries(ACTION_NAMES.map((name) => [
		name,
		() => { calls.push(name); },
	]));
	const input = menuInput(actionPorts({}));
	const runtime = new Proxy({
		...input,
		controller: { actions: { timeline }, getTelemetrySnapshot: () => ({ positionFrame: 0 }) },
		fileService: { isDesktop: false },
		parityRuntime: { actions: null },
		run: (operation: () => unknown) => operation(),
	}, {
		get(target, property, receiver) {
			return Reflect.has(target, property)
				? Reflect.get(target, property, receiver)
				: () => undefined;
		},
	});
	const menus = createWorkspaceApplicationMenus(
		runtime as unknown as Parameters<typeof createWorkspaceApplicationMenus>[0],
	);
	const select = topLevelMenu(menus, 'select');
	const tracks = child(select, 'select-tracks');
	const audioClips = child(select, 'menu-selection-audio-clips');
	const skip = child(topLevelMenu(menus, 'view'), 'menu-skip');
	for (const leaf of [child(tracks, 'select-no-tracks'), ...audioClips.items ?? [], ...skip.items ?? []]) {
		leaf.onClick?.();
	}
	assert.deepEqual(calls, ACTION_NAMES);
});

interface MenuItem {
	readonly id?: unknown;
	readonly disabled?: unknown;
	readonly items?: readonly MenuItem[];
	readonly onClick?: () => unknown;
}

function topLevelMenu(value: unknown, id: string): MenuItem {
	const item = (value as readonly MenuItem[]).find((candidate) => candidate.id === id);
	assert.ok(item, id);
	return item;
}

function child(parent: MenuItem, id: string): MenuItem {
	const item = parent.items?.find((candidate) => candidate.id === id);
	assert.ok(item, id);
	return item;
}

function menuInput(actions: object) {
	const project = {
		id: 'project', sampleRate: 48_000,
		sources: [{ id: 'source-a', channelCount: 1, sampleRate: 48_000, sampleFormat: 'float32' }],
		clips: [{
			id: 'clip-a', kind: 'audio', sourceId: 'source-a', timelineStartFrame: 10,
			durationFrames: 20, sourceStartFrame: 0, sourceDurationFrames: 20,
		}],
		tracks: [{ id: 'track-a', type: 'audio', clipIds: ['clip-a'], effects: [] }],
		selection: { startFrame: 10, endFrame: 30, trackIds: ['track-a'], clipIds: [] },
		loop: { enabled: false }, snap: { enabled: false, division: 'samples' },
	};
	return {
		productId: 'soundscaper', aboutLabel: 'About', capabilities: {}, locale: 'en',
		copy: copyValues(), project,
		snapshot: {
			project, selectedTrackId: 'track-a',
			preferences: { workspace: {
				activeId: 'editing', custom: [],
				panels: Object.fromEntries(WORKSPACE_PANEL_IDS.map((id) => [id, { visible: false }])),
			}, view: {} },
			history: { canUndo: false, canRedo: false, hasClipboard: false },
			effects: { selectionTypes: [], canRepeatLast: false },
		},
		blocked: false, editBlocked: false, handoffBlocked: false, showArmControls: false,
		selectionActive: true, selectedClip: null, durationFrames: 100,
		effectsPanelOpen: false, projectBinEffectivelyOpen: false, uiFlags: {},
		actionRuntime: null, actions,
	};
}

function actionPorts(overrides: Readonly<Record<string, unknown>>): object {
	return new Proxy({ ...overrides }, {
		get(target, property, receiver) {
			return Reflect.has(target, property)
				? Reflect.get(target, property, receiver)
				: () => undefined;
		},
	});
}

function copyValues(): object {
	return new Proxy({
		noTracks: 'No tracks', selectAudioClips: 'Audio clips',
		previousClipBoundaryToCursor: 'Previous clip boundary to cursor',
		cursorToNextClipBoundary: 'Cursor to next clip boundary', previousClip: 'Previous clip',
		nextClip: 'Next clip', skipTo: 'Skip to', selectionStart: 'Selection start', selectionEnd: 'Selection end',
	}, { get: (target, property, receiver) => Reflect.get(target, property, receiver) ?? String(property) });
}
