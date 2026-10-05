/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { collectCustomToolbarButtonActions } from '../src/common/editor/ui/toolbar/custom-toolbar-button-actions.ts';
import {
	createCustomToolbarContextMenus,
	CUSTOM_TOOLBAR_AUDIO_CONTEXT_ACTION_IDS,
	type CustomToolbarContextInput,
	type CustomToolbarContextSnapshot,
} from '../src/common/editor/ui/toolbar/custom-toolbar-context-actions.ts';

test('context commands can be assigned before selecting a track or clip and tolerate absent controller ports', () => {
	const actions = collectCustomToolbarButtonActions(createCustomToolbarContextMenus({
		controller: { actions: {} }, snapshot: {}, copy: ENGLISH_COPY,
		productId: 'soundscaper', capabilities: { audioEffects: true },
	}));
	for (const actionId of ['track-lock-toggle', 'track-swap-channels', 'local://reverse-clip', 'clip-render-pitch-speed']) {
		const action = actions.find((candidate) => candidate.actionId === actionId);
		assert.ok(action, actionId);
		assert.equal(action.disabled, true, actionId);
		assert.equal(action.onClick, undefined, actionId);
	}
});

test('selected-context buttons follow authoritative persisted selection when focus names another track', () => {
	const calls: unknown[] = [];
	const input = fixtureInput('b', calls);
	const actions = collectCustomToolbarButtonActions(createCustomToolbarContextMenus(input));
	actions.find(({ actionId }) => actionId === 'track-lock-toggle')?.onClick?.();
	actions.find(({ actionId }) => actionId === 'local://reverse-clip')?.onClick?.();
	actions.find(({ actionId }) => actionId === 'clip-render-pitch-speed')?.onClick?.();
	actions.find(({ actionId }) => actionId === 'clip-reset-pitch-speed')?.onClick?.();
	actions.find(({ actionId }) => actionId === 'stretch-clip-to-match-tempo')?.onClick?.();
	assert.deepEqual(calls, [
		['track.update', 'track-b', { locked: false }], ['clip.reverse', 'clip-b'],
		['clip.renderPitchSpeed', 'clip-b'], ['clip.resetPitchSpeed', 'clip-b'],
		['clip.toggleStretchToTempo', 'clip-b'],
	]);
});

test('rebuilt context commands target each current selection without retaining its previous entity', () => {
	const calls: unknown[] = [];
	for (const selected of ['a', 'b'] as const) {
		const actions = collectCustomToolbarButtonActions(createCustomToolbarContextMenus(fixtureInput(selected, calls)));
		actions.find(({ actionId }) => actionId === 'local://normalize-clip-peak')?.onClick?.();
	}
	assert.deepEqual(calls, [['clip.normalizePeak', 'clip-a'], ['clip.normalizePeak', 'clip-b']]);
});

test('a persisted time range keeps current-track commands but withholds retained focus clip commands', () => {
	const calls: unknown[] = [];
	const input = fixtureInput('b', calls);
	const project = input.snapshot.project!;
	const actions = collectCustomToolbarButtonActions(createCustomToolbarContextMenus({ ...input,
		snapshot: { ...input.snapshot, project: { ...project,
			selection: { startFrame: 0, endFrame: 20, trackIds: ['track-b'], clipIds: [] },
		} },
	}));
	actions.find(({ actionId }) => actionId === 'track-lock-toggle')?.onClick?.();
	assert.equal(actions.find(({ actionId }) => actionId === 'local://reverse-clip')?.disabled, true);
	assert.equal(actions.find(({ actionId }) => actionId === 'clip-select-track-clips')?.disabled, true);
	assert.deepEqual(calls, [['track.update', 'track-b', { locked: false }]]);
});

test('channel commands reuse track source layout and bind their selected track ID', () => {
	const calls: unknown[] = [];
	const mono = collectCustomToolbarButtonActions(createCustomToolbarContextMenus(fixtureInput('a', calls)));
	assert.equal(mono.find(({ actionId }) => actionId === 'track-swap-channels')?.disabled, true);
	const stereo = collectCustomToolbarButtonActions(createCustomToolbarContextMenus(fixtureInput('b', calls)));
	for (const actionId of ['track-swap-channels', 'track-split-stereo-to-lr', 'track-split-stereo-to-center']) {
		stereo.find((action) => action.actionId === actionId)?.onClick?.();
	}
	assert.deepEqual(calls, [
		['track.swapChannels', 'track-b'], ['track.splitStereoLR', 'track-b'], ['track.splitStereoCenter', 'track-b'],
	]);
});

test('read-only and unavailable product audio capabilities withhold contextual audio processing', () => {
	const calls: unknown[] = [];
	const input = fixtureInput('b', calls);
	const readOnly = collectCustomToolbarButtonActions(createCustomToolbarContextMenus({
		...input, snapshot: { ...input.snapshot, readOnly: true },
	}));
	assert.ok(readOnly.every(({ disabled }) => disabled));
	const framescaper = collectCustomToolbarButtonActions(createCustomToolbarContextMenus({
		...input, productId: 'framescaper', capabilities: { audioEffects: false },
	}));
	assert.equal(framescaper.find(({ actionId }) => actionId === 'track-lock-toggle')?.disabled, false);
	assert.equal(framescaper.find(({ actionId }) => actionId === 'track-swap-channels'), undefined);
	assert.equal(framescaper.find(({ actionId }) => actionId === 'local://reverse-clip'), undefined);
	assert.deepEqual(calls, []);
});

test('audio-context capability IDs also gate manifest runtime fallbacks on Framescaper', () => {
	const calls: unknown[] = [];
	const input = fixtureInput('b', calls);
	const actionRuntime = { ...input.controller?.actions, getActionContext: () => ({ snapshot: input.snapshot }) };
	const soundscaper = collectCustomToolbarButtonActions(createCustomToolbarContextMenus(input), { actionRuntime });
	soundscaper.find(({ actionId }) => actionId === 'clip-render-pitch-speed')?.onClick?.();
	assert.deepEqual(calls, [['clip.renderPitchSpeed', 'clip-b']], 'the ID-binding context descriptor wins over a raw controller fallback');
	const framescaper = collectCustomToolbarButtonActions(createCustomToolbarContextMenus({
		...input, productId: 'framescaper', capabilities: { audioEffects: false },
	}), { actionRuntime, disabledActionIds: CUSTOM_TOOLBAR_AUDIO_CONTEXT_ACTION_IDS });
	assert.ok(framescaper.every(({ actionId }) => !CUSTOM_TOOLBAR_AUDIO_CONTEXT_ACTION_IDS.some((id) => id === actionId)));
});

test('video tracks can be locked without exposing audio channel or clip processing handlers', () => {
	const calls: unknown[] = [];
	const input = fixtureInput('b', calls);
	const project = input.snapshot.project!;
	const snapshot = { ...input.snapshot, project: { ...project,
		tracks: project.tracks.map((track) => track.id === 'track-b' ? { ...track, type: 'video' } : track),
		clips: project.clips.map((clip) => clip.id === 'clip-b' ? { ...clip, kind: 'video' } : clip),
	} };
	const actions = collectCustomToolbarButtonActions(createCustomToolbarContextMenus({ ...input, snapshot }));
	actions.find(({ actionId }) => actionId === 'track-lock-toggle')?.onClick?.();
	assert.equal(actions.find(({ actionId }) => actionId === 'track-swap-channels')?.disabled, true);
	assert.equal(actions.find(({ actionId }) => actionId === 'local://reverse-clip')?.disabled, true);
	assert.deepEqual(calls, [['track.update', 'track-b', { locked: false }]]);
});

test('concrete context color actions retain distinct IDs and write actual color names to the current entities', () => {
	const calls: unknown[] = [];
	const actions = collectCustomToolbarButtonActions(createCustomToolbarContextMenus(fixtureInput('b', calls)));
	actions.find(({ actionId }) => actionId === 'action://trackedit/clip/change-color?colorindex=1')?.onClick?.();
	actions.find(({ actionId }) => actionId === 'action://trackedit/track/change-color?colorindex=2')?.onClick?.();
	assert.deepEqual(calls, [['clip.update', 'clip-b', { color: 'violet' }], ['track.update', 'track-b', { color: 'magenta' }]]);
	assert.equal(actions.filter(({ actionId }) => actionId.startsWith('action://trackedit/clip/change-color?')).length, 9);
});

test('clip drag equivalents bind stable destination IDs and select each current source track', () => {
	const calls: unknown[] = [];
	for (const selected of ['a', 'b'] as const) {
		const input = fixtureInput(selected, calls);
		const actions = collectCustomToolbarButtonActions(createCustomToolbarContextMenus({ ...input,
			controller: { actions: { ...input.controller?.actions,
				timeline: { selectClip: (id, options) => calls.push(['selectClip', id, options]) },
				clip: { ...input.controller?.actions?.clip, move: (id, trackId, frame, options) => calls.push(['move', id, trackId, frame, options]) },
			} },
		}));
		actions.find(({ actionId }) => actionId === 'clip-select-track-clips')?.onClick?.();
		actions.find(({ actionId }) => actionId === `clip-move-preserve-time-track-${selected === 'a' ? 'b' : 'a'}`)?.onClick?.();
	}
	assert.deepEqual(calls, [
		['selectClip', 'clip-a', { additive: false }], ['move', 'clip-a', 'track-b', 0, { preserveTime: true }],
		['selectClip', 'clip-b', { additive: false }], ['move', 'clip-b', 'track-a', 0, { preserveTime: true }],
	]);
});

function fixtureInput(selected: 'a' | 'b', calls: unknown[]): CustomToolbarContextInput {
	const snapshot: CustomToolbarContextSnapshot = {
		selectedTrackId: 'track-a', selectedClipId: 'clip-a',
		project: {
			tracks: [
				{ id: 'track-a', name: 'Mono', type: 'audio', clipIds: ['clip-a'], locked: false },
				{ id: 'track-b', name: 'Stereo', type: 'audio', clipIds: ['clip-b'], locked: true },
			],
			clips: [
				{ id: 'clip-a', kind: 'audio', sourceId: 'source-a', pitchCents: 0, speedRatio: 1, timelineStartFrame: 0 },
				{ id: 'clip-b', kind: 'audio', sourceId: 'source-b', pitchCents: 100, speedRatio: 2, timelineStartFrame: 0 },
			],
			sources: [{ id: 'source-a', channelCount: 1 }, { id: 'source-b', channelCount: 2 }],
			selection: { startFrame: 0, endFrame: 0, trackIds: [`track-${selected}`], clipIds: [`clip-${selected}`] },
		},
	};
	const target = (name: string) => (id: string) => calls.push([name, id]);
	return {
		snapshot, copy: ENGLISH_COPY, productId: 'soundscaper', capabilities: { audioEffects: true },
		controller: { actions: {
			track: {
				update: (id, changes) => calls.push(['track.update', id, changes]),
				makeStereo: target('track.makeStereo'), swapChannels: target('track.swapChannels'),
				splitStereoLR: target('track.splitStereoLR'), splitStereoCenter: target('track.splitStereoCenter'),
			},
			clip: {
				update: (id, changes) => calls.push(['clip.update', id, changes]),
				reverse: target('clip.reverse'), normalizePeak: target('clip.normalizePeak'),
				renderPitchSpeed: target('clip.renderPitchSpeed'), resetPitchSpeed: target('clip.resetPitchSpeed'),
				toggleStretchToTempo: target('clip.toggleStretchToTempo'),
			},
		} },
	};
}
