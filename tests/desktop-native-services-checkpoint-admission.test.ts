/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	FRAMESCAPER_NATIVE_CHECKPOINT_MAXIMUM_DURABLE_BYTES,
	admitNativeImageSequenceCheckpointEvidence,
	createFramescaperNativeFilesystemCheckpointStore,
	nativeImageSequenceCheckpointEvidenceByteLength,
	nativeImageSequenceSourceInventoryDigest,
	verifyAndStoreNativeImageSequenceCheckpoint,
	type NativeImageSequenceCheckpointEvidenceV1,
} from '../desktop/native-services-checkpoint-recovery.ts';
import {
	admitNativeImageSequenceCheckpointEvidenceV3,
	createFramescaperNativeFilesystemCheckpointStore as createFramescaperNativeFilesystemCheckpointStoreV3,
	nativeImageSequenceCheckpointEvidenceByteLength as nativeImageSequenceCheckpointEvidenceByteLengthV3,
	nativeImageSequenceSourceInventoryDigestV3,
	verifyAndStoreNativeImageSequenceCheckpointV3,
} from '../desktop/native-services-checkpoint-recovery-v3.ts';
import { framescaperNativeCheckpointLifecycleRequest } from '../desktop/native-services-lifecycle.ts';
import { createNativeMediaPlanEnvelopeV1 } from '../src/common/editor/native-media-plan-envelope.ts';
import { createNativeMediaPlanEnvelopeV2 } from '../src/common/editor/native-media-plan-envelope-v2.ts';
import {
	assertNativeQueueRecordV2,
	createNativeQueueRecordV2,
	type NativeQueueRecordV2,
} from '../src/common/editor/native-queue-record.ts';
import {
	assertNativeQueueRecordV3,
	createNativeQueueRecordV3,
	type NativeQueueRecordV3,
} from '../src/common/editor/native-queue-record-v3.ts';
import { createVideoKeyframeExportPlanV7 } from '../src/common/editor/video-keyframe-export-plan-v7.ts';
import { createFramescaperNativeRenderPlanAuthorityNativeMedia } from '../src/framescaper/editor-native-render-plan-authority.ts';
import { createFramescaperProjectUnifiedExactRenderPlanNativeMedia } from '../src/framescaper/editor-project-unified-render-plan-native-media.ts';
import { FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectNativeMedia } from '../src/framescaper/editor-project-native-media.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

const SHA_A = '12'.repeat(32);
const SHA_B = '34'.repeat(32);

test('checkpoint generations share one durable evidence and filesystem implementation', () => {
	assert.equal(
		nativeImageSequenceCheckpointEvidenceByteLengthV3,
		nativeImageSequenceCheckpointEvidenceByteLength,
	);
	assert.equal(
		createFramescaperNativeFilesystemCheckpointStoreV3,
		createFramescaperNativeFilesystemCheckpointStore,
	);
});

test('checkpoint IPC admission refuses a control envelope over 64 KiB before copying it', () => {
	const manifest = Array.from({ length: 100 }, (_, frameIndex) => ({
		frameIndex,
		relativePath: `frames/${'a'.repeat(700)}-${String(frameIndex)}.png`,
		byteLength: 1,
		sha256: SHA_B,
		planFingerprint: SHA_A,
		sourceInventoryDigest: SHA_B,
	}));
	assert.throws(() => framescaperNativeCheckpointLifecycleRequest({
		schemaFamily: 'framescaper', schemaVersion: 1,
		jobId: 'ab'.repeat(20), sourceInventoryDigest: SHA_B,
		plannedFrameCount: manifest.length, manifest,
	}), /control.*64 KiB/iu);
});

test('checkpoint admission refuses a durable representation over 64 KiB before frame I/O', async () => {
	const record = runningImageSequenceRecord();
	const sourceInventoryDigest = nativeImageSequenceSourceInventoryDigest(record);
	const plannedFrameCount = createNativeMediaPlanEnvelopeV1(
		JSON.parse(record.planPayload) as unknown,
	).summary.outputFrameCount;
	const manifest = Object.freeze(Array.from({ length: 100 }, (_, frameIndex) => frame(
		frameIndex,
		record.planFingerprint,
		sourceInventoryDigest,
		longRelativePath(frameIndex),
	)));
	let inspections = 0;
	let writes = 0;
	await assert.rejects(() => verifyAndStoreNativeImageSequenceCheckpoint(record, {
		sourceInventoryDigest,
		plannedFrameCount,
		manifest,
	}, async () => {
		inspections += 1;
		throw new Error('oversized evidence must fail before inspection');
	}, {
		read: async () => null,
		write: async () => { writes += 1; },
	}), /64 KiB.*durable/iu);
	assert.equal(inspections, 0);
	assert.equal(writes, 0);
});

test('checkpoint durable admission stores only the exactly verified contiguous prefix', async () => {
	const record = runningImageSequenceRecord();
	const sourceInventoryDigest = nativeImageSequenceSourceInventoryDigest(record);
	const plannedFrameCount = createNativeMediaPlanEnvelopeV1(
		JSON.parse(record.planPayload) as unknown,
	).summary.outputFrameCount;
	const manifest = Object.freeze([0, 1, 2].map((frameIndex) => frame(
		frameIndex,
		record.planFingerprint,
		sourceInventoryDigest,
		`frames/frame-${String(frameIndex).padStart(6, '0')}.png`,
	)));
	const admitted = admitNativeImageSequenceCheckpointEvidence(record, {
		sourceInventoryDigest,
		plannedFrameCount,
		manifest,
	});
	assert.ok(nativeImageSequenceCheckpointEvidenceByteLength(admitted)
		<= FRAMESCAPER_NATIVE_CHECKPOINT_MAXIMUM_DURABLE_BYTES);
	const stored: NativeImageSequenceCheckpointEvidenceV1[] = [];
	const inspected: number[] = [];
	const result = await verifyAndStoreNativeImageSequenceCheckpoint(record, {
		sourceInventoryDigest,
		plannedFrameCount,
		manifest,
	}, async (entry) => {
		inspected.push(entry.frameIndex);
		return entry.frameIndex === 1 ? null : Object.freeze({
			byteLength: entry.byteLength,
			sha256: entry.sha256,
			symbolicLink: false,
		});
	}, {
		read: async () => null,
		write: async (evidence) => { stored.push(evidence); },
	});
	assert.deepEqual(result, {
		verifiedFrameCount: 1,
		plannedFrameCount,
		complete: false,
	});
	assert.deepEqual(inspected, [0, 1]);
	assert.equal(stored[0]?.manifest.length, 1);
	assert.equal(stored[0]?.manifest[0]?.frameIndex, 0);
});

test('V3 checkpoint admission uses the shared durable representation for a V14 image sequence', async () => {
	const record = runningImageSequenceRecordV3();
	const sourceInventoryDigest = nativeImageSequenceSourceInventoryDigestV3(record);
	const plannedFrameCount = createNativeMediaPlanEnvelopeV2(
		JSON.parse(record.planPayload) as unknown,
	).summary.outputFrameCount;
	const manifest = Object.freeze([frame(
		0,
		record.planFingerprint,
		sourceInventoryDigest,
		'frames/frame-000000.png',
	)]);
	const admitted = admitNativeImageSequenceCheckpointEvidenceV3(record, {
		sourceInventoryDigest,
		plannedFrameCount,
		manifest,
	});
	const stored: NativeImageSequenceCheckpointEvidenceV1[] = [];
	const result = await verifyAndStoreNativeImageSequenceCheckpointV3(record, {
		sourceInventoryDigest,
		plannedFrameCount,
		manifest,
	}, async (entry) => Object.freeze({
		byteLength: entry.byteLength,
		sha256: entry.sha256,
		symbolicLink: false,
	}), {
		read: async () => null,
		write: async (evidence) => { stored.push(evidence); },
	});
	assert.equal(nativeImageSequenceCheckpointEvidenceByteLengthV3(admitted),
		nativeImageSequenceCheckpointEvidenceByteLength(admitted));
	assert.deepEqual(stored, [admitted]);
	assert.deepEqual(result, {
		verifiedFrameCount: 1,
		plannedFrameCount,
		complete: plannedFrameCount === 1,
	});
});

function runningImageSequenceRecord(): NativeQueueRecordV2 {
	const durationFrames = 80_000;
	const plan = createVideoKeyframeExportPlanV7({
		format: 'mp4',
		sampleRate: 8_000,
		range: { startFrame: 0, endFrame: durationFrames, durationFrames },
		canvas: {
			width: 2, height: 2, frameRate: { num: 30, den: 1 }, fit: 'contain',
			pixelFormat: 'yuv420p', backgroundColor: '#000000',
			referenceClipId: 'clip-1', referenceSourceId: 'source-1',
		},
		activeClipIds: ['clip-1'],
		activeSourceIds: ['source-1'],
		sources: [{
			kind: 'video', id: 'source-1', storageKey: 'source-1',
			mimeType: 'video/mp4', contentSha256: SHA_A,
		}],
		includeAudio: false,
	});
	const queued = createNativeQueueRecordV2({
		schemaFamily: 'framescaper', schemaVersion: 1,
		jobId: 'ab'.repeat(20),
		taskKind: 'image-sequence-export',
		plan,
		projectId: 'project-1',
		projectRevision: 7,
		inputFingerprints: [{ sourceId: 'source-1', sha256: SHA_A }],
		rootGrantId: 'cd'.repeat(16),
		relativeDestination: 'frames/frame.png',
		reservations: {
			cpuCores: 1,
			processTreeRssBytes: 256 * 1_024 ** 2,
			scratchBytes: 32 * 1_024 ** 2,
			minimumFreeBytes: 0,
			hardwareBackend: null,
		},
		recoveryClass: 'verified-frame-checkpoint',
		position: 0,
		createdAtMs: 1,
	});
	const running = Object.freeze({
		...queued,
		state: 'running' as const,
		progress: 0,
		attempt: 1,
		updatedAtMs: 2,
	});
	assertNativeQueueRecordV2(running);
	return running;
}

function runningImageSequenceRecordV3(): NativeQueueRecordV3 {
	const profile = FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE;
	const project = createFramescaperProjectNativeMedia(profile, framescaperV20Options());
	const delivery = Object.freeze({
		kind: 'image-sequence' as const,
		format: 'png' as const,
		frameRate: Object.freeze({ num: 30, den: 1 }),
		preserveAlpha: true as const,
	});
	const plan = createFramescaperProjectUnifiedExactRenderPlanNativeMedia(
		profile,
		project,
		createFramescaperNativeRenderPlanAuthorityNativeMedia(project, delivery),
		delivery,
	);
	const queued = createNativeQueueRecordV3({
		schemaFamily: 'framescaper', schemaVersion: 1,
		jobId: 'cd'.repeat(20),
		taskKind: 'image-sequence-export',
		plan,
		projectId: String(project.id),
		projectRevision: Number(project.revision),
		inputFingerprints: [{ sourceId: 'video-source', sha256: SHA_A }],
		rootGrantId: 'ef'.repeat(16),
		relativeDestination: 'frames',
		reservations: {
			cpuCores: 1,
			processTreeRssBytes: 256 * 1_024 ** 2,
			scratchBytes: 32 * 1_024 ** 2,
			minimumFreeBytes: 0,
			hardwareBackend: null,
		},
		recoveryClass: 'verified-frame-checkpoint',
		position: 0,
		createdAtMs: 1,
	});
	const running = Object.freeze({
		...queued,
		state: 'running' as const,
		progress: 0,
		attempt: 1,
		updatedAtMs: 2,
	});
	assertNativeQueueRecordV3(running);
	return running;
}

function frame(
	frameIndex: number,
	planFingerprint: string,
	sourceInventoryDigest: string,
	relativePath: string,
) {
	return Object.freeze({
		frameIndex,
		relativePath,
		byteLength: 100 + frameIndex,
		sha256: frameIndex % 2 === 0 ? SHA_A : SHA_B,
		planFingerprint,
		sourceInventoryDigest,
	});
}

function longRelativePath(frameIndex: number): string {
	return `${['a', 'b', 'c', 'd'].map((letter) => letter.repeat(200)).join('/')}/frame-${String(frameIndex).padStart(6, '0')}.png`;
}
