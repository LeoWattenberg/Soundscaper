/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import {
	createCurrentAudioEditorProject,
	validateCurrentAudioEditorProject,
} from '../src/common/editor/project-current.ts';
import {
	createAudioClipV10,
	createAudioSourceV10,
	createAudioTrackV10,
	createVideoClipV10,
	createVideoSourceV10,
	createVideoTrackV10,
} from '../src/common/editor/project-v10.ts';
import {
	createVideoTimingAssetPublication,
	decodeVideoTimingAsset,
} from '../src/common/editor/video-timing-asset.ts';
import { createUnreportedVideoSourceCharacteristics } from '../src/common/editor/video-source-characteristics.ts';
import { planVideoSourceUpgrade } from '../src/common/editor/video-source-upgrade.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';

const NOW = '2026-08-10T12:00:00.000Z';
const SAMPLE_RATE = 48_000;
const CONTENT_SHA256 = 'ef'.repeat(32);
const FABRICATED_RATE = Object.freeze({ num: 30, den: 1 });
const EXACT_RATE = Object.freeze({ num: 24, den: 1 });
const SEQUENCE = Object.freeze({ id: 'main', rate: FABRICATED_RATE });

type ProjectRecord = ReturnType<typeof unprobedProject>;

function exactTiming(frameCount: number) {
	const publication = createVideoTimingAssetPublication(CONTENT_SHA256, {
		timescale: 24_000,
		presentationTicks: Array.from({ length: frameCount }, (_, index) => BigInt(index) * 1_000n),
		finalFrameDurationTicks: 1_000n,
	});
	return {
		reference: publication.reference,
		probe: {
			decision: 'timing-asset' as const,
			backend: 'ffmpeg',
			nominalRate: EXACT_RATE,
			timing: decodeVideoTimingAsset(publication.bytes),
			characteristics: createUnreportedVideoSourceCharacteristics(),
		},
	};
}

/** Ten seconds of media whose rate nothing ever read: 300 fabricated frames. */
function unprobedProject() {
	const source = createVideoSourceV10({
		kind: 'video',
		id: 'video-source',
		storageKey: 'video-source',
		name: 'phone.mp4',
		mimeType: 'video/mp4',
		contentSha256: CONTENT_SHA256,
		frameCount: SAMPLE_RATE * 10,
		sampleRate: SAMPLE_RATE,
		width: 640,
		height: 360,
		frameRate: FABRICATED_RATE,
		sourceFrameCount: 300,
		timingAsset: null,
		timingDecision: {
			mode: 'conform-cfr-at-ingest',
			rate: FABRICATED_RATE,
			reason: 'timing-probe-unavailable',
			failures: [],
		},
		videoCodec: 'unknown',
		audioCodec: null,
		hasAudio: false,
	}, SAMPLE_RATE);
	const context = { projectSampleRate: SAMPLE_RATE, sequence: SEQUENCE, source };
	const timeline = createVideoClipV10({
		id: 'timeline-clip',
		sourceId: source.id,
		sequenceId: SEQUENCE.id,
		sequenceStartFrame: 0,
		sequenceFrameCount: 300,
		sourceInFrame: 0,
		sourceFrameCount: 300,
	}, context);
	const binned = createVideoClipV10({
		id: 'bin-clip',
		sourceId: source.id,
		sequenceId: SEQUENCE.id,
		sequenceStartFrame: 0,
		sequenceFrameCount: 60,
		sourceInFrame: 30,
		sourceFrameCount: 60,
		binItemId: 'bin-clip',
	}, context);
	return createCurrentAudioEditorProject({
		id: 'reprobe-project',
		now: NOW,
		sampleRate: SAMPLE_RATE,
		sequences: [SEQUENCE],
		primarySequenceId: SEQUENCE.id,
		sources: [source],
		clips: [timeline],
		tracks: [createVideoTrackV10({ id: 'video-track', clipIds: ['timeline-clip'] })],
		projectBin: { clips: [binned] },
	});
}

function reprobeCommand(project: ProjectRecord, frameCount: number): AudioEditorCommand {
	const exact = exactTiming(frameCount);
	const plan = planVideoSourceUpgrade({
		source: project.sources[0],
		probe: exact.probe,
		timingAsset: exact.reference,
		clips: [...project.clips, ...project.projectBin.clips],
	});
	return {
		type: 'source/reprobe',
		sourceId: plan.sourceId,
		changes: plan.changes,
		clips: plan.clips,
	} as AudioEditorCommand;
}

function videoAuthority(project: ProjectRecord): unknown[] {
	return [...project.clips, ...project.projectBin.clips].map((clip) => [
		clip.id,
		clip.sequenceStartFrame,
		clip.sequenceFrameCount,
		clip.sourceInFrame,
		clip.sourceFrameCount,
	]);
}

test('one command replaces the reading and every range cut against the old grid', () => {
	const project = unprobedProject();
	const upgraded = applyEditorCommand(
		project,
		reprobeCommand(project, 240),
		{ now: NOW },
	) as ProjectRecord;

	const source = upgraded.sources[0] as Record<string, unknown>;
	assert.deepEqual(source.frameRate, EXACT_RATE);
	assert.equal(source.sourceFrameCount, 240);
	assert.deepEqual(source.timingDecision, { mode: 'exact', rate: EXACT_RATE, backend: 'ffmpeg' });
	assert.ok(source.timingAsset);
	// The bytes, their wall-clock duration, and the audio extracted from them are
	// all untouched: only what the document knows about them moved.
	assert.equal(source.contentSha256, CONTENT_SHA256);
	assert.equal(source.sampleFrameCount, SAMPLE_RATE * 10);
	assert.equal(source.hasAudio, false);
	// Every clip stays exactly where it sat in its sequence and shows the same
	// media instants on the corrected grid.
	assert.deepEqual(videoAuthority(upgraded), [
		['timeline-clip', 0, 300, 0, 240],
		['bin-clip', 0, 60, 24, 48],
	]);
	assert.equal(validateCurrentAudioEditorProject(upgraded), true);
});

test('a shortened source clamps its ranges inside the document the command produces', () => {
	const project = unprobedProject();
	const upgraded = applyEditorCommand(
		project,
		reprobeCommand(project, 200),
		{ now: NOW },
	) as ProjectRecord;

	assert.equal((upgraded.sources[0] as Record<string, unknown>).sourceFrameCount, 200);
	assert.deepEqual(videoAuthority(upgraded), [
		['timeline-clip', 0, 300, 0, 200],
		['bin-clip', 0, 60, 24, 48],
	]);
	assert.equal(validateCurrentAudioEditorProject(upgraded), true);
});

test('the command refuses to change anything a re-read cannot conclude', () => {
	const project = unprobedProject();
	for (const changes of [{ name: 'renamed.mp4' }, { contentSha256: 'ab'.repeat(32) }, { sampleFrameCount: 1 }]) {
		assert.throws(() => applyEditorCommand(project, {
			type: 'source/reprobe',
			sourceId: 'video-source',
			changes,
		} as AudioEditorCommand, { now: NOW }), /cannot change/);
	}
	assert.throws(() => applyEditorCommand(project, {
		type: 'source/reprobe',
		sourceId: 'audio-source',
		changes: {},
	} as AudioEditorCommand, { now: NOW }), /Unknown source/);
});

test('a range the command is handed that the new media cannot hold is rejected', () => {
	const project = unprobedProject();
	const command = reprobeCommand(project, 240) as unknown as Record<string, unknown>;
	assert.throws(() => applyEditorCommand(project, {
		...command,
		clips: [{ clipId: 'timeline-clip', sourceInFrame: 0, sourceFrameCount: 300 }],
	} as unknown as AudioEditorCommand, { now: NOW }), /source bounds/);
});

test('linked audio does not move, because the video clip it mirrors did not', () => {
	const project = unprobedProject();
	const audioSource = createAudioSourceV10({
		kind: 'audio',
		id: 'audio-source',
		storageKey: 'audio-source',
		name: 'phone Audio',
		mimeType: 'audio/x-soundscaper-extracted',
		frameCount: SAMPLE_RATE * 10,
		channelCount: 2,
		sampleRate: SAMPLE_RATE,
	});
	const audioClip = createAudioClipV10({
		id: 'audio-clip',
		sourceId: 'audio-source',
		timelineStartFrame: 0,
		durationFrames: SAMPLE_RATE * 10,
		sourceStartFrame: 0,
		sourceDurationFrames: SAMPLE_RATE * 10,
		avLinkId: 'av-link',
	});
	const linked = createCurrentAudioEditorProject({
		...project,
		// Re-derive the hierarchy so the added audio track belongs to the sequence.
		sequences: [{ id: SEQUENCE.id, rate: SEQUENCE.rate }],
		sources: [...project.sources, audioSource],
		clips: [{ ...project.clips[0], avLinkId: 'av-link' }, audioClip],
		tracks: [
			createVideoTrackV10({ id: 'video-track', clipIds: ['timeline-clip'], laneGroupId: 'media-lane' }),
			createAudioTrackV10({ id: 'audio-track', clipIds: ['audio-clip'], laneGroupId: 'media-lane' }, SAMPLE_RATE),
		],
	}) as ProjectRecord;
	const before = linked.clips.find((clip) => clip.id === 'audio-clip');

	const upgraded = applyEditorCommand(
		linked,
		reprobeCommand(linked, 240),
		{ now: NOW },
	) as ProjectRecord;

	// The source rate is source metadata, never a sequence rate: the video clip
	// keeps its placement, so the audio derived from it keeps its own.
	assert.deepEqual(upgraded.clips.find((clip) => clip.id === 'audio-clip'), before);
	assert.equal(validateCurrentAudioEditorProject(upgraded), true);
});

test('the upgrade is one undo entry, and undoing it restores the old grid', () => {
	const project = unprobedProject();
	const upgraded = applyEditorCommand(
		project,
		reprobeCommand(project, 240),
		{ now: NOW },
	) as ProjectRecord;

	// The command is a pure function of the document, so the pre-command
	// document is exactly what an undo restores.
	assert.notDeepEqual(videoAuthority(upgraded), videoAuthority(project));
	assert.deepEqual(videoAuthority(project), [
		['timeline-clip', 0, 300, 0, 300],
		['bin-clip', 0, 60, 30, 60],
	]);
	assert.equal(validateCurrentAudioEditorProject(project), true);
});
