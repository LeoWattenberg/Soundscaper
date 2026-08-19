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
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';

const NOW = '2026-08-19T12:00:00.000Z';
const SAMPLE_RATE = 48_000;
const SEQUENCE = Object.freeze({ id: 'main', rate: Object.freeze({ num: 30, den: 1 }) });

/**
 * A thousand frames of media with two references in it: one on the timeline
 * from 400, one in the Project Bin from 600. Trimming to exactly those two runs
 * leaves 200 frames, and the two references land at 0 and 100.
 */
function project() {
	const source = createAudioSourceV10({
		kind: 'audio',
		id: 'src',
		storageKey: 'src',
		name: 'take.wav',
		mimeType: 'audio/wav',
		contentSha256: 'ab'.repeat(32),
		frameCount: 1_000,
		channelCount: 2,
		sampleRate: SAMPLE_RATE,
	});
	const timeline = createAudioClipV10({
		id: 'timeline-clip',
		sourceId: 'src',
		timelineStartFrame: 0,
		durationFrames: 100,
		sourceStartFrame: 400,
		sourceDurationFrames: 100,
	});
	const binned = createAudioClipV10({
		id: 'bin-clip',
		sourceId: 'src',
		timelineStartFrame: 0,
		durationFrames: 100,
		sourceStartFrame: 600,
		sourceDurationFrames: 100,
		binItemId: 'bin-clip',
	});
	return createCurrentAudioEditorProject({
		id: 'rewrite-project',
		now: NOW,
		sampleRate: SAMPLE_RATE,
		sequences: [SEQUENCE],
		primarySequenceId: SEQUENCE.id,
		sources: [source],
		clips: [timeline],
		tracks: [createAudioTrackV10({ id: 'audio-track', clipIds: ['timeline-clip'] })],
		projectBin: { clips: [binned] },
	});
}

type ProjectRecord = ReturnType<typeof project>;

function rewrite(overrides: Record<string, unknown> = {}): AudioEditorCommand {
	return {
		type: 'source/rewrite-media',
		sourceId: 'src',
		changes: {
			storageKey: 'src-trimmed',
			contentSha256: 'cd'.repeat(32),
			frameCount: 200,
		},
		clips: [
			{ clipId: 'timeline-clip', sourceStartFrame: 0 },
			{ clipId: 'bin-clip', sourceStartFrame: 100 },
		],
		...overrides,
	} as AudioEditorCommand;
}

const ranges = (document: ProjectRecord) => [...document.clips, ...document.projectBin.clips].map((clip) => [
	clip.id, clip.sourceStartFrame, clip.sourceDurationFrames, clip.timelineStartFrame, clip.durationFrames,
]);

test('one command moves the bytes and every range measured against them', () => {
	const before = project();
	const after = applyEditorCommand(before, rewrite(), { now: NOW }) as ProjectRecord;

	const source = after.sources[0] as Record<string, unknown>;
	assert.equal(source.storageKey, 'src-trimmed');
	assert.equal(source.contentSha256, 'cd'.repeat(32));
	assert.equal(source.frameCount, 200);
	// The grid the ranges are measured on is untouched, which is what makes the
	// remap arithmetic mean anything at all.
	assert.equal(source.sampleRate, SAMPLE_RATE);
	assert.equal(source.channelCount, 2);
	// Both references now read from the trimmed media, and neither plays
	// anything different: only where they read from moved.
	assert.deepEqual(ranges(after), [
		['timeline-clip', 0, 100, 0, 100],
		['bin-clip', 100, 100, 0, 100],
	]);
	assert.equal(validateCurrentAudioEditorProject(after), true);
	// The document it was applied to is untouched.
	assert.equal((before.sources[0] as Record<string, unknown>).storageKey, 'src');
	assert.deepEqual(ranges(before), [
		['timeline-clip', 400, 100, 0, 100],
		['bin-clip', 600, 100, 0, 100],
	]);
});

test('a reference the command did not remap is refused, not left pointing at moved bytes', () => {
	// This is the whole reason the command exists. Rewriting the media and
	// leaving one clip on its old index would silently change what that clip
	// plays, and it would still be a valid document, so nothing downstream
	// would ever notice.
	assert.throws(() => applyEditorCommand(project(), rewrite({
		clips: [{ clipId: 'timeline-clip', sourceStartFrame: 0 }],
	}), { now: NOW }), /bin-clip/);
	assert.throws(() => applyEditorCommand(project(), rewrite({
		clips: [{ clipId: 'bin-clip', sourceStartFrame: 100 }],
	}), { now: NOW }), /timeline-clip/);
	assert.throws(() => applyEditorCommand(project(), rewrite({ clips: [] }), { now: NOW }), /timeline-clip/);
});

test('the grid the ranges are measured on may not move', () => {
	// A trim is a lossless cut. If it re-sampled or re-timed the media, every
	// frame index in the document would mean something different and remapping
	// them by arithmetic would be a lie.
	for (const changes of [
		{ sampleRate: 44_100 },
		{ channelCount: 1 },
		{ id: 'other' },
		{ kind: 'video' },
		{ name: 'renamed.wav' },
	]) {
		assert.throws(
			() => applyEditorCommand(project(), rewrite({ changes: { ...changes, frameCount: 200 } }), { now: NOW }),
			/cannot change/,
			`a rewrite must refuse to change ${Object.keys(changes)[0]}`,
		);
	}
});

test('a rewrite may only make the media shorter', () => {
	// Growing media is not a trim; it is different content wearing the same
	// source id, and every range in the document would be unverifiable.
	assert.throws(
		() => applyEditorCommand(project(), rewrite({ changes: { storageKey: 'grown', frameCount: 1_200 } }), { now: NOW }),
		/shorter/,
	);
});

test('a rewrite cannot change what a clip plays, only where it reads from', () => {
	// The payload carries no duration, so this is structural rather than
	// checked: the only per-clip field is the in-point.
	const after = applyEditorCommand(project(), rewrite(), { now: NOW }) as ProjectRecord;
	for (const clip of [...after.clips, ...after.projectBin.clips]) {
		assert.equal(clip.sourceDurationFrames, 100);
		assert.equal(clip.durationFrames, 100);
	}
});

test('the command refuses a range the trimmed media cannot hold, and an unknown subject', () => {
	assert.throws(() => applyEditorCommand(project(), rewrite({
		clips: [
			{ clipId: 'timeline-clip', sourceStartFrame: 150 },
			{ clipId: 'bin-clip', sourceStartFrame: 100 },
		],
	}), { now: NOW }), /source bounds/);
	assert.throws(() => applyEditorCommand(project(), rewrite({ sourceId: 'missing' }), { now: NOW }), /Unknown source/);
	// A clip that does not reference this source is a typo, not an instruction:
	// honouring it would move an unrelated edit.
	assert.throws(() => applyEditorCommand(project(), rewrite({
		clips: [
			{ clipId: 'timeline-clip', sourceStartFrame: 0 },
			{ clipId: 'bin-clip', sourceStartFrame: 100 },
			{ clipId: 'no-such-clip', sourceStartFrame: 0 },
		],
	}), { now: NOW }), /no-such-clip/);
});

/** The same rewrite against video, where a length is two numbers, not one. */
function videoProject() {
	const source = createVideoSourceV10({
		kind: 'video',
		id: 'vid',
		storageKey: 'vid',
		name: 'take.mp4',
		mimeType: 'video/mp4',
		contentSha256: 'ab'.repeat(32),
		frameCount: SAMPLE_RATE * 10,
		sampleRate: SAMPLE_RATE,
		width: 640,
		height: 360,
		frameRate: SEQUENCE.rate,
		sourceFrameCount: 300,
		timingAsset: null,
		timingDecision: {
			mode: 'conform-cfr-at-ingest',
			rate: SEQUENCE.rate,
			reason: 'timing-probe-unavailable',
			failures: [],
		},
		videoCodec: 'h264',
		audioCodec: null,
		hasAudio: false,
	}, SAMPLE_RATE);
	const context = { projectSampleRate: SAMPLE_RATE, sequence: SEQUENCE, source };
	const clip = createVideoClipV10({
		id: 'video-clip',
		sourceId: 'vid',
		sequenceId: SEQUENCE.id,
		sequenceStartFrame: 0,
		sequenceFrameCount: 60,
		sourceInFrame: 120,
		sourceFrameCount: 60,
	}, context);
	return createCurrentAudioEditorProject({
		id: 'rewrite-video-project',
		now: NOW,
		sampleRate: SAMPLE_RATE,
		sequences: [SEQUENCE],
		primarySequenceId: SEQUENCE.id,
		sources: [source],
		clips: [clip],
		tracks: [createVideoTrackV10({ id: 'video-track', clipIds: ['video-clip'] })],
		projectBin: { clips: [] },
	});
}

test('a video rewrite states both of the lengths a video source has', () => {
	// Sample frames and video frames are two measurements of the same media. A
	// rewrite that moved one and left the other standing would leave the
	// document holding a length the trimmed file does not have.
	const refused = (changes: Record<string, unknown>, pattern: RegExp) => assert.throws(
		() => applyEditorCommand(videoProject(), {
			type: 'source/rewrite-media',
			sourceId: 'vid',
			changes,
			clips: [{ clipId: 'video-clip', sourceStartFrame: 0 }],
		} as AudioEditorCommand, { now: NOW }),
		pattern,
	);
	refused({ storageKey: 'vid-trimmed', sampleFrameCount: SAMPLE_RATE * 2 },
		/both the sample-frame and the video-frame count/);
	refused({ storageKey: 'vid-trimmed', sourceFrameCount: 60 },
		/both the sample-frame and the video-frame count/);
	// `frameCount` is the audio name for this, and the video normalizer prefers
	// `sampleFrameCount` over it — so accepting it would have left the source at
	// its old length with the trimmed bytes behind it.
	refused({ storageKey: 'vid-trimmed', frameCount: SAMPLE_RATE * 2 }, /states its length as sampleFrameCount/);

	const after = applyEditorCommand(videoProject(), {
		type: 'source/rewrite-media',
		sourceId: 'vid',
		changes: { storageKey: 'vid-trimmed', sampleFrameCount: SAMPLE_RATE * 2, sourceFrameCount: 60 },
		clips: [{ clipId: 'video-clip', sourceStartFrame: 0 }],
	} as AudioEditorCommand, { now: NOW }) as ProjectRecord;
	const source = after.sources[0] as Record<string, unknown>;
	assert.equal(source.storageKey, 'vid-trimmed');
	assert.equal(source.sampleFrameCount, SAMPLE_RATE * 2);
	assert.equal(source.sourceFrameCount, 60);
	assert.deepEqual(source.frameRate, SEQUENCE.rate, 'a lossless cut does not re-time the media');
	assert.equal(source.width, 640);
	// The clip reads from the start of the trimmed file and still plays the
	// same two seconds it always did.
	// A video clip's in-point is stated once, in pictures. That is the domain a
	// command sees it in — the runtime projection resolves a video clip's
	// `sourceStartFrame` straight from `sourceInFrame` — and the domain the plan
	// measures the source in, so the remap needs no conversion at all.
	const [clip] = after.clips;
	assert.equal(clip.sourceInFrame, 0);
	assert.equal(Object.hasOwn(clip, 'sourceStartFrame'), false);
	assert.equal(clip.sourceFrameCount, 60);
	assert.equal(clip.sequenceFrameCount, 60);
	assert.equal(validateCurrentAudioEditorProject(after), true);

	// And a remap the trimmed video cannot hold is refused there too, rather
	// than producing a clip that reads past the end of its own media.
	assert.throws(() => applyEditorCommand(videoProject(), {
		type: 'source/rewrite-media',
		sourceId: 'vid',
		changes: { storageKey: 'vid-trimmed', sampleFrameCount: SAMPLE_RATE * 2, sourceFrameCount: 60 },
		clips: [{ clipId: 'video-clip', sourceStartFrame: 400 }],
	} as AudioEditorCommand, { now: NOW }), /source bounds/);
});
