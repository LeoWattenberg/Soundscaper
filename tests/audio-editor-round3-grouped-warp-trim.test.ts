/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createClipTransformService } from '../src/common/editor/controller/clip-video/internal/clip/clip-transform-service.ts';
import type { ClipTransformProject } from '../src/common/editor/controller/clip-video/internal/clip/clip-domain-types.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';

function fixture(markers: readonly (readonly [number, number] | null)[]) {
	const sources = markers.map((_, index) => createAudioSource({ id: `source-${String(index)}`,
		storageKey: `source-${String(index)}`, name: 'Recording', sampleRate: 48_000, frameCount: 48_000, channelCount: 1 }));
	const clips = markers.map((marker, index) => createAudioClip({ id: `clip-${String(index)}`,
		sourceId: sources[index]!.id, groupId: 'recordings', timelineStartFrame: 0, durationFrames: 48_000,
		sourceStartFrame: 0, sourceDurationFrames: 48_000,
		...(marker ? { warpMap: { feature: 'audio-warp', points: [
			{ outer: 0, source: 0, mode: 'forward' },
			{ outer: marker[0], source: marker[1], mode: 'forward' },
			{ outer: 48_000, source: 48_000, mode: 'forward' },
		] } } : {}) }));
	const document = createSoundscaperProject({ id: 'grouped-recordings', title: 'Aligned recordings',
		now: '2026-10-07T00:00:00.000Z', sources, clips,
		tracks: clips.map((clip, index) => createAudioTrack({ id: `track-${String(index)}`, name: 'Recording', clipIds: [clip.id] })) });
	const runtime = createSoundscaperProjectRuntimeSelection();
	let history = runtime.createHistory(document);
	let commands = 0;
	const service = createClipTransformService({ lifetime: { assertActive() {} },
		copy: { audioClipNotFound: 'Missing clip', track: 'Track', timelineFramesFinite: 'Finite frames required' },
		getProject: () => runtime.projectForCommandConsumers(history.present) as ClipTransformProject,
		getSelectedClipId: () => 'clip-0', editingBlocked: () => false,
		createId: prefix => `${prefix}-new`, snapTimelineFrame: Number, activeSelection: () => null,
		commit: command => { history = runtime.executeCommand(history, command); commands += 1; } });
	return { service, present: () => history.present, commandCount: () => commands,
		undo: () => { history = runtime.undo(history); }, redo: () => { history = runtime.redo(history); } };
}

test('trimming the plain member resolves the warped companion right edge and publishes one reversible edit', () => {
	const edit = fixture([null, [43_201, 43_200]]);
	const original = edit.present().clips;
	edit.service.trimClips('clip-0', { durationFrames: 43_200 });
	const result = edit.present().clips;
	assert.deepEqual(result.map(clip => 'durationFrames' in clip ? clip.durationFrames : null), [43_201, 43_201]);
	assert.deepEqual(result.map(clip => 'sourceDurationFrames' in clip ? clip.sourceDurationFrames : null), [43_201, 43_200]);
	assert.equal(edit.commandCount(), 1);
	edit.undo(); assert.deepEqual(edit.present().clips, original);
	edit.redo(); assert.deepEqual(edit.present().clips, result);
});

test('a shared left trim derives each source window from its own exact mapping', () => {
	const edit = fixture([null, [4_801, 4_800]]);
	edit.service.trimClips('clip-0', { timelineStartFrame: 4_800, durationFrames: 43_200 });
	assert.deepEqual(edit.present().clips.map(clip => 'timelineStartFrame' in clip
		? [clip.timelineStartFrame, clip.durationFrames, clip.sourceStartFrame, clip.sourceDurationFrames] : null),
	[[4_801, 43_199, 4_801, 43_199], [4_801, 43_199, 4_800, 43_200]]);
});

test('different authored rates choose a common whole-source boundary rather than the active member boundary', () => {
	const edit = fixture([[24_000, 36_000], [24_000, 40_000]]);
	edit.service.trimClips('clip-0', { timelineStartFrame: 201, durationFrames: 47_799 });
	assert.deepEqual(edit.present().clips.map(clip => 'timelineStartFrame' in clip
		? [clip.timelineStartFrame, clip.sourceStartFrame] : null), [[198, 297], [198, 330]]);
});

test('an already exact shared edge stays exact and plain groups retain their requested edge', () => {
	for (const markers of [[null, null], [[24_000, 36_000], [24_000, 40_000]]] as const) {
		const edit = fixture(markers);
		edit.service.trimClips('clip-0', { durationFrames: 42_000 });
		assert.deepEqual(edit.present().clips.map(clip => 'durationFrames' in clip ? clip.durationFrames : null), [42_000, 42_000]);
	}
});
