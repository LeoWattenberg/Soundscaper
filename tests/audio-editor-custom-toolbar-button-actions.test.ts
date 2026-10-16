/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	collectCustomToolbarButtonActions,
	type CustomToolbarButtonMenuItem,
} from '../src/common/editor/ui/toolbar/custom-toolbar-button-actions.ts';
import { createWorkspaceApplicationMenus } from '../src/common/editor/ui/workspace/workspace-application-menu-runtime.js';
import { createAudioEditorPreferencesV1 } from '../src/common/editor/preferences.js';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';

test('custom buttons offer nested effect and plugin commands while retaining selection-disabled actions', () => {
	const invoked: string[] = [];
	const menus: readonly CustomToolbarButtonMenuItem[] = [
		{
			id: 'effect', label: 'Effect', items: [
				{ divider: true },
				{ id: 'fading', label: 'Fading', items: [
					{ id: 'audacity-fade-in', label: 'Fade In', disabled: true },
					{ id: 'audacity-fade-out', label: 'Fade Out', onClick: () => invoked.push('fade') },
				] },
				{ id: 'nyquist', label: 'Nyquist', items: [
					{ id: 'nyquist:archive:custom.ny', label: 'My plugin', onClick: () => invoked.push('plugin') },
				] },
			],
		},
	];

	const actions = collectCustomToolbarButtonActions(menus);

	assert.deepEqual(actions.map(({ actionId, path, disabled }) => ({ actionId, path, disabled })), [
		{ actionId: 'audacity-fade-in', path: ['Effect', 'Fading', 'Fade In'], disabled: true },
		{ actionId: 'audacity-fade-out', path: ['Effect', 'Fading', 'Fade Out'], disabled: false },
		{ actionId: 'nyquist:archive:custom.ny', path: ['Effect', 'Nyquist', 'My plugin'], disabled: false },
	]);
	assert.equal(actions[0].onClick, undefined);
	actions[1].onClick?.();
	actions[2].onClick?.();
	assert.deepEqual(invoked, ['fade', 'plugin']);
});

test('disabled ancestors and deferred menu availability also gate native preference actions', () => {
	let available = false;
	let invoked = 0;
	const menus: readonly CustomToolbarButtonMenuItem[] = [{
		id: 'edit', label: 'Edit', resolve: () => ({ disabled: !available, disabledReason: 'Busy' }), items: [
			{ id: 'preferences', label: 'Preferences', onClick: () => invoked++, nativePreferences: [
				{ id: 'native-device-fixture', label: 'Native device', onClick: () => invoked++ },
			] },
		],
	}];

	const disabled = collectCustomToolbarButtonActions(menus);
	assert.deepEqual(disabled.map(({ disabled, disabledReason, onClick }) => ({ disabled, disabledReason, onClick })), [
		{ disabled: true, disabledReason: 'Busy', onClick: undefined },
		{ disabled: true, disabledReason: 'Busy', onClick: undefined },
	]);
	assert.equal(invoked, 0);
	available = true;
	const enabled = collectCustomToolbarButtonActions(menus);
	assert.ok(enabled.every(({ disabled }) => !disabled));
	enabled[0].onClick?.();
	enabled[1].onClick?.();
	assert.equal(invoked, 2);
});

test('concrete dynamic actions keep distinct persistent ids and menu aliases resolve consistently', () => {
	const menus: readonly CustomToolbarButtonMenuItem[] = [{ id: 'tracks', label: 'Tracks', items: [
		{ id: 'track-resample?rate=44100', parityActionId: 'track-resample?rate=%1', label: '44100 Hz', onClick: () => undefined },
		{ id: 'track-resample?rate=48000', parityActionId: 'track-resample?rate=%1', label: '48000 Hz', onClick: () => undefined },
		{ id: 'zoom-fit', label: 'Fit project', onClick: () => undefined },
		{ id: 'zoom-to-fit-project', label: 'Fit project again', onClick: () => undefined },
	] }];

	assert.deepEqual(collectCustomToolbarButtonActions(menus).map(({ actionId }) => actionId), [
		'track-resample?rate=44100', 'track-resample?rate=48000', 'zoom-to-fit-project',
	]);
});

test('custom action inventories omit menu headers and editor commands that are not implemented', () => {
	const menus: readonly CustomToolbarButtonMenuItem[] = [{ id: 'file', label: 'File', items: [
		{ id: 'empty-container', label: 'Empty container', disabled: true, items: [] },
		{ id: 'section', label: 'Section' },
		{ id: 'export-midi', label: 'Export MIDI', disabled: true },
		{ id: 'toggle-tracks', label: 'Tracks panel', disabled: true },
		{ id: 'local-disabled-fixture', label: 'Local action', disabled: true, disabledReason: 'Select audio' },
	] }];

	const actions = collectCustomToolbarButtonActions(menus);
	assert.equal(actions.length, 1);
	assert.equal(actions[0].actionId, 'local-disabled-fixture');
	assert.equal(actions[0].disabledReason, 'Select audio');
});

test('runtime-only editor commands use the current runtime context and product capability restrictions', () => {
	let opened = false;
	let invoked = 0;
	const actionRuntime = {
		getActionContext: () => ({ predicates: { 'project-opened': opened } }),
		timeline: { setSecondsRuler: () => invoked++ },
		recording: { startCurrentTrack: () => invoked++ },
	};

	const disabled = collectCustomToolbarButtonActions([], { actionRuntime, disabledActionIds: ['record'] });
	assert.equal(disabled.length, 1);
	assert.equal(disabled[0].actionId, 'minutes-seconds-ruler');
	assert.equal(disabled[0].disabled, true);
	assert.equal(disabled[0].onClick, undefined);

	opened = true;
	const enabled = collectCustomToolbarButtonActions([], { actionRuntime, disabledActionIds: ['record'] });
	assert.equal(enabled[0].disabled, false);
	assert.deepEqual(enabled[0].path, ['Timeline ruler', 'Minutes and seconds ruler']);
	enabled[0].onClick?.();
	assert.equal(invoked, 1);
});

test('a runtime handler does not override a menu refusal and fresh snapshots use fresh callbacks', () => {
	const invoked: string[] = [];
	const actionRuntime = { timeline: { zoomIn: () => invoked.push('runtime') } };
	const menuFor = (selection: string, disabled: boolean): readonly CustomToolbarButtonMenuItem[] => [{
		id: 'view', label: 'View', items: [{
			id: 'zoom-in', label: 'Zoom in', disabled,
			onClick: () => invoked.push(selection),
		}],
	}];
	const disabled = collectCustomToolbarButtonActions(menuFor('old', true), { actionRuntime });
	assert.equal(disabled[0].disabled, true);
	assert.equal(disabled[0].onClick, undefined);
	const current = collectCustomToolbarButtonActions(menuFor('current', false), { actionRuntime });
	current[0].onClick?.();
	assert.deepEqual(invoked, ['current']);
});

test('implemented runtime commands remain selectable when they are omitted from application menus', () => {
	const actionRuntime = {
		getActionContext: () => ({ predicates: { 'editable-audio-track-selected': true } }),
		track: { openMixRender: () => undefined },
	};
	const actions = collectCustomToolbarButtonActions([], { actionRuntime });
	assert.deepEqual(actions.map(({ actionId }) => actionId), ['mix-render']);
	assert.equal(actions.find(({ actionId }) => actionId === 'mix-render')?.disabled, false);
	assert.deepEqual(collectCustomToolbarButtonActions([], { actionRuntime, disabledActionIds: ['mix-render'] }), []);
});

test('real workspace menu actions preserve selection gating and dispatch the current editing action', () => {
	const dispatched: string[] = [];
	for (const selected of [false, true]) {
		const input = workspaceMenuInput(selected, (action) => dispatched.push(action));
		const menus = createWorkspaceApplicationMenus(input as unknown as Parameters<typeof createWorkspaceApplicationMenus>[0]) as readonly CustomToolbarButtonMenuItem[];
		const actions = collectCustomToolbarButtonActions(menus, {
			actionRuntime: input.parityRuntime.actions,
		});
		const deleteSelection = actions.find(({ actionId }) => actionId === 'delete-leave-gap');
		assert.ok(deleteSelection);
		assert.equal(deleteSelection.disabled, !selected);
		deleteSelection.onClick?.();
		for (const actionId of ['audacity-amplify', 'nyquist:adjustable-fade', 'zoom-to-selection']) {
			assert.equal(actions.find((action) => action.actionId === actionId)?.disabled, !selected, actionId);
		}
	}
	assert.deepEqual(dispatched, ['deleteLeaveGap']);
});

function workspaceMenuInput(selected: boolean, executeEdit: (action: string) => unknown) {
	const selection = {
		startFrame: 0, endFrame: 0, trackIds: ['track-a'], clipIds: selected ? ['clip-a'] : [],
	};
	const project = {
		id: 'project-a', schemaVersion: 12, sampleRate: 48_000,
		sources: [{ id: 'source-a', channelCount: 1, sampleRate: 48_000, sampleFormat: 'float32' }],
		clips: [{ id: 'clip-a', kind: 'audio', sourceId: 'source-a', timelineStartFrame: 0,
			durationFrames: 20, sourceStartFrame: 0, sourceDurationFrames: 20 }],
		tracks: [{ id: 'track-a', name: 'Audio', type: 'audio', clipIds: ['clip-a'], effects: [] }],
		selection, loop: { enabled: false }, snap: { enabled: false, division: 'samples' },
		master: { effects: [] }, mixer: { groups: [], sends: [], routes: {} },
	};
	const preferences = createAudioEditorPreferencesV1({ editing: { applyEffectsToAllAudio: false } });
	const snapshot = {
		project, selectedTrackId: 'track-a', selectedClipId: selected ? 'clip-a' : null,
		selection: null, preferences, readOnly: false,
		history: { canUndo: true, canRedo: true, hasClipboard: true },
		effects: { selectionTypes: [{ type: 'audacity-amplify', label: 'Amplify' }] },
	};
	const input = {
		productId: 'soundscaper', aboutLabel: 'About', locale: 'en', copy: ENGLISH_COPY,
		capabilities: { audioEffects: true, audioGenerators: true, audioAnalysis: true, audioMacros: true },
		project, snapshot, selectedAudioTrack: project.tracks[0],
		selectedClip: selected ? project.clips[0] : null, selectionActive: false,
		blocked: false, editBlocked: false, handoffBlocked: false, showArmControls: false,
		durationFrames: 20, projectBinEffectivelyOpen: false, uiFlags: {},
		fileService: { isDesktop: false },
		parityRuntime: { actions: { getActionContext: () => ({ snapshot }) } },
		executeEdit, run: (operation: () => unknown) => operation(), openSurface: () => undefined,
	};
	return new Proxy(input, {
		get: (target, property, receiver) => property in target ? Reflect.get(target, property, receiver) : () => undefined,
	});
}
