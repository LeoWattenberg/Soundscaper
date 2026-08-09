/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import {
	createEditorHistory,
	executeEditorCommand,
	undoEditorCommand,
} from '../src/common/editor/history.js';
import { PROJECT_OWNED_FEATURE_REQUIREMENT_IDS } from '../src/common/editor/project-owned-feature-requirements.ts';
import {
	createAudioClipV10,
	createAudioEditorProjectV10,
	createAudioSourceV10,
	createAudioTrackV10,
	createLabelTrackV10,
	createLabelV10,
	createVideoClipV10,
	createVideoSourceV10,
	createVideoTrackV10,
	loadAudioEditorProjectV10,
	validateAudioEditorProjectV10,
	type AudioEditorProjectV10,
} from '../src/common/editor/project-v10.ts';
import {
	resolveRuntimeClipProjection,
	resolveRuntimeProjectProjection,
} from '../src/common/editor/runtime-clip-projection.ts';
import {
	evaluateBreakpointMap,
	type BreakpointMap,
	type SampleFrame,
} from '../src/common/editor/timeline-time.ts';
import {
	createVideoTimingAssetPublication,
	validateVideoTimingAssetBytes,
} from '../src/common/editor/video-timing-asset.ts';

const CREATED_AT = '2026-08-09T12:00:00.000Z';
const EDITED_AT = '2026-08-09T12:01:00.000Z';
const UNDONE_AT = '2026-08-09T12:02:00.000Z';
const SOURCE_SHA256 = 'a'.repeat(64);

const TEMPO_MAP = {
	mode: 'sampleLocked',
	events: [
		{
			id: 'tempo-intro', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 },
			samplePosition: 0 as SampleFrame,
		},
		{
			id: 'tempo-body', beat: { num: 4, den: 1 }, bpm: { num: 90, den: 1 },
			samplePosition: 96_000 as SampleFrame,
		},
	],
} as const;

const SIGNATURE_MAP = {
	events: [
		{ id: 'signature-intro', bar: 0, numerator: 7, denominator: 8 },
		{ id: 'signature-body', bar: 8, numerator: 5, denominator: 4 },
	],
} as const;

const SEQUENCE = {
	id: 'editorial-sequence',
	name: '29.97 DF master',
	rate: { num: 30_000, den: 1_001 },
	dropFrame: true,
	startTimecode: { negative: true, hours: 1, minutes: 2, seconds: 3, frames: 12 },
	trackIds: ['audio-track', 'video-track', 'label-track'],
} as const;

const WARP_MAP = {
	feature: 'audio-warp',
	points: [
		{ outer: { num: 0, den: 1 }, source: { num: 1_234, den: 1 }, mode: 'forward' },
		{ outer: { num: 7, den: 2 }, source: { num: 101_234, den: 1 }, mode: 'forward' },
	],
} as const;

const RETIME_MAP = {
	feature: 'video-retime',
	points: [
		{ outer: { num: 0, den: 1 }, source: { num: 4, den: 1 }, mode: 'reverse' },
		{ outer: { num: 2, den: 1 }, source: { num: 2, den: 1 }, mode: 'freeze' },
		{ outer: { num: 3, den: 1 }, source: { num: 2, den: 1 }, mode: 'forward' },
		{ outer: { num: 5, den: 1 }, source: { num: 4, den: 1 }, mode: 'forward' },
	],
} as const;

const TIMING_PUBLICATION = createVideoTimingAssetPublication(SOURCE_SHA256, {
	timescale: 24_000,
	presentationTicks: [0n, 1_001n, 2_002n, 3_100n, 4_100n, 5_200n],
	finalFrameDurationTicks: 1_000n,
});

test('V10 foundation authorities survive command normalization, undo history, and reload', () => {
	const project = createFoundationProject();
	assertFoundationSemantics(project);
	const initialDocument = JSON.stringify(project);
	const initialReload = loadAudioEditorProjectV10(JSON.parse(initialDocument));
	assert.equal(initialReload.readOnly, false);
	assert.equal(JSON.stringify(initialReload.project), initialDocument, 'normalized V10 load/save must be byte-idempotent');
	assertFoundationSemantics(initialReload.project as AudioEditorProjectV10);

	const command: AudioEditorCommand = {
		type: 'clip/update',
		clipId: 'audio-clip',
		changes: { title: 'Edited musical audio' },
	};
	let history = createEditorHistory(project);
	history = executeEditorCommand(history, command, { now: EDITED_AT });
	const edited = history.present as AudioEditorProjectV10;
	assert.equal(byId(edited.clips, 'audio-clip').title, 'Edited musical audio');
	assertFoundationSemantics(edited);

	history = undoEditorCommand(history, { now: UNDONE_AT });
	const restored = history.present as AudioEditorProjectV10;
	assert.equal(byId(restored.clips, 'audio-clip').title, 'Musical audio');
	assert.equal(restored.revision, edited.revision + 1);
	assert.equal(restored.updatedAt, UNDONE_AT);
	assertFoundationSemantics(restored);

	const restoredDocument = JSON.stringify(restored);
	const restoredReload = loadAudioEditorProjectV10(JSON.parse(restoredDocument));
	assert.equal(restoredReload.readOnly, false);
	assert.equal(
		JSON.stringify(restoredReload.project),
		restoredDocument,
		'undo snapshot load/save must remain byte-idempotent apart from the already-applied revision metadata',
	);
	assertFoundationSemantics(restoredReload.project as AudioEditorProjectV10);
});

function createFoundationProject(): AudioEditorProjectV10 {
	const audioSource = createAudioSourceV10({
		id: 'audio-source', storageKey: 'audio-source', name: 'Audio', mimeType: 'audio/wav',
		frameCount: 192_000, channelCount: 2, sampleRate: 48_000, originalSampleRate: 96_000,
	});
	const videoSource = createVideoSourceV10({
		id: 'video-source', storageKey: 'video-source', name: 'Video', mimeType: 'video/mp4',
		sampleFrameCount: 12_400, sampleRate: 48_000, width: 1_920, height: 1_080,
		frameRate: { num: 24_000, den: 1_001 }, sourceFrameCount: 6,
		contentSha256: SOURCE_SHA256,
		timingAsset: TIMING_PUBLICATION.reference,
		timingDecision: { mode: 'exact', rate: { num: 24_000, den: 1_001 }, backend: 'ffprobe' },
		videoCodec: 'h264', audioCodec: null, hasAudio: false,
	});
	const audioClip = createAudioClipV10({
		id: 'audio-clip', sourceId: 'audio-source', title: 'Musical audio',
		sourceStartFrame: 1_234, sourceDurationFrames: 100_000,
		anchor: 'musical', musicalStartBeat: { num: 3, den: 2 }, musicalExtent: 'beat',
		musicalDurationBeats: { num: 7, den: 2 }, warpMap: WARP_MAP,
	}, { projectSampleRate: 48_000, tempoMap: TEMPO_MAP });
	const videoClip = createVideoClipV10({
		id: 'video-clip', sourceId: 'video-source', title: 'Retimed video',
		sequenceId: SEQUENCE.id, sequenceStartFrame: 45, sequenceFrameCount: 5,
		sourceInFrame: 1, sourceFrameCount: 4, retimeMap: RETIME_MAP,
	}, { projectSampleRate: 48_000, sequence: SEQUENCE, source: videoSource });
	const label = createLabelV10({
		id: 'musical-label', title: 'Cue', color: 'violet', opaqueExtensions: {},
		anchor: 'musical', startBeat: { num: 5, den: 2 }, endBeat: { num: 9, den: 2 },
	});
	return createAudioEditorProjectV10({
		id: 'foundation-history', title: 'Foundation history', now: CREATED_AT, sampleRate: 48_000,
		sequences: [SEQUENCE], primarySequenceId: SEQUENCE.id,
		tempoMap: TEMPO_MAP, signatureMap: SIGNATURE_MAP,
		sources: [audioSource, videoSource], clips: [audioClip, videoClip],
		tracks: [
			createAudioTrackV10({ id: 'audio-track', clipIds: ['audio-clip'] }),
			createVideoTrackV10({ id: 'video-track', clipIds: ['video-clip'] }),
			createLabelTrackV10({ id: 'label-track', labels: [label] }),
		],
	});
}

function assertFoundationSemantics(project: AudioEditorProjectV10): void {
	assert.equal(validateAudioEditorProjectV10(project), true);
	assert.equal(project.primarySequenceId, SEQUENCE.id);
	assert.deepEqual(project.sequences, [SEQUENCE]);
	assert.deepEqual(project.tempoMap, TEMPO_MAP);
	assert.deepEqual(project.signatureMap, SIGNATURE_MAP);

	const audioClip = byId(project.clips, 'audio-clip');
	assert.equal(audioClip.anchor, 'musical');
	assert.deepEqual(audioClip.musicalStartBeat, { num: 3, den: 2 });
	assert.equal(audioClip.musicalExtent, 'beat');
	assert.deepEqual(audioClip.musicalDurationBeats, { num: 7, den: 2 });
	assert.deepEqual(audioClip.warpMap, WARP_MAP);
	assert.equal(Object.hasOwn(audioClip, 'timelineStartFrame'), false);
	assert.equal(Object.hasOwn(audioClip, 'durationFrames'), false);
	const audioRuntime = resolveRuntimeClipProjection(project, audioClip);
	assert.deepEqual(
		[
			audioRuntime.timelineStartFrame, audioRuntime.timelineEndFrame, audioRuntime.durationFrames,
			audioRuntime.sourceStartFrame, audioRuntime.sourceEndFrame,
		],
		[36_000, 128_000, 92_000, 1_234, 101_234],
	);
	assert.deepEqual(evaluateBreakpointMap(audioClip.warpMap as BreakpointMap, { num: 7, den: 4 }), {
		num: 51_234, den: 1,
	});

	const videoSource = byId(project.sources, 'video-source');
	assert.equal(videoSource.sampleFrameCount, 12_400);
	assert.deepEqual(videoSource.frameRate, { num: 24_000, den: 1_001 });
	assert.equal(videoSource.sourceFrameCount, 6);
	assert.equal(videoSource.contentSha256, SOURCE_SHA256);
	assert.deepEqual(videoSource.timingAsset, TIMING_PUBLICATION.reference);
	assert.deepEqual(videoSource.timingDecision, {
		mode: 'exact', rate: { num: 24_000, den: 1_001 }, backend: 'ffprobe',
	});
	assert.equal(Object.hasOwn(videoSource, 'frameCount'), false);
	const timing = validateVideoTimingAssetBytes(videoSource.timingAsset, TIMING_PUBLICATION.bytes);
	assert.deepEqual(timing.presentationTicks, [0n, 1_001n, 2_002n, 3_100n, 4_100n, 5_200n]);
	assert.equal(timing.finalFrameDurationTicks, 1_000n);
	assert.equal(timing.endTicks, 6_200n);

	const videoClip = byId(project.clips, 'video-clip');
	assert.deepEqual(
		{
			sequenceId: videoClip.sequenceId,
			sequenceStartFrame: videoClip.sequenceStartFrame,
			sequenceFrameCount: videoClip.sequenceFrameCount,
			sourceInFrame: videoClip.sourceInFrame,
			sourceFrameCount: videoClip.sourceFrameCount,
			retimeMap: videoClip.retimeMap,
		},
		{
			sequenceId: SEQUENCE.id, sequenceStartFrame: 45, sequenceFrameCount: 5,
			sourceInFrame: 1, sourceFrameCount: 4, retimeMap: RETIME_MAP,
		},
	);
	for (const field of ['timelineStartFrame', 'durationFrames', 'sourceStartFrame', 'sourceDurationFrames']) {
		assert.equal(Object.hasOwn(videoClip, field), false);
	}
	const videoRuntime = resolveRuntimeClipProjection(project, videoClip);
	assert.deepEqual(
		[
			videoRuntime.timelineStartFrame, videoRuntime.timelineEndFrame, videoRuntime.durationFrames,
			videoRuntime.sourceStartFrame, videoRuntime.sourceEndFrame,
		],
		[72_072, 80_080, 8_008, 1, 5],
	);
	assert.deepEqual(evaluateBreakpointMap(videoClip.retimeMap as BreakpointMap, { num: 1, den: 1 }), {
		num: 3, den: 1,
	});
	assert.deepEqual(evaluateBreakpointMap(videoClip.retimeMap as BreakpointMap, { num: 5, den: 2 }), {
		num: 2, den: 1,
	});
	assert.deepEqual(evaluateBreakpointMap(videoClip.retimeMap as BreakpointMap, { num: 4, den: 1 }), {
		num: 3, den: 1,
	});

	const runtimeProject = resolveRuntimeProjectProjection(project);
	const labelTrack = byId(runtimeProject.tracks, 'label-track');
	assert.ok(Array.isArray(labelTrack.labels));
	const label = byId(labelTrack.labels as readonly Readonly<Record<string, unknown>>[], 'musical-label');
	assert.deepEqual(
		{
			anchor: label.anchor, startBeat: label.startBeat, endBeat: label.endBeat,
			startFrame: label.startFrame, endFrame: label.endFrame,
		},
		{
			anchor: 'musical', startBeat: { num: 5, den: 2 }, endBeat: { num: 9, den: 2 },
			startFrame: 60_000, endFrame: 112_000,
		},
	);
	const requirementIds = project.featureRequirements.requirements.map(({ id }) => id).sort();
	assert.deepEqual(requirementIds, [
		PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.audioWarp,
		PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.musicalTimeline,
		PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.sequenceTiming,
		PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.videoRetime,
		PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.videoTimingAssets,
	].sort());
}

function byId(
	values: readonly Readonly<Record<string, unknown>>[],
	id: string,
): Readonly<Record<string, unknown>> {
	const value = values.find((candidate) => candidate.id === id);
	assert.ok(value, `Missing fixture value ${id}`);
	return value;
}
