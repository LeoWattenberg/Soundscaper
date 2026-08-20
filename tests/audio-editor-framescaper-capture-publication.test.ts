/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	FramescaperCapturePublicationCasError,
	FramescaperCapturePublicationRetryableError,
	createFramescaperCapturePublicationService,
} from '../src/common/editor/controller/framescaper-capture-publication-service.ts';
import {
	planFramescaperCapturePublication,
	type FramescaperCaptureDurableStream,
	type FramescaperFinalizedCaptureStream,
} from '../src/common/editor/controller/framescaper-capture-publication-plan.ts';
import { createFramescaperCaptureExactPresentationRange } from '../src/common/editor/controller/framescaper-capture-exact-presentation-range.ts';
import { applyFramescaperProjectCommandV18 } from '../src/framescaper/editor-project-v18-commands.ts';
import { FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v18.ts';
import { createFramescaperProjectV18 } from '../src/framescaper/editor-project-v18.ts';
import { applyFramescaperProjectCommandV19 } from '../src/framescaper/editor-project-v19-commands.ts';
import { FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v19.ts';
import { createFramescaperProjectV19 } from '../src/framescaper/editor-project-v19.ts';
import { applyFramescaperProjectCommandV20 } from '../src/framescaper/editor-project-v20-commands.ts';
import { FRAMESCAPER_V20_PROJECT_MODEL_PROFILE } from '../src/framescaper/editor-project-v20-profile.ts';
import { createFramescaperProjectV20 } from '../src/framescaper/editor-project-v20.ts';

const SHA = 'a'.repeat(64);
const FENCE = Object.freeze({
	projectId: 'project-a', baseRevision: 7, baseSha256: 'b'.repeat(64),
});

test('capture publication defaults to separate bin items plus one ordered lane per stream', () => {
	const plan = planFramescaperCapturePublication(planRequest([
		videoStream('camera', 0, 48_000),
		audioStream('microphone', 0, 48_000),
		videoStream('display', 1_600, 46_400),
		audioStream('system-audio', 1_600, 46_400),
	]));

	assert.equal(plan.destination, 'both');
	assert.deepEqual(plan.entries.map(({ role }) => role), [
		'camera', 'microphone', 'display', 'system-audio',
	]);
	assert.deepEqual(plan.command.commands.map(({ type }) => type), [
		'source/add', 'source/add', 'source/add', 'source/add',
		'project-bin/add', 'project-bin/add', 'project-bin/add', 'project-bin/add',
		'track/add', 'track/add', 'track/add', 'track/add',
		'clip/add', 'clip/add', 'clip/add', 'clip/add',
		'clip/link-av', 'clip/link-av',
	]);
	const [camera, microphone, display, systemAudio] = plan.entries;
	assert.ok(camera?.avLinkId);
	assert.equal(camera.avLinkId, microphone?.avLinkId);
	assert.equal(camera.laneGroupId, microphone?.laneGroupId);
	assert.ok(display?.avLinkId);
	assert.equal(display.avLinkId, systemAudio?.avLinkId);
	assert.equal(display.laneGroupId, systemAudio?.laneGroupId);
	assert.notEqual(camera?.laneGroupId, display?.laneGroupId);
	assert.ok(Number(camera?.trackIndex) < Number(display?.trackIndex), 'camera is above display');
	assert.equal(new Set(plan.entries.map(({ binItemId }) => binItemId)).size, 4);
	assert.ok(plan.entries.every(({ groupId }) => groupId === 'capture-session'));

	const sourceCommands = plan.command.commands.filter((command) => command.type === 'source/add');
	for (const command of sourceCommands) {
		const extension = command.source.opaqueExtensions as {
			readonly framescaperCaptureV1: Readonly<Record<string, unknown>>;
		};
		assert.equal(extension.framescaperCaptureV1.sessionId, 'capture-session');
		assert.equal(extension.framescaperCaptureV1.manifestSha256, SHA);
	}
});

test('validated assets can persist recovery admission before the atomic commit', async () => {
	const harness = serviceHarness({ prepareCommit: true });
	await harness.service.publish(request([
		finalized('camera', 0, 48_000), finalized('microphone', 0, 48_000),
	]));
	assert.deepEqual(harness.calls.slice(0, 6), [
		'assert:7', 'publish:camera', 'publish:microphone', 'prepare:9', 'assert:7', 'commit:9',
	]);

	const failed = serviceHarness({ failPrepareCommit: true });
	await assert.rejects(failed.service.publish(request([
		finalized('camera', 0, 48_000), finalized('microphone', 0, 48_000),
	])), /recovery admission failed/iu);
	assert.deepEqual(failed.rollbacks, ['microphone', 'camera']);
	assert.equal(failed.commits.length, 0);
});

test('camera plus display plus microphone links only the exact camera pair', () => {
	const plan = planFramescaperCapturePublication(planRequest([
		videoStream('camera', 0, 48_000),
		videoStream('display', 0, 48_000),
		audioStream('microphone', 0, 48_000),
	], 'timeline'));
	const camera = entry(plan, 'camera');
	const microphone = entry(plan, 'microphone');
	const display = entry(plan, 'display');
	assert.equal(camera.avLinkId, microphone.avLinkId);
	assert.ok(camera.avLinkId);
	assert.equal(display.avLinkId, null);
	assert.equal(display.laneGroupId, null);
	assert.equal(display.binItemId, null);
	assert.equal(plan.command.commands.some(({ type }) => type === 'project-bin/add'), false);
});

test('a non-equal resolved range never manufactures an A/V link', () => {
	const plan = planFramescaperCapturePublication(planRequest([
		videoStream('camera', 0, 48_000),
		audioStream('microphone', 1, 47_999),
	], 'timeline'));
	assert.ok(plan.entries.every(({ avLinkId, laneGroupId }) => avLinkId === null && laneGroupId === null));
});

test('equal media geometry never links unequal retained presentation ranges', () => {
	const camera = videoStream('camera', 0, 48_000);
	const microphone = audioStream('microphone', 0, 48_000);
	const plan = planFramescaperCapturePublication(planRequest([
		{ ...camera, presentationEndOffsetFrames: 48_000 },
		{ ...microphone, presentationEndOffsetFrames: 48_001 },
	], 'timeline'));
	assert.ok(plan.entries.every(({ avLinkId, laneGroupId }) => avLinkId === null && laneGroupId === null));
});

test('sample-quantized or absent exact ranges never manufacture an A/V link', () => {
	const camera = videoStream('camera', 0, 48_000);
	const microphone = audioStream('microphone', 0, 48_000);
	for (const streams of [
		[camera, {
			...microphone,
			exactPresentationRange: createFramescaperCaptureExactPresentationRange(1, 48_001),
		}],
		[{ ...camera, exactPresentationRange: null }, { ...microphone, exactPresentationRange: null }],
	]) {
		const plan = planFramescaperCapturePublication(planRequest(streams, 'timeline'));
		assert.ok(plan.entries.every(({ avLinkId, laneGroupId }) => avLinkId === null && laneGroupId === null));
	}
});

test('project-bin-only publication creates no timeline tracks or links', () => {
	const plan = planFramescaperCapturePublication(planRequest([
		videoStream('camera', 0, 48_000),
		audioStream('microphone', 0, 48_000),
	], 'project-bin'));
	assert.deepEqual(plan.command.commands.map(({ type }) => type), [
		'source/add', 'source/add', 'project-bin/add', 'project-bin/add',
	]);
	assert.ok(plan.entries.every(({ trackId, timelineClipId, avLinkId }) => (
		trackId === null && timelineClipId === null && avLinkId === null
	)));
});

test('the planned batch lands as one valid current Framescaper document revision', () => {
	const project = createFramescaperProjectV20(FRAMESCAPER_V20_PROJECT_MODEL_PROFILE, {
		id: 'project-a', title: 'Capture', now: '2026-08-20T10:00:00.000Z', sampleRate: 48_000,
		sequences: [{ id: 'main-sequence', rate: { num: 30, den: 1 } }],
		primarySequenceId: 'main-sequence',
	});
	const plan = planFramescaperCapturePublication({
		...planRequest([
			videoStream('camera', 0, 48_000),
			audioStream('microphone', 0, 48_000),
		]),
		trackInsertionIndex: 0,
	});
	const updated = applyFramescaperProjectCommandV20(
		FRAMESCAPER_V20_PROJECT_MODEL_PROFILE,
		project,
		plan.command,
		{ now: '2026-08-20T10:01:00.000Z' },
	);
	assert.equal(updated.revision, project.revision + 1);
	assert.equal(updated.sources.length, 2);
	assert.equal(updated.tracks.length, 2);
	assert.equal(updated.clips.length, 2);
	assert.equal(updated.projectBin.clips.length, 2);
	assert.equal(updated.schemaVersion, 20, 'capture does not bump the project schema');
});

test('the same atomic capture batch lands on the live web V19 project without a schema bump', () => {
	const project = createFramescaperProjectV19(FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE, projectOptions());
	const plan = planFramescaperCapturePublication({
		...planRequest([
			videoStream('camera', 0, 48_000),
			audioStream('microphone', 0, 48_000),
		]),
		trackInsertionIndex: 0,
	});
	const updated = applyFramescaperProjectCommandV19(
		FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
		project,
		plan.command,
		{ now: '2026-08-20T10:01:00.000Z' },
	);

	assertAtomicCaptureProject(updated, project.revision, 19);
});

test('the same atomic capture batch lands on the desktop V18 project without a schema bump', () => {
	const project = createFramescaperProjectV18(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE, projectOptions());
	const plan = planFramescaperCapturePublication({
		...planRequest([
			videoStream('camera', 0, 48_000),
			audioStream('microphone', 0, 48_000),
		]),
		trackInsertionIndex: 0,
	});
	const updated = applyFramescaperProjectCommandV18(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		project,
		plan.command,
		{ now: '2026-08-20T10:01:00.000Z' },
	);

	assertAtomicCaptureProject(updated, project.revision, 18);
});

test('planner rejects duplicated roles and dishonest source kinds before commit', () => {
	assert.throws(() => planFramescaperCapturePublication(planRequest([
		videoStream('camera', 0, 48_000),
		{ ...videoStream('display', 0, 48_000), role: 'camera' },
	])), /role.*unique/iu);
	assert.throws(() => planFramescaperCapturePublication(planRequest([
		{ ...videoStream('camera', 0, 48_000), source: audioSource('camera-source') },
	])), /camera.*video/iu);
});

test('publication service durably publishes every asset before one atomic batch', async () => {
	const harness = serviceHarness();
	const result = await harness.service.publish(request([
		finalized('camera', 0, 48_000),
		finalized('microphone', 0, 48_000),
	]));
	assert.equal(result.plan.destination, 'both');
	assert.deepEqual(harness.calls.slice(0, 4), [
		'assert:7', 'publish:camera', 'publish:microphone', 'assert:7',
	]);
	assert.equal(harness.calls[4], 'commit:9');
	assert.equal(harness.commits.length, 1);
	assert.equal(harness.rollbacks.length, 0);
});

test('asset and precommit fence failures roll back all owned durable assets', async () => {
	const assetFailure = serviceHarness({ failPublicationRole: 'microphone' });
	await assert.rejects(assetFailure.service.publish(request([
		finalized('camera', 0, 48_000), finalized('microphone', 0, 48_000),
	])), /asset failed/iu);
	assert.deepEqual(assetFailure.rollbacks, ['camera']);
	assert.equal(assetFailure.commits.length, 0);

	const fenceFailure = serviceHarness({ failFenceCall: 2 });
	await assert.rejects(fenceFailure.service.publish(request([
		finalized('camera', 0, 48_000), finalized('microphone', 0, 48_000),
	])), /project fence changed/iu);
	assert.deepEqual(fenceFailure.rollbacks, ['microphone', 'camera']);
	assert.equal(fenceFailure.commits.length, 0);
});

test('an atomic CAS mismatch rolls assets back and reports a closed failure', async () => {
	const harness = serviceHarness({ commitStatus: 'cas-mismatch' });
	await assert.rejects(
		harness.service.publish(request([finalized('camera', 0, 48_000)])),
		FramescaperCapturePublicationCasError,
	);
	assert.deepEqual(harness.rollbacks, ['camera']);
	assert.deepEqual(harness.retryable, []);
});

test('an indeterminate commit failure retains assets and records retryable recovery', async () => {
	const harness = serviceHarness({ throwCommit: true });
	await assert.rejects(
		harness.service.publish(request([finalized('camera', 0, 48_000)])),
		FramescaperCapturePublicationRetryableError,
	);
	assert.deepEqual(harness.rollbacks, []);
	assert.deepEqual(harness.retryable, [{ sessionId: 'capture-session', sourceIds: ['camera-source'] }]);
});

function planRequest(
	streams: readonly FramescaperCaptureDurableStream[],
	destination?: 'project-bin' | 'timeline' | 'both',
) {
	let id = 0;
	return {
		sessionId: 'capture-session',
		manifestSha256: SHA,
		recoveryProvenance: 'live' as const,
		destination,
		recordStartFrame: 9_600,
		projectSampleRate: 48_000,
		sequence: { id: 'main-sequence', rate: { num: 30, den: 1 } },
		trackInsertionIndex: 3,
		streams,
		createId: (prefix: string) => `${prefix}-${++id}`,
	};
}

function projectOptions() {
	return {
		id: 'project-a', title: 'Capture', now: '2026-08-20T10:00:00.000Z', sampleRate: 48_000,
		sequences: [{ id: 'main-sequence', rate: { num: 30, den: 1 } }],
		primarySequenceId: 'main-sequence',
	};
}

function assertAtomicCaptureProject(
	projectValue: unknown,
	baseRevision: number,
	schemaVersion: number,
): void {
	const project = projectValue as Readonly<{
		readonly schemaVersion: number;
		readonly revision: number;
		readonly sources: readonly unknown[];
		readonly tracks: readonly unknown[];
		readonly clips: readonly unknown[];
		readonly projectBin: Readonly<{ readonly clips: readonly unknown[] }>;
	}>;
	assert.equal(project.revision, baseRevision + 1);
	assert.equal(project.sources.length, 2);
	assert.equal(project.tracks.length, 2);
	assert.equal(project.clips.length, 2);
	assert.equal(project.projectBin.clips.length, 2);
	assert.equal(project.schemaVersion, schemaVersion);
}

function request(streams: readonly FramescaperFinalizedCaptureStream[]) {
	let id = 0;
	return {
		projectFence: FENCE,
		sessionId: 'capture-session', manifestSha256: SHA,
		recoveryProvenance: 'live' as const,
		recordStartFrame: 9_600, projectSampleRate: 48_000,
		sequence: { id: 'main-sequence', rate: { num: 30, den: 1 } },
		trackInsertionIndex: 3, streams,
		createId: (prefix: string) => `${prefix}-${++id}`,
	};
}

function finalized(
	role: FramescaperFinalizedCaptureStream['role'],
	startOffsetFrames: number,
	timelineDurationFrames: number,
): FramescaperFinalizedCaptureStream {
	return {
		streamId: `${role}-stream`, role, startOffsetFrames,
		presentationEndOffsetFrames: startOffsetFrames + timelineDurationFrames,
		exactPresentationRange: createFramescaperCaptureExactPresentationRange(
			startOffsetFrames,
			startOffsetFrames + timelineDurationFrames,
		),
		timelineDurationFrames,
		metrics: metrics(), terminationReason: null,
	};
}

function videoStream(
	role: 'camera' | 'display',
	startOffsetFrames: number,
	timelineDurationFrames: number,
): FramescaperCaptureDurableStream {
	return {
		...finalized(role, startOffsetFrames, timelineDurationFrames),
		source: videoSource(`${role}-source`),
	};
}

function audioStream(
	role: 'microphone' | 'system-audio',
	startOffsetFrames: number,
	timelineDurationFrames: number,
): FramescaperCaptureDurableStream {
	return {
		...finalized(role, startOffsetFrames, timelineDurationFrames),
		source: audioSource(`${role}-source`),
	};
}

function videoSource(id: string): Readonly<Record<string, unknown>> {
	return {
		kind: 'video', id, storageKey: id, name: id, mimeType: 'video/webm',
		sampleRate: 48_000, sampleFrameCount: 48_000,
		width: 1_920, height: 1_080, frameRate: { num: 30, den: 1 }, sourceFrameCount: 30,
		contentSha256: SHA, timingAsset: null,
		timingDecision: { mode: 'conform-cfr-at-ingest', rate: { num: 30, den: 1 } },
		videoCodec: 'vp9', audioCodec: null, hasAudio: false,
		posterStorageKey: null, thumbnailStorageKey: null,
		opaqueExtensions: {},
	};
}

function audioSource(id: string): Readonly<Record<string, unknown>> {
	return {
		kind: 'audio', id, storageKey: id, name: id, mimeType: 'audio/x-soundscaper-pcm',
		sampleRate: 48_000, originalSampleRate: 48_000, frameCount: 48_000,
		channelCount: 2, sampleFormat: 'float32', chunkFrames: 65_536,
		opaqueExtensions: {},
	};
}

function metrics() {
	return {
		confidence: 'exact' as const,
		droppedUnits: 0,
		maximumAbsoluteDriftMicroseconds: 10,
		finalDriftMicroseconds: -4,
	};
}

function entry(
	plan: ReturnType<typeof planFramescaperCapturePublication>,
	role: FramescaperCaptureDurableStream['role'],
) {
	const result = plan.entries.find((candidate) => candidate.role === role);
	assert.ok(result);
	return result;
}

function serviceHarness(options: Readonly<{
	failPublicationRole?: FramescaperFinalizedCaptureStream['role'];
	failFenceCall?: number;
	commitStatus?: 'committed' | 'cas-mismatch';
	throwCommit?: boolean;
	prepareCommit?: boolean;
	failPrepareCommit?: boolean;
}> = {}) {
	const calls: string[] = [];
	const commits: unknown[] = [];
	const rollbacks: string[] = [];
	const retryable: Array<{ sessionId: string; sourceIds: string[] }> = [];
	let fenceCalls = 0;
	const service = createFramescaperCapturePublicationService({
		assertProjectFence: async (fence) => {
			fenceCalls += 1;
			calls.push(`assert:${String(fence.baseRevision)}`);
			if (fenceCalls === options.failFenceCall) throw new Error('project fence changed');
		},
		publishAsset: async (stream) => {
			calls.push(`publish:${stream.role}`);
			if (stream.role === options.failPublicationRole) throw new Error('asset failed');
			return {
				source: stream.role === 'camera' || stream.role === 'display'
					? videoSource(`${stream.role}-source`)
					: audioSource(`${stream.role}-source`),
				discardIfCurrent: async () => { rollbacks.push(stream.role); return true; },
			};
		},
		...(options.prepareCommit || options.failPrepareCommit ? {
			prepareCommit: async (plan) => {
				calls.push(`prepare:${String(plan.command.commands.length)}`);
				if (options.failPrepareCommit) throw new Error('recovery admission failed');
			},
		} : {}),
		commitAtomic: async (command) => {
			calls.push(`commit:${String(command.commands.length)}`);
			commits.push(command);
			if (options.throwCommit) throw new Error('commit transport failed');
			return { status: options.commitStatus ?? 'committed', value: 'revision-8' };
		},
		recordRetryableRecovery: async ({ sessionId, sourceIds }) => {
			retryable.push({ sessionId, sourceIds: [...sourceIds] });
		},
	});
	return { calls, commits, retryable, rollbacks, service };
}
