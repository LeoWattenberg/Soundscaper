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
import { createTrimMediaPlan } from '../src/common/editor/trim-media-plan.ts';
import { runTrimMedia, type TrimMediaPorts } from '../src/common/editor/trim-media-operation.ts';
import { createTrimMediaProjectEdit } from '../src/common/editor/trim-media-project-edit.ts';

const NOW = '2026-08-19T12:00:00.000Z';
const SAMPLE_RATE = 48_000;
const SEQUENCE = Object.freeze({ id: 'main', rate: Object.freeze({ num: 30, den: 1 }) });

/** One source, two references with a gap between them: 100..200 and 600..700. */
function project() {
	return createCurrentAudioEditorProject({
		id: 'trim-edit-project',
		now: NOW,
		sampleRate: SAMPLE_RATE,
		sequences: [SEQUENCE],
		primarySequenceId: SEQUENCE.id,
		sources: [createAudioSourceV10({
			kind: 'audio', id: 'src', storageKey: 'src', name: 'take.wav', mimeType: 'audio/wav',
			frameCount: 1_000, channelCount: 2, sampleRate: SAMPLE_RATE,
		})],
		clips: [
			createAudioClipV10({
				id: 'c1', sourceId: 'src', timelineStartFrame: 0, durationFrames: 100,
				sourceStartFrame: 100, sourceDurationFrames: 100,
			}),
			createAudioClipV10({
				id: 'c2', sourceId: 'src', timelineStartFrame: 200, durationFrames: 100,
				sourceStartFrame: 600, sourceDurationFrames: 100,
			}),
		],
		tracks: [createAudioTrackV10({ id: 'track', clipIds: ['c1', 'c2'] })],
		projectBin: { clips: [] },
	});
}

type ProjectRecord = ReturnType<typeof project>;

/** A writer that keeps exactly what it was asked for, unless told to widen. */
function ports(widenTo = 0): TrimMediaPorts {
	return {
		async writeTrimmedCopy(source, runs) {
			const written = widenTo > 0
				? runs.map((run) => ({
					startFrame: Math.floor(run.startFrame / widenTo) * widenTo,
					endFrame: run.endFrame,
				}))
				: runs.map((run) => ({ startFrame: run.startFrame, endFrame: run.endFrame }));
			const frameCount = written.reduce((sum, run) => sum + (run.endFrame - run.startFrame), 0);
			return { storageKey: `${source.sourceId}.trimmed`, frameCount, byteLength: frameCount * 4, runs: written };
		},
		async rebind() { return true; },
		async discardTrimmedCopy() { /* nothing is kept back */ },
	};
}

async function edit(document: ProjectRecord, widenTo = 0) {
	const plan = createTrimMediaPlan({ project: document, handleFrames: 0 });
	const run = await runTrimMedia({ plan }, ports(widenTo));
	return createTrimMediaProjectEdit({
		project: document,
		results: run.sources,
		contentSha256: { src: 'cd'.repeat(32) },
	});
}

const ranges = (document: ProjectRecord) => document.clips.map((clip) => [
	clip.id, clip.sourceStartFrame, clip.sourceDurationFrames, clip.timelineStartFrame,
]);

test('the trim becomes one batch that moves the media and the edits together', async () => {
	const before = project();
	const result = await edit(before);

	assert.equal(result.rewrittenSources, 1);
	assert.equal(result.remappedClips, 2);
	assert.equal(result.command?.type, 'batch');

	const after = applyEditorCommand(before, result.command!, { now: NOW }) as ProjectRecord;
	const source = after.sources[0] as Record<string, unknown>;
	assert.equal(source.storageKey, 'src.trimmed');
	assert.equal(source.contentSha256, 'cd'.repeat(32));
	assert.equal(source.frameCount, 200, 'only the two referenced hundreds survive');
	assert.equal(source.byteLength, 800);
	// Both clips read from the trimmed copy, in the order they always had, and
	// each still plays exactly the hundred frames it played before.
	assert.deepEqual(ranges(after), [
		['c1', 0, 100, 0],
		['c2', 100, 100, 200],
	]);
	assert.equal(validateCurrentAudioEditorProject(after), true);
});

test('a copy widened back to a keyframe is followed, not the plan that asked for less', async () => {
	// The writer here may only begin a run on a multiple of 150, so the run the
	// plan asked to start at 100 comes back starting at 0. Remapping against
	// what was asked for would put the first reference at 0 and the second at
	// 100; against what was written they sit at 100 and 200.
	const before = project();
	const result = await edit(before, 150);
	const after = applyEditorCommand(before, result.command!, { now: NOW }) as ProjectRecord;

	// Runs 0..200 and 600..700: 300 frames, and the references sit at 100 and 200.
	assert.equal((after.sources[0] as Record<string, unknown>).frameCount, 300);
	assert.deepEqual(ranges(after), [
		['c1', 100, 100, 0],
		['c2', 200, 100, 200],
	]);
	assert.equal(validateCurrentAudioEditorProject(after), true);
});

test('nothing to trim produces no command at all', async () => {
	const whole = createCurrentAudioEditorProject({
		id: 'whole', now: NOW, sampleRate: SAMPLE_RATE,
		sequences: [SEQUENCE], primarySequenceId: SEQUENCE.id,
		sources: [createAudioSourceV10({
			kind: 'audio', id: 'src', storageKey: 'src', name: 'take.wav',
			frameCount: 100, channelCount: 2, sampleRate: SAMPLE_RATE,
		})],
		clips: [createAudioClipV10({
			id: 'c1', sourceId: 'src', timelineStartFrame: 0, durationFrames: 100,
			sourceStartFrame: 0, sourceDurationFrames: 100,
		})],
		tracks: [createAudioTrackV10({ id: 'track', clipIds: ['c1'] })],
		projectBin: { clips: [] },
	});
	const result = await edit(whole);
	assert.equal(result.command, null);
	assert.equal(result.rewrittenSources, 0);
});

test('a reference the copy cannot hold contiguously leaves its source alone', async () => {
	// A copy that dropped the middle of a reference would make that clip play
	// less than it did. Sliding it to the nearest survivor would move an edit
	// without saying so, so the whole source stays bound to what it had.
	const before = project();
	const result = createTrimMediaProjectEdit({
		project: before,
		results: [{
			sourceId: 'src',
			outcome: 'trimmed',
			storageKey: 'src.trimmed',
			retainedFrames: 200,
			discardedFrames: 800,
			writtenFrames: 150,
			byteLength: 600,
			// The first reference is cut in half by the gap between these runs.
			runs: [
				{ startFrame: 100, endFrame: 150, trimmedStartFrame: 0 },
				{ startFrame: 600, endFrame: 700, trimmedStartFrame: 50 },
			],
		}],
	});

	assert.equal(result.command, null);
	assert.equal(result.rewrittenSources, 0);
	const finding = result.report.items.find((item) => item.code === 'trim.reference-unmappable');
	assert.equal(finding?.severity, 'error');
	assert.equal(finding?.scope.id, 'c1');
});

test('a source the project no longer holds is reported, not bound to', async () => {
	const result = createTrimMediaProjectEdit({
		project: project(),
		results: [{
			sourceId: 'gone', outcome: 'trimmed', storageKey: 'gone.trimmed',
			retainedFrames: 10, discardedFrames: 0, writtenFrames: 10, byteLength: 40,
			runs: [{ startFrame: 0, endFrame: 10, trimmedStartFrame: 0 }],
		}],
	});

	assert.equal(result.command, null);
	assert.equal(result.report.items.find((item) => item.code === 'trim.rewrite-source-missing')?.severity, 'error');
});

test('a video source is rewritten in pictures and told both of its lengths', async () => {
	// The plan, the cut and the remap all work in pictures. The sample-frame
	// length the document also holds is derived from the picture count, because
	// stating one and letting the other stand would leave the document holding
	// a length the trimmed file does not have.
	const source = createVideoSourceV10({
		kind: 'video', id: 'vid', storageKey: 'vid', name: 'take.mp4', mimeType: 'video/mp4',
		frameCount: SAMPLE_RATE * 10, sampleRate: SAMPLE_RATE, width: 640, height: 360,
		frameRate: SEQUENCE.rate, sourceFrameCount: 300, timingAsset: null,
		timingDecision: {
			mode: 'conform-cfr-at-ingest', rate: SEQUENCE.rate,
			reason: 'timing-probe-unavailable', failures: [],
		},
		videoCodec: 'h264', audioCodec: null, hasAudio: false,
	}, SAMPLE_RATE);
	const context = { projectSampleRate: SAMPLE_RATE, sequence: SEQUENCE, source };
	const before = createCurrentAudioEditorProject({
		id: 'trim-video-project', now: NOW, sampleRate: SAMPLE_RATE,
		sequences: [SEQUENCE], primarySequenceId: SEQUENCE.id,
		sources: [source],
		clips: [createVideoClipV10({
			id: 'v1', sourceId: 'vid', sequenceId: SEQUENCE.id,
			sequenceStartFrame: 0, sequenceFrameCount: 60, sourceInFrame: 120, sourceFrameCount: 60,
		}, context)],
		tracks: [createVideoTrackV10({ id: 'video-track', clipIds: ['v1'] })],
		projectBin: { clips: [] },
	});

	const result = await edit(before as never);
	const after = applyEditorCommand(before, result.command!, { now: NOW }) as typeof before;
	const rewritten = after.sources[0] as Record<string, unknown>;
	assert.equal(rewritten.storageKey, 'vid.trimmed');
	assert.equal(rewritten.sourceFrameCount, 60, 'sixty pictures were referenced and sixty survive');
	// Sixty pictures at 30 fps are two seconds, which is 96,000 sample frames.
	assert.equal(rewritten.sampleFrameCount, SAMPLE_RATE * 2);
	assert.deepEqual(rewritten.frameRate, SEQUENCE.rate, 'a lossless cut does not re-time the media');
	assert.equal(after.clips[0].sourceInFrame, 0);
	assert.equal(after.clips[0].sourceFrameCount, 60);
	assert.equal(validateCurrentAudioEditorProject(after), true);
});
