/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { AssistanceWorkflowFenceV1 } from
	'../src/common/editor/assistance/workflow.ts';
import { createSetVideoKeyframesCommand } from '../src/common/editor/commands/factories.ts';
import {
	resolveLocalAssistanceSelectedVideoAuthority,
} from '../src/common/editor/controller/local-assistance-selected-video.ts';
import {
	createFramescaperAssistanceReframePublication,
} from '../src/framescaper/editor-local-assistance-reframe-publication.ts';
import {
	registerVideoTimingIndex,
	unregisterVideoTimingIndex,
} from '../src/common/editor/video-source-time.ts';
import {
	createVideoTimingAssetPublication,
	validateVideoTimingAssetBytes,
} from '../src/common/editor/video-timing-asset.ts';
import {
	applyFramescaperProjectCommandAssistance,
	type FramescaperProjectCommandAssistance,
} from '../src/framescaper/editor-project-assistance-commands.ts';
import {
	createFramescaperProjectHistoryAssistance,
	executeFramescaperProjectCommandAssistance,
	type FramescaperProjectHistoryAssistance,
	undoFramescaperProjectCommandAssistance,
} from '../src/framescaper/editor-project-assistance-history.ts';
import {
	createFramescaperProjectAssistance,
	type FramescaperProjectAssistance,
} from '../src/framescaper/editor-project-assistance.ts';
import {
	FRAMESCAPER_ASSISTANCE_PROJECT_RUNTIME_PROFILE,
} from '../src/framescaper/editor-domain-runtime-profile.ts';
import {
	framescaperV20Options,
	opacityKeyframes,
} from './helpers/framescaper-model-fixture.ts';

const PROFILE = FRAMESCAPER_ASSISTANCE_PROJECT_RUNTIME_PROFILE;
const NOW = '2026-08-26T15:00:00.000Z';

function project(): FramescaperProjectAssistance {
	const options = structuredClone(framescaperV20Options());
	options.id = 'reframe-project';
	options.title = 'Reframe project';
	options.now = NOW;
	options.selection = {
		startFrame: 0, endFrame: 48_000, trackIds: ['video-track'], clipIds: ['video-clip'],
		frequencyRange: null, annotationIds: [],
	};
	const created = createFramescaperProjectAssistance(PROFILE, options as never);
	const clip = records(created.clips).find(({ id }) => id === 'video-clip')!;
	return applyFramescaperProjectCommandAssistance(PROFILE, created, createSetVideoKeyframesCommand(
		'video-clip', clip.videoKeyframes, opacityKeyframes(),
	), { now: NOW });
}

function currentAuthority(value: FramescaperProjectAssistance) {
	return resolveLocalAssistanceSelectedVideoAuthority({
		getProject: () => value,
		getSelectedClipId: () => 'video-clip',
	});
}

function fence(value: FramescaperProjectAssistance): AssistanceWorkflowFenceV1 {
	const selected = currentAuthority(value);
	return {
		fenceVersion: 1,
		schemaFamily: selected.fence.schemaFamily,
		projectId: selected.fence.projectId,
		schemaVersion: selected.fence.schemaVersion,
		revision: selected.fence.revision,
		sequenceId: selected.fence.sequenceId,
		sourceRanges: [{
			slotId: 'primary-video', mediaKind: 'video', sourceId: selected.fence.sourceId,
			sourceSha256: selected.fence.sourceSha256, sourceSampleRate: null,
			occurrenceIds: selected.fence.occurrenceIds,
			sourceStartFrame: selected.fence.sourceStartFrame,
			sourceEndFrame: selected.fence.sourceEndFrame,
			linkMembershipSha256: selected.fence.linkMembershipSha256,
			timingAuthoritySha256: selected.fence.timingAuthoritySha256,
			retimeKind: selected.timingAuthority.mapping === 'forward-retime-v2'
				? 'monotonic-forward' : 'identity',
		}],
		transcriptBodySha256: null,
		recipeSha256: '34'.repeat(32),
		settingsSha256: '56'.repeat(32),
		modelBindingsSha256: '78'.repeat(32),
	};
}

function result() {
	return timedResult(10, [
		{ sourceFrame: 0, presentationTick: '0' },
		{ sourceFrame: 5, presentationTick: '5' },
		{ sourceFrame: 9, presentationTick: '9' },
	]);
}

function timedResult(
	timescale: number,
	frames: readonly Readonly<{ sourceFrame: number; presentationTick: string }>[],
) {
	const width = 1_920;
	const height = 1_080;
	const targetAspect = { width: 9, height: 16 };
	const apertureWidth = (targetAspect.width / targetAspect.height) / (width / height);
	const firstLeft = (1 - apertureWidth) / 2;
	const secondLeft = 0.25;
	return {
		schemaVersion: 1,
		kind: 'reframe-path',
		authority: { width, height, timescale, frames },
		fallbackChain: ['subject', 'saliency', 'center'],
		path: {
			schemaVersion: 1,
			targetAspect,
			keyframes: frames.map(({ sourceFrame }, index) => keyframe(
				sourceFrame,
				index % 2 === 0 ? firstLeft : secondLeft,
				index % 2 === 0 ? 1 - apertureWidth - firstLeft : 1 - apertureWidth - secondLeft,
			)),
		},
	};
}

function keyframe(sourceFrame: number, left: number, right: number) {
	return {
		sourceFrame, authority: 'center', trackIds: [],
		crop: { left, top: 0, right, bottom: 0 },
	};
}

function harness(initial = project()) {
	let history = createFramescaperProjectHistoryAssistance(PROFILE, initial);
	let expectedFence = fence(initial);
	let commits = 0;
	const publication = createFramescaperAssistanceReframePublication({
		currentAuthority: () => ({
			selection: currentAuthority(history.present),
			fence: expectedFence,
		}),
		captureProject: () => history.present,
		assertProject: (token) => assert.strictEqual(token, history.present),
		commit: (command) => {
			commits += 1;
			history = executeFramescaperProjectCommandAssistance(
				PROFILE, history, command as FramescaperProjectCommandAssistance, { now: NOW },
			);
		},
	});
	return {
		publication,
		get history(): FramescaperProjectHistoryAssistance { return history; },
		set history(value: FramescaperProjectHistoryAssistance) { history = value; },
		get commits(): number { return commits; },
		set expectedFence(value: AssistanceWorkflowFenceV1) { expectedFence = value; },
	};
}

test('Reframe publishes one ordinary F31 batch, preserves unrelated curves, and undoes', async () => {
	const initial = project();
	const session = harness(initial);
	await session.publication.acceptReviewed({ fence: fence(initial), result: result() });

	assert.equal(session.commits, 1);
	assert.equal(session.history.undoStack.length, 1);
	const clip = records(session.history.present.clips).find(({ id }) => id === 'video-clip')!;
	const composition = clip.videoComposition as Record<string, unknown>;
	assert.deepEqual(composition.crop, result().path.keyframes[0]!.crop);
	const keyframes = clip.videoKeyframes as Readonly<{
		curves: readonly Readonly<{
			target: Readonly<{ parameterId: string }>;
			curve: Readonly<{ anchors: readonly Readonly<{
				position: Readonly<{ num: number; den: number }>; value: number;
			}>[] }>;
		}>[];
	}>;
	assert.deepEqual(keyframes.curves.map(({ target }) => target.parameterId), [
		'crop.bottom', 'crop.left', 'crop.right', 'crop.top', 'opacity',
	].sort());
	assert.deepEqual(keyframes.curves.find(({ target }) => target.parameterId === 'opacity')
		?.curve.anchors.map(({ value }) => value), [0.25, 0.75]);
	assert.deepEqual(keyframes.curves.find(({ target }) => target.parameterId === 'crop.left')
		?.curve.anchors.map(({ position }) => position), [
		{ num: 0, den: 1 }, { num: 5, den: 1 }, { num: 9, den: 1 },
	]);

	session.history = undoFramescaperProjectCommandAssistance(PROFILE, session.history, { now: NOW });
	assert.deepEqual(session.history.present.clips, initial.clips);
});

test('Reframe revalidates both aggregate and selected-video authority before commit', async () => {
	const initial = project();
	const heldFence = fence(initial);
	const session = harness(initial);
	session.expectedFence = { ...heldFence, settingsSha256: '9a'.repeat(32) };

	await assert.rejects(
		session.publication.acceptReviewed({ fence: heldFence, result: result() }),
		/stale|authority|fence/iu,
	);
	assert.equal(session.commits, 0);
});

test('Reframe refuses a foreign-family authority before publication', async () => {
	const initial = project();
	const heldFence = fence(initial);
	let commits = 0;
	const publication = createFramescaperAssistanceReframePublication({
		currentAuthority: () => ({
			selection: {
				...currentAuthority(initial),
				project: { ...initial, schemaFamily: 'soundscaper', schemaVersion: 1 } as never,
			} as never,
			fence: heldFence,
		}),
		captureProject: () => initial,
		assertProject() {},
		commit() { commits += 1; },
	});
	await assert.rejects(publication.acceptReviewed({ fence: heldFence, result: result() }),
		/family|foreign|schema|stale/iu);
	assert.equal(commits, 0);
});

test('Reframe revalidates VFR ticks and preserves exact source-frame mapping', async () => {
	const options = structuredClone(framescaperV20Options());
	options.id = 'vfr-reframe-project';
	options.now = NOW;
	options.selection = {
		startFrame: 0, endFrame: 48_000, trackIds: ['video-track'], clipIds: ['video-clip'],
		frequencyRange: null, annotationIds: [],
	};
	const ticks = [0n, 1n, 3n, 4n, 6n, 7n, 8n, 10n, 12n, 13n];
	const timing = createVideoTimingAssetPublication('12'.repeat(32), {
		timescale: 10, presentationTicks: ticks, finalFrameDurationTicks: 2n,
	});
	options.sources = records(options.sources).map((source) => source.id === 'video-source' ? {
		...source, timingAsset: timing.reference,
		timingDecision: { mode: 'exact', rate: { num: 10, den: 1 }, backend: 'fixture' },
	} : source);
	const created = createFramescaperProjectAssistance(PROFILE, options as never);
	const source = records(created.sources).find(({ id }) => id === 'video-source')!;
	registerVideoTimingIndex(source, validateVideoTimingAssetBytes(timing.reference, timing.bytes));
	try {
		const clip = records(created.clips).find(({ id }) => id === 'video-clip')!;
		const initial = applyFramescaperProjectCommandAssistance(PROFILE, created,
			createSetVideoKeyframesCommand('video-clip', clip.videoKeyframes, opacityKeyframes()),
			{ now: NOW });
		const session = harness(initial);
		await session.publication.acceptReviewed({ fence: fence(initial), result: timedResult(10, [
			{ sourceFrame: 0, presentationTick: '0' },
			{ sourceFrame: 4, presentationTick: '6' },
			{ sourceFrame: 9, presentationTick: '13' },
		]) });
		assert.deepEqual(cropPositions(session.history.present), [
			{ num: 0, den: 1 }, { num: 4, den: 1 }, { num: 9, den: 1 },
		]);
	} finally {
		unregisterVideoTimingIndex(source);
	}
});

test('Reframe maps exact monotonic forward retime boundaries into visible keyframe time', async () => {
	const options = structuredClone(framescaperV20Options());
	options.id = 'retimed-reframe-project';
	options.now = NOW;
	options.selection = {
		startFrame: 0, endFrame: 24_000, trackIds: ['video-track'], clipIds: ['video-clip'],
		frequencyRange: null, annotationIds: [],
	};
	options.clips = records(options.clips).map((clip) => clip.id === 'video-clip' ? {
		...clip, sequenceStartFrame: 3, sequenceFrameCount: 5, sourceInFrame: 0,
		sourceFrameCount: 10, retimeMap: {
			feature: 'video-retime', version: 2,
			points: [
				{ outerFrame: 0, sourceFrame: { num: 0, den: 1 } },
				{ outerFrame: 5, sourceFrame: { num: 10, den: 1 } },
			],
			segments: [{ mode: 'constant-forward' }],
		},
	} : clip);
	const created = createFramescaperProjectAssistance(PROFILE, options as never);
	const clip = records(created.clips).find(({ id }) => id === 'video-clip')!;
	const initial = applyFramescaperProjectCommandAssistance(PROFILE, created,
		createSetVideoKeyframesCommand('video-clip', clip.videoKeyframes, opacityKeyframes(5)),
		{ now: NOW });
	const session = harness(initial);
	await session.publication.acceptReviewed({ fence: fence(initial), result: timedResult(10, [
		{ sourceFrame: 0, presentationTick: '0' },
		{ sourceFrame: 4, presentationTick: '4' },
		{ sourceFrame: 8, presentationTick: '8' },
	]) });
	assert.deepEqual(cropPositions(session.history.present), [
		{ num: 0, den: 1 }, { num: 2, den: 1 }, { num: 4, den: 1 },
	]);
});

function cropPositions(value: FramescaperProjectAssistance) {
	const clip = records(value.clips).find(({ id }) => id === 'video-clip')!;
	const keyframes = clip.videoKeyframes as Readonly<{ curves: readonly Readonly<{
		target: Readonly<{ parameterId: string }>;
		curve: Readonly<{ anchors: readonly Readonly<{ position: unknown }>[] }>;
	}>[] }>;
	return keyframes.curves.find(({ target }) => target.parameterId === 'crop.left')!
		.curve.anchors.map(({ position }) => position);
}

function records(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value) ? value.map((entry) => entry as Record<string, unknown>) : [];
}
