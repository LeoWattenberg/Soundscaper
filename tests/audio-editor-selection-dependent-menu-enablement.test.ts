/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createWorkspaceApplicationMenus } from '../src/common/editor/ui/workspace/workspace-application-menu-runtime.js';
import { WORKSPACE_PANEL_IDS } from '../src/common/editor/ui/workspace/workspace-panel-model.ts';

/**
 * Every application-menu command that acts on "the selection", named by menu
 * item id. Each has to answer the same two questions the same way: a selected
 * clip is a selection, and nothing selected is not one.
 */
const SELECTION_DEPENDENT_COMMANDS = Object.freeze([
	'action://cut',
	'cut-leave-gap',
	'delete-leave-gap',
	'copy',
	'duplicate-audio',
	'trim-audio-outside-selection',
	'silence-audio',
	'split-into-new-track',
	'disjoin',
	'set-loop-region-to-selection',
	'zero-crossings',
	'zoom-to-selection',
	'skip-to-selection-start',
	'skip-to-selection-end',
	'repeat-effect',
	'audacity-amplify',
	'change-pitch',
	'nyquist:tremolo',
	'nyquist:clipfix',
]);

const EFFECT_COMMANDS_WITH_DEFAULT_TARGET = new Set([
	'repeat-effect',
	'audacity-amplify',
	'change-pitch',
	'nyquist:tremolo',
	'nyquist:clipfix',
]);

interface MenuItem {
	readonly id?: unknown;
	readonly disabled?: unknown;
	readonly items?: readonly MenuItem[];
	readonly onClick?: unknown;
}

test('every selection-dependent command treats a selected clip as a selection', () => {
	const withTimeRange = enablement('time');
	const withClip = enablement('clip');
	for (const id of SELECTION_DEPENDENT_COMMANDS) {
		assert.equal(withTimeRange.get(id), true, `${id}: time selection`);
		assert.equal(withClip.get(id), true, `${id}: clip selection`);
	}
	assert.equal(withTimeRange.get('action://delete'), true, 'action://delete: time selection');
	assert.equal(withClip.get('action://delete'), true, 'action://delete: clip selection');
});

test('non-effect selection commands withhold themselves when nothing is selected', () => {
	const withoutSelection = enablement('none');
	for (const id of SELECTION_DEPENDENT_COMMANDS) {
		if (EFFECT_COMMANDS_WITH_DEFAULT_TARGET.has(id)) continue;
		assert.equal(withoutSelection.get(id), false, id);
	}
});

test('effects target all project audio by default, and the preference can require a selection', () => {
	const withDefaultTarget = enablement('none');
	const selectionRequired = enablement('none', false);
	for (const id of EFFECT_COMMANDS_WITH_DEFAULT_TARGET) {
		assert.equal(withDefaultTarget.get(id), true, `${id}: all-audio default`);
		assert.equal(selectionRequired.get(id), false, `${id}: selection required`);
	}
	assert.equal(withDefaultTarget.get('audacity-noise-reduction'), false,
		'Noise Reduction opts out of all-audio targeting');
	assert.equal(withDefaultTarget.get('audacity-auto-duck'), false,
		'Auto Duck keeps its control track outside implicit all-audio targeting');
	assert.equal(enablement('clip').get('audacity-noise-reduction'), true,
		'Noise Reduction remains available for an explicit clip selection');
	assert.equal(enablement('clip').get('audacity-auto-duck'), true,
		'Auto Duck remains available for an explicit clip selection');
	assert.equal(enablement('none', true, 'audacity-noise-reduction').get('repeat-effect'), false,
		'Repeat Last does not invent an all-audio target for Noise Reduction');
});

test('effects do not replace an explicit non-audio track selection with all project audio', () => {
	for (const state of ['label', 'label-cursor'] as const) {
		const withLabelSelection = enablement(state);
		for (const id of EFFECT_COMMANDS_WITH_DEFAULT_TARGET) {
			assert.equal(withLabelSelection.get(id), false, `${id}: ${state}`);
		}
	}
});

test('a label range does not advertise generic Delete when only the label track is selected', () => {
	assert.equal(enablement('label').get('action://delete'), false);
	assert.equal(enablement('label-cursor').get('action://delete'), true,
		'a collapsed label focus remains a selected-track delete target');
});

test('a trackless time selection uses the effect all-audio preference without enabling Noise Reduction', () => {
	const withDefaultTarget = enablement('trackless-time');
	const selectionRequired = enablement('trackless-time', false);
	for (const id of EFFECT_COMMANDS_WITH_DEFAULT_TARGET) {
		assert.equal(withDefaultTarget.get(id), true, `${id}: trackless all-audio target`);
		assert.equal(selectionRequired.get(id), false, `${id}: trackless selection required`);
	}
	assert.equal(withDefaultTarget.get('audacity-noise-reduction'), false);
	assert.equal(enablement('trackless-time', true, 'audacity-noise-reduction').get('repeat-effect'), false,
		'Repeat Last keeps the Noise Reduction exception for a trackless range');
});

test('ordinary Edit-menu Cut and Delete dispatch the preference-aware actions', () => {
	const dispatched: string[] = [];
	const menus = createWorkspaceApplicationMenus(
		menuInput('time', true, (action) => dispatched.push(action)),
	) as readonly MenuItem[];
	const leaves = new Map<string, MenuItem>();
	const collect = (items: readonly MenuItem[]): void => {
		for (const item of items) {
			if (typeof item.id === 'string' && !item.items?.length) leaves.set(item.id, item);
			if (item.items?.length) collect(item.items);
		}
	};
	collect(menus);
	(leaves.get('action://cut')?.onClick as (() => void) | undefined)?.();
	(leaves.get('action://delete')?.onClick as (() => void) | undefined)?.();
	assert.deepEqual(dispatched, ['cut', 'delete']);
});

test('a selected track alone still reaches the commands that only need one', () => {
	const withoutSelection = enablement('none');
	// These act on the track or the playhead, not on a selected region, so a
	// selection gate would withhold them from the only state they work in.
	// Contrast belongs here too: the entry opens the panel that holds the
	// measurements already taken, and only measuring needs a selection.
	for (const id of ['action://delete', 'realtime-effects', 'split', 'mix-render', 'resample', 'silence-generator', 'select-all', 'contrast']) {
		assert.equal(withoutSelection.get(id), true, id);
	}
});

type SelectionState = 'none' | 'time' | 'trackless-time' | 'clip' | 'label' | 'label-cursor';

function enablement(
	state: SelectionState,
	applyEffectsToAllAudio = true,
	lastSelectionType = 'audacity-amplify',
): Map<string, boolean> {
	const enabled = new Map<string, boolean>();
	const collect = (items: readonly MenuItem[] | undefined) => {
		for (const item of items ?? []) {
			if (typeof item?.id === 'string' && !item.items?.length) enabled.set(item.id, !item.disabled);
			if (item?.items?.length) collect(item.items);
		}
	};
	collect(createWorkspaceApplicationMenus(
		menuInput(state, applyEffectsToAllAudio, () => undefined, lastSelectionType),
	) as readonly MenuItem[]);
	return enabled;
}

function selectionFor(state: SelectionState) {
	if (state === 'time') return { startFrame: 0, endFrame: 20, trackIds: ['track-a'], clipIds: [] };
	if (state === 'trackless-time') return { startFrame: 0, endFrame: 20, trackIds: [], clipIds: [] };
	if (state === 'clip') return { startFrame: 0, endFrame: 0, trackIds: ['track-a'], clipIds: ['clip-a'] };
	if (state === 'label') return { startFrame: 0, endFrame: 20, trackIds: ['labels'], clipIds: [] };
	if (state === 'label-cursor') return { startFrame: 0, endFrame: 0, trackIds: ['labels'], clipIds: [] };
	return { startFrame: 0, endFrame: 0, trackIds: ['track-a'], clipIds: [] };
}

function menuInput(
	state: SelectionState,
	applyEffectsToAllAudio = true,
	executeEdit: (action: string) => unknown = () => undefined,
	lastSelectionType = 'audacity-amplify',
) {
	const selection = selectionFor(state);
	const value = {
		id: 'project-a', schemaVersion: 12, sampleRate: 48_000,
		sources: [{ id: 'source-a', channelCount: 1, sampleRate: 48_000, sampleFormat: 'float32' }],
		clips: [{
			id: 'clip-a', kind: 'audio', sourceId: 'source-a',
			timelineStartFrame: 0, durationFrames: 20, sourceStartFrame: 0, sourceDurationFrames: 20,
		}],
		tracks: [
			{ id: 'track-a', name: 'Audio', type: 'audio', clipIds: ['clip-a'], effects: [], displayMode: 'waveform' },
			{ id: 'labels', name: 'Labels', type: 'label', labels: [] },
		],
		selection,
		loop: { enabled: false }, snap: { enabled: false, division: 'samples' },
		master: { effects: [] }, mixer: { groups: [], sends: [], routes: {} },
	};
	const snapshot = {
		project: value,
		selectedTrackId: state === 'trackless-time'
			? null
			: state === 'label' || state === 'label-cursor' ? 'labels' : 'track-a',
		selectedClipId: state === 'clip' ? 'clip-a' : null,
		selection: state === 'time' || state === 'trackless-time' || state === 'label' ? selection : null,
		preferences: {
			workspace: {
				activeId: 'editing', custom: [],
				panels: Object.fromEntries(WORKSPACE_PANEL_IDS.map((id) => [id, { visible: false }])),
			},
			view: {}, effects: {}, editing: { applyEffectsToAllAudio },
		},
		history: { canUndo: true, canRedo: true, hasClipboard: true },
		effects: {
			selectionTypes: [
				{ type: 'audacity-amplify', label: 'Amplify' },
				{ type: 'audacity-auto-duck', label: 'Auto Duck' },
				{ type: 'audacity-noise-reduction', label: 'Noise Reduction' },
			],
			canRepeatLast: true,
			lastSelectionType,
		},
		timeline: { view: 'waveform' },
		readOnly: false,
	};
	const input = {
		productId: 'soundscaper', aboutLabel: 'About', locale: 'en',
		capabilities: { audioEffects: true, audioGenerators: true, audioAnalysis: true, audioMacros: true },
		copy: new Proxy({}, { get: (_target, property) => String(property) }),
		project: value, snapshot,
		selectedAudioTrack: value.tracks[0],
		selectedClip: state === 'clip' ? value.clips[0] : null,
		selectionActive: state === 'time' || state === 'trackless-time' || state === 'label',
		blocked: false, editBlocked: false, handoffBlocked: false, showArmControls: false,
		durationFrames: 20, projectBinEffectivelyOpen: false, uiFlags: {}, actionRuntime: null,
		fileService: { isDesktop: false }, parityRuntime: { actions: null },
		executeEdit,
		actions: new Proxy({}, { get: () => () => undefined }),
		run: (operation: () => unknown) => operation(),
		openSurface: () => undefined,
	};
	// Absent ports answer as no-ops, but a declared `null` stays null: swallowing
	// it would make every "nothing is selected" case read as a selected clip.
	return new Proxy(input, {
		get: (target, property, receiver) => (
			property in target ? Reflect.get(target, property, receiver) : (() => undefined)
		),
	}) as unknown as Parameters<typeof createWorkspaceApplicationMenus>[0];
}
