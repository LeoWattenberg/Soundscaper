/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperCapturePublicationService,
	FramescaperCapturePublicationRetryableError,
	type FramescaperCaptureAssetPublicationMode,
	type FramescaperCapturePublicationRequest,
	type FramescaperCaptureRetryableRecoveryRecord,
	type FramescaperOwnedCaptureAssetPublication,
} from '../src/common/editor/controller/capture/internal/framescaper-capture-publication-service.ts';

const CAMERA_SOURCE = Object.freeze({
	kind: 'video', id: 'camera-source', storageKey: 'camera-storage',
	name: 'Camera', mimeType: 'video/webm', sampleRate: 48_000,
	sampleFrameCount: 48_000, sourceFrameCount: 30, width: 640, height: 480,
	opaqueExtensions: {},
});
const MICROPHONE_SOURCE = Object.freeze({
	kind: 'audio', id: 'microphone-source', storageKey: 'microphone-storage',
	name: 'Microphone', mimeType: 'audio/wav', sampleFormat: 'float32',
	sampleRate: 48_000, frameCount: 48_000, channelCount: 1,
	opaqueExtensions: {},
});
const SOURCES: ReadonlyMap<string, Readonly<Record<string, unknown>>> = new Map<
	string, Readonly<Record<string, unknown>>
>([
	['camera-stream', CAMERA_SOURCE],
	['microphone-stream', MICROPHONE_SOURCE],
]);
const REQUEST = Object.freeze({
	sessionId: 'capture-session',
	manifestSha256: 'ab'.repeat(32),
	recoveryProvenance: 'live',
	projectFence: {
		schemaFamily: 'framescaper', schemaVersion: 1,
		projectId: 'project-a', baseRevision: 4, baseSha256: 'cd'.repeat(32),
	},
	destination: 'timeline',
	recordStartFrame: 0,
	projectSampleRate: 48_000,
	sequence: { id: 'main-sequence', rate: { num: 30, den: 1 } },
	trackInsertionIndex: 0,
	streams: [{
		streamId: 'camera-stream', role: 'camera',
		startOffsetFrames: 0, presentationEndOffsetFrames: 48_000,
		timelineDurationFrames: 48_000,
		metrics: {
			confidence: 'exact', droppedUnits: 0,
			maximumAbsoluteDriftMicroseconds: 0, finalDriftMicroseconds: 0,
		},
		terminationReason: null,
	}, {
		streamId: 'microphone-stream', role: 'microphone',
		startOffsetFrames: 0, presentationEndOffsetFrames: 48_000,
		timelineDurationFrames: 48_000,
		metrics: {
			confidence: 'exact', droppedUnits: 0,
			maximumAbsoluteDriftMicroseconds: 0, finalDriftMicroseconds: 0,
		},
		terminationReason: null,
	}],
	createId: (prefix: string) => prefix,
} as const) satisfies FramescaperCapturePublicationRequest;

test('a failed second stream rolls back the first owned asset before project commit', async () => {
	const failure = new Error('microphone source write failed');
	const assets = new Map<string, FramescaperOwnedCaptureAssetPublication>();
	const events: string[] = [];
	const service = createFramescaperCapturePublicationService({
		assertProjectFence(_fence, context) {
			events.push(`fence:${context.phase}`);
		},
		publishAsset(stream) {
			events.push(`publish:${stream.streamId}`);
			if (stream.streamId === 'microphone-stream') throw failure;
			const publication = ownedAsset(stream.streamId, assets, events);
			assets.set(stream.streamId, publication);
			return publication;
		},
		commitAtomic() {
			assert.fail('a partially published capture must not commit the project');
		},
		recordRetryableRecovery() {
			assert.fail('asset publication failure has a determinate rollback');
		},
	});

	await assert.rejects(service.publish(REQUEST), (error: unknown) => error === failure);
	assert.deepEqual([...assets.keys()], []);
	assert.deepEqual(events, [
		'fence:before-assets', 'publish:camera-stream',
		'publish:microphone-stream', 'discard:camera-stream',
	]);
});

for (const commitLanded of [false, true]) {
	test(`an uncertain ${commitLanded ? 'landed' : 'unlanded'} project commit recovers without losing capture media`, async () => {
		const acknowledgementFailure = new Error('project commit acknowledgement lost');
		const assets = new Map<string, FramescaperOwnedCaptureAssetPublication>();
		const modes: FramescaperCaptureAssetPublicationMode[] = [];
		const events: string[] = [];
		const recoveryRecords: FramescaperCaptureRetryableRecoveryRecord[] = [];
		let durableProjectRevision = 4;
		let projectWrites = 0;
		let assetWrites = 0;
		let commitAttempts = 0;
		let committedCommand: unknown = null;
		const service = createFramescaperCapturePublicationService({
			assertProjectFence(_fence, context) {
				if (context.phase === 'before-commit' && committedCommand) {
					assert.deepEqual(context.command, committedCommand,
						'a retry must address the same exact project target');
				}
				return { status: durableProjectRevision === 4 ? 'base-current' : 'reconcile-only' };
			},
			publishAsset(stream, { publicationMode }) {
				modes.push(publicationMode);
				const existing = assets.get(stream.streamId);
				if (existing) return Object.freeze({
					...existing,
					discardIfCurrent: () => false,
				});
				assert.equal(publicationMode, 'publish',
					'reconciliation must not create a missing capture asset');
				assetWrites += 1;
				const publication = ownedAsset(stream.streamId, assets, events);
				assets.set(stream.streamId, publication);
				return publication;
			},
			commitAtomic(command) {
				commitAttempts += 1;
				if (commitAttempts === 1) {
					committedCommand = command;
					if (commitLanded) {
						durableProjectRevision = 5;
						projectWrites += 1;
					}
					throw acknowledgementFailure;
				}
				assert.deepEqual(command, committedCommand);
				if (durableProjectRevision === 4) {
					durableProjectRevision = 5;
					projectWrites += 1;
				}
				return { status: 'committed', value: durableProjectRevision };
			},
			recordRetryableRecovery(record) {
				recoveryRecords.push(record);
			},
		});

		await assert.rejects(service.publish(REQUEST), (error: unknown) => {
			assert.ok(error instanceof FramescaperCapturePublicationRetryableError);
			assert.equal(error.cause, acknowledgementFailure);
			return true;
		});
		assert.deepEqual([...assets.keys()], ['camera-stream', 'microphone-stream']);
		assert.deepEqual(recoveryRecords, [{
			sessionId: REQUEST.sessionId,
			projectFence: REQUEST.projectFence,
			sourceIds: ['camera-source', 'microphone-source'],
			reason: 'commit-failed',
			error: acknowledgementFailure,
		}]);
		assert.deepEqual(events, [], 'uncertain project outcomes retain all owned assets');

		const recovered = await service.publish(REQUEST);
		assert.equal(recovered.commitValue, 5);
		assert.equal(durableProjectRevision, 5);
		assert.equal(projectWrites, 1, 'recovery commits at most one project revision');
		assert.equal(assetWrites, 2, 'recovery reuses both durable capture assets');
		assert.equal(commitAttempts, 2);
		assert.equal(recoveryRecords.length, 1);
		assert.deepEqual(modes, [
			'publish', 'publish',
			commitLanded ? 'reconcile-only' : 'publish',
			commitLanded ? 'reconcile-only' : 'publish',
		]);
		assert.deepEqual([...assets.keys()], ['camera-stream', 'microphone-stream']);
		assert.deepEqual(events, []);
	});
}

function ownedAsset(
	streamId: string,
	assets: Map<string, FramescaperOwnedCaptureAssetPublication>,
	events: string[],
): FramescaperOwnedCaptureAssetPublication {
	const source = SOURCES.get(streamId);
	assert.ok(source);
	return Object.freeze({
		source,
		timelineDurationFrames: 48_000,
		discardIfCurrent() {
			events.push(`discard:${streamId}`);
			return assets.delete(streamId);
		},
	});
}
