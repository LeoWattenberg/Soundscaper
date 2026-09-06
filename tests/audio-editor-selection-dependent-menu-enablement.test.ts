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

interface MenuItem {
	readonly id?: unknown;
	readonly disabled?: unknown;
	readonly items?: readonly MenuItem[];
}

test('every selection-dependent command treats a selected clip as a selection', () => {
	const withTimeRange = enablement('time');
	const withClip = enablement('clip');
	for (const id of SELECTION_DEPENDENT_COMMANDS) {
		assert.equal(withTimeRange.get(id), true, `${id}: time selection`);
		assert.equal(withClip.get(id), true, `${id}: clip selection`);
	}
});

test('every selection-dependent command withholds itself when nothing is selected', () => {
	const withoutSelection = enablement('none');
	for (const id of SELECTION_DEPENDENT_COMMANDS) {
		assert.equal(withoutSelection.get(id), false, id);
	}
});

test('a selected track alone still reaches the commands that only need one', () => {
	const withoutSelection = enablement('none');
	// These act on the track or the playhead, not on a selected region, so a
	// selection gate would withhold them from the only state they work in.
	// Contrast belongs here too: the entry opens the panel that holds the
	// measurements already taken, and only measuring needs a selection.
	for (const id of ['realtime-effects', 'split', 'mix-render', 'resample', 'silence-generator', 'select-all', 'contrast']) {
		assert.equal(withoutSelection.get(id), true, id);
	}
});

type SelectionState = 'none' | 'time' | 'clip';

function enablement(state: SelectionState): Map<string, boolean> {
	const enabled = new Map<string, boolean>();
	const collect = (items: readonly MenuItem[] | undefined) => {
		for (const item of items ?? []) {
			if (typeof item?.id === 'string' && !item.items?.length) enabled.set(item.id, !item.disabled);
			if (item?.items?.length) collect(item.items);
		}
	};
	collect(createWorkspaceApplicationMenus(menuInput(state)) as readonly MenuItem[]);
	return enabled;
}

function selectionFor(state: SelectionState) {
	if (state === 'time') return { startFrame: 0, endFrame: 20, trackIds: ['track-a'], clipIds: [] };
	if (state === 'clip') return { startFrame: 0, endFrame: 0, trackIds: ['track-a'], clipIds: ['clip-a'] };
	return { startFrame: 0, endFrame: 0, trackIds: ['track-a'], clipIds: [] };
}

function menuInput(state: SelectionState) {
	const selection = selectionFor(state);
	const value = {
		id: 'project-a', schemaVersion: 12, sampleRate: 48_000,
		sources: [{ id: 'source-a', channelCount: 1, sampleRate: 48_000, sampleFormat: 'float32' }],
		clips: [{
			id: 'clip-a', kind: 'audio', sourceId: 'source-a',
			timelineStartFrame: 0, durationFrames: 20, sourceStartFrame: 0, sourceDurationFrames: 20,
		}],
		tracks: [{ id: 'track-a', name: 'Audio', type: 'audio', clipIds: ['clip-a'], effects: [], displayMode: 'waveform' }],
		selection,
		loop: { enabled: false }, snap: { enabled: false, division: 'samples' },
		master: { effects: [] }, mixer: { groups: [], sends: [], routes: {} },
	};
	const snapshot = {
		project: value,
		selectedTrackId: 'track-a',
		selectedClipId: state === 'clip' ? 'clip-a' : null,
		selection: state === 'time' ? selection : null,
		preferences: {
			workspace: {
				activeId: 'editing', custom: [],
				panels: Object.fromEntries(WORKSPACE_PANEL_IDS.map((id) => [id, { visible: false }])),
			},
			view: {}, effects: {},
		},
		history: { canUndo: true, canRedo: true, hasClipboard: true },
		effects: {
			selectionTypes: [{ type: 'audacity-amplify', label: 'Amplify' }],
			canRepeatLast: true,
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
		selectionActive: state === 'time',
		blocked: false, editBlocked: false, handoffBlocked: false, showArmControls: false,
		durationFrames: 20, projectBinEffectivelyOpen: false, uiFlags: {}, actionRuntime: null,
		fileService: { isDesktop: false }, parityRuntime: { actions: null },
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
