/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	audacityActionDefinition,
	evaluateAudacityActionEnablement,
} from '../src/common/editor/audacity-action-parity.js';

const editableClipContext = {
	snapshot: {
		project: {
			tracks: [{ id: 'track-1', type: 'audio', clipIds: ['clip-1'], effects: [] as Array<{ id: string }> }],
			clips: [{ id: 'clip-1', kind: 'audio', pitchCents: 0 }],
			selection: {
				startFrame: 0,
				endFrame: 0,
				trackIds: ['track-1'],
				clipIds: ['clip-1'],
			},
		},
		selectedTrackId: 'track-1',
		selectedClipId: 'clip-1',
		readOnly: false,
		sampleEdit: { available: false, mode: null },
	},
};

test('contextual selection contractions are enabled for an editable selected clip', () => {
	assert.equal(evaluateAudacityActionEnablement('sel-cntr-left', editableClipContext), true);
	assert.equal(evaluateAudacityActionEnablement('sel-cntr-right', editableClipContext), true);

	const readOnlyContext = {
		snapshot: {
			...structuredClone(editableClipContext.snapshot),
			readOnly: true,
		},
	};
	assert.equal(evaluateAudacityActionEnablement('sel-cntr-left', readOnlyContext), false);
	assert.equal(evaluateAudacityActionEnablement('sel-cntr-right', readOnlyContext), false);
});

test('selection extension shortcuts support long seek during playback or editable selection work', () => {
	for (const id of [
		'sel-ext-left', 'sel-ext-right',
		'track-view-item-extend-left', 'track-view-item-extend-right',
	]) {
		assert.equal(audacityActionDefinition(id).enableWhen, 'playing-or-editable-clip-or-project-cursor', id);
		assert.equal(evaluateAudacityActionEnablement(id, editableClipContext), true, `${id}: editable clip`);
		const readOnly = {
			snapshot: { ...structuredClone(editableClipContext.snapshot), readOnly: true },
		};
		assert.equal(evaluateAudacityActionEnablement(id, readOnly), false, `${id}: read-only`);
		assert.equal(evaluateAudacityActionEnablement(id, {
			...readOnly,
			telemetry: { transportState: 'playing' },
		}), true, `${id}: playback seek`);
		assert.equal(evaluateAudacityActionEnablement(id, {
			snapshot: {
				project: { tracks: [], clips: [], selection: { startFrame: 0, endFrame: 0 } },
			},
		}), true, `${id}: stopped project cursor`);
	}
});

test('item extension remains a non-destructive project-cursor action while editing is blocked', () => {
	const cursorOnlyContext = {
		snapshot: {
			...structuredClone(editableClipContext.snapshot),
			selectedClipId: null,
			selectedTrackId: null,
			project: {
				...structuredClone(editableClipContext.snapshot.project),
				selection: {
					startFrame: 0, endFrame: 0, trackIds: [], clipIds: [], frequencyRange: null,
				},
			},
		},
	};
	assert.equal(evaluateAudacityActionEnablement('track-view-item-extend-left', cursorOnlyContext), true);
	assert.equal(evaluateAudacityActionEnablement('track-view-item-extend-left', {
		snapshot: { ...cursorOnlyContext.snapshot, importing: true },
	}), true);
});

test('selection, draw, and pitch tools expose the state they can actually operate on', () => {
	assert.equal(evaluateAudacityActionEnablement('select-tool', editableClipContext), true);
	assert.equal(evaluateAudacityActionEnablement('draw-tool', editableClipContext), false);
	assert.equal(evaluateAudacityActionEnablement('draw-tool', {
		snapshot: { ...editableClipContext.snapshot, sampleEdit: { available: true, mode: null } },
	}), true);
	assert.equal(evaluateAudacityActionEnablement('realtime-effect-move-up', editableClipContext), true);
	assert.equal(evaluateAudacityActionEnablement('realtime-effect-move-down', editableClipContext), true);

	const readOnly = {
		snapshot: {
			...editableClipContext.snapshot,
			readOnly: true,
			sampleEdit: { available: true, mode: null },
		},
	};
	assert.equal(evaluateAudacityActionEnablement('select-tool', readOnly), true);
	assert.equal(evaluateAudacityActionEnablement('draw-tool', readOnly), false);
	assert.equal(evaluateAudacityActionEnablement('realtime-effect-move-up', readOnly), false);
	const videoClip = structuredClone(editableClipContext);
	videoClip.snapshot.project.clips[0]!.kind = 'video';
	videoClip.snapshot.sampleEdit = { available: true, mode: null };
	assert.equal(evaluateAudacityActionEnablement('draw-tool', videoClip), false);
	assert.equal(evaluateAudacityActionEnablement('realtime-effect-move-up', videoClip), false);
});

test('focused realtime effects take exclusive priority over selected-clip pitch', () => {
	const effectContext = structuredClone(editableClipContext);
	effectContext.snapshot.project.tracks[0]!.effects = [{ id: 'first' }, { id: 'second' }];
	assert.equal(evaluateAudacityActionEnablement('realtime-effect-move-up', {
		...effectContext,
		realtimeEffectId: 'first',
	}), false, 'the top effect does not fall through to pitch-up');
	assert.equal(evaluateAudacityActionEnablement('realtime-effect-move-down', {
		...effectContext,
		realtimeEffectId: 'first',
	}), true);
	assert.equal(evaluateAudacityActionEnablement('realtime-effect-move-up', {
		...effectContext,
		realtimeEffectId: 'second',
	}), true);
	assert.equal(evaluateAudacityActionEnablement('realtime-effect-move-down', {
		...effectContext,
		realtimeEffectId: 'second',
	}), false, 'the bottom effect does not fall through to pitch-down');

	const upperPitchLimit = structuredClone(editableClipContext);
	upperPitchLimit.snapshot.project.clips[0]!.pitchCents = 1_150;
	assert.equal(evaluateAudacityActionEnablement('realtime-effect-move-up', upperPitchLimit), false);
	assert.equal(evaluateAudacityActionEnablement('realtime-effect-move-down', upperPitchLimit), true);
	const lowerPitchLimit = structuredClone(editableClipContext);
	lowerPitchLimit.snapshot.project.clips[0]!.pitchCents = -1_150;
	assert.equal(evaluateAudacityActionEnablement('realtime-effect-move-up', lowerPitchLimit), true);
	assert.equal(evaluateAudacityActionEnablement('realtime-effect-move-down', lowerPitchLimit), false);
});

test('legacy track mixer shortcuts distinguish selected media from the focused track', () => {
	const context = structuredClone(editableClipContext);
	context.snapshot.project.tracks.push({ id: 'video', type: 'video', clipIds: [], effects: [] });
	context.snapshot.project.selection.trackIds = ['video'];
	assert.equal(evaluateAudacityActionEnablement('mute-tracks', context), true);
	assert.equal(evaluateAudacityActionEnablement('unmute-tracks', context), true);
	assert.equal(evaluateAudacityActionEnablement('track-pan-left', context), true);
	assert.equal(evaluateAudacityActionEnablement('track-gain-inc', context), true);

	context.snapshot.selectedTrackId = 'video';
	assert.equal(evaluateAudacityActionEnablement('track-pan-left', context), false);
	assert.equal(evaluateAudacityActionEnablement('track-gain-inc', context), false);
	assert.equal(evaluateAudacityActionEnablement('track-mute', context), true);
	assert.equal(evaluateAudacityActionEnablement('track-solo', context), true);
	context.snapshot.project.selection.trackIds = [];
	assert.equal(evaluateAudacityActionEnablement('mute-tracks', context), true, 'focused video is the empty-selection fallback');
	context.snapshot.selectedTrackId = 'missing';
	assert.equal(evaluateAudacityActionEnablement('mute-tracks', context), false);
});

test('legacy mixer mutations honor every canonical editor edit block', () => {
	for (const blocked of [
		{ readOnly: true }, { takeCycleRecovery: true }, { importing: true },
		{ recordingStarting: true }, { recordingScheduling: true }, { scheduledRecording: {} },
		{ recording: true }, { playbackOptions: { preparing: true } }, { exporting: true },
		{ processingEffect: true }, { analysisProcessing: true }, { sampleEdit: { processing: true } },
	]) {
		const context = { snapshot: { ...structuredClone(editableClipContext.snapshot), ...blocked } };
		for (const id of ['mute-tracks', 'track-pan-left', 'track-mute']) {
			assert.equal(evaluateAudacityActionEnablement(id, context), false, `${id}: ${Object.keys(blocked)[0]}`);
		}
	}
});
