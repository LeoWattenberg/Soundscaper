/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	captureCreationInventory,
} from '../../src/common/editor/controller/framescaper-capture-durable-creation.ts';
import {
	createFramescaperCaptureDurableSessionCoordinator,
	type CreateFramescaperCaptureDurableSessionRequest,
} from '../../src/common/editor/controller/framescaper-capture-durable-session.ts';
import type { FramescaperCaptureSessionManifestV1 } from '../../src/common/editor/framescaper-capture-session-manifest.ts';
import { EncodedCaptureSpoolRepository } from '../../src/common/editor/storage/encoded-capture-spool-repository.ts';
import { FramescaperCaptureSessionManifestRepository } from '../../src/common/editor/storage/framescaper-capture-session-manifest-repository.ts';
import { KeyValueRepository } from '../../src/common/editor/storage/key-value-repository.ts';
import { MediaAssetChunkRecords } from '../../src/common/editor/storage/media-asset-chunk-records.ts';
import { getMemoryDatabase } from '../../src/common/editor/storage/memory-backend.ts';
import { RawPcmSpoolRepository } from '../../src/common/editor/storage/raw-pcm-spool-repository.ts';
import { SourceRecordRepository } from '../../src/common/editor/storage/source-record-repository.ts';

export function sessionRequest(): CreateFramescaperCaptureDurableSessionRequest {
	return {
		sessionId: 'session-capture', generation: 1,
		projectFence: { projectId: 'project-capture', baseRevision: 3, baseSha256: 'ab'.repeat(32) },
		origin: { sequenceId: 'sequence-capture', playheadMicroseconds: 2_000_000, destination: 'both' },
		monotonicOriginMicroseconds: 1_000,
		streams: [{
			kind: 'encoded-media', role: 'camera', required: true,
			streamId: 'camera-stream', spoolId: 'camera-spool',
			sourceId: 'camera-source', mimeType: 'video/webm',
		}, {
			kind: 'raw-pcm', role: 'microphone', required: true,
			streamId: 'microphone-stream', spoolId: 'microphone-spool',
			sourceId: 'microphone-source', sampleRate: 48_000,
			channelCount: 2, chunkFrames: 1_024,
		}],
	};
}

export function rawOnlySessionRequest(): CreateFramescaperCaptureDurableSessionRequest {
	const request = sessionRequest();
	return { ...request, streams: [request.streams[1]!] };
}

export function encodedOnlySessionRequest(): CreateFramescaperCaptureDurableSessionRequest {
	const request = sessionRequest();
	return { ...request, streams: [request.streams[0]!] };
}

export function rawOwner() {
	return {
		version: 1, kind: 'framescaper-capture-raw-pcm', sessionId: 'session-capture',
		streamId: 'microphone-stream', sourceId: 'microphone-source', role: 'microphone',
	};
}

export function rawPacket() {
	return {
		kind: 'pcm-audio' as const,
		sessionId: 'session-capture', streamId: 'microphone-stream', role: 'microphone' as const,
		sequence: 0, presentationTimeUs: 0, durationUs: 42, receiptTimeMs: 1,
		droppedBefore: { value: 0, confidence: 'exact' as const },
		frameCount: 2, sampleRate: 48_000, channelCount: 2,
		samples: Float32Array.of(1, 10, 2, 20),
	};
}

export function encodedPacket() {
	const bytes = Uint8Array.of(1, 2, 3);
	return {
		kind: 'encoded-video' as const,
		sessionId: 'session-capture', streamId: 'camera-stream', role: 'camera' as const,
		sequence: 0, presentationTimeUs: 0, durationUs: 1_000, receiptTimeMs: 1,
		droppedBefore: { value: null, confidence: 'unavailable' as const },
		mimeType: 'video/webm', keyFrame: null, bytes, byteLength: bytes.byteLength,
	};
}

export function initialManifest(creation: ReturnType<typeof captureCreationInventory>) {
	return {
		version: 1, sessionId: creation.sessionId, generation: creation.generation,
		state: 'capturing', recoveryDecision: null,
		projectFence: creation.projectFence, origin: creation.origin,
		clock: { monotonicOriginMicroseconds: creation.monotonicOriginMicroseconds, pauseSpans: [] },
		streams: creation.streams.map((stream) => ({
			streamId: stream.streamId, role: stream.role, required: stream.required,
			playability: 'unknown',
			timing: { firstPresentationMicroseconds: null, lastPresentationEndMicroseconds: null },
			storage: stream.kind === 'encoded-media' ? {
				kind: stream.kind, spoolId: stream.spoolId, spoolToken: stream.spoolToken,
				sourceId: stream.sourceId, mimeType: stream.mimeType,
				packetCount: 0, chunkCount: 0, byteLength: 0,
			} : {
				kind: stream.kind, spoolId: stream.spoolId, spoolToken: stream.spoolToken,
				sourceId: stream.sourceId, sampleRate: stream.sampleRate,
				channelCount: stream.channelCount, frameCount: 0, chunkCount: 0,
			},
		})),
		createdAt: creation.createdAt, updatedAt: creation.createdAt,
	};
}

export function capacityCreation(projectId: string, sessionId: string, index: number) {
	const request = rawOnlySessionRequest();
	return captureCreationInventory({
		...request, sessionId, projectFence: { ...request.projectFence, projectId },
		streams: request.streams.map((stream) => ({
			...stream,
			spoolId: `capacity-spool-${String(index)}`,
			sourceId: `capacity-source-${String(index)}`,
		})),
	}, 100, () => `capacity-token-${String(index)}`);
}

export function creationJournalKey(projectId: string, sessionId: string): string {
	return `framescaper-capture-session-creation-v1:${encodeURIComponent(projectId)}:${encodeURIComponent(sessionId)}`;
}

export function globalRawReservationCount(value: unknown): number {
	if (value === undefined || value === null) return 0;
	if (!value || typeof value !== 'object' || !Array.isArray((value as { entries?: unknown }).entries)) {
		throw new TypeError('Expected a raw PCM global reservation inventory.');
	}
	return (value as { entries: unknown[] }).entries.length;
}

export function restartedCoordinator(fixture: ReturnType<typeof createFixture>) {
	return createFramescaperCaptureDurableSessionCoordinator({
		encodedSpools: fixture.encodedSpools, rawPcmSpools: fixture.rawPcmSpools,
		manifests: fixture.manifests, now: () => 200,
	});
}

export function rawFaultValues(
	fixture: ReturnType<typeof createFixture>,
	options: Readonly<{
		refuseRegistryCreation?: boolean;
		refuseGlobalRelease: () => boolean;
		onRegistryDelete?: () => void;
	}>,
) {
	const values = fixture.values;
	return {
		get: values.get.bind(values), putIfAbsent: values.putIfAbsent.bind(values),
		listByPrefix: values.listByPrefix.bind(values),
		async putIfAbsentWhenCurrent(
			...args: Parameters<KeyValueRepository['putIfAbsentWhenCurrent']>
		) {
			if (options.refuseRegistryCreation && args[2].startsWith('raw-pcm-spool-registry-v1:')) {
				return false;
			}
			return values.putIfAbsentWhenCurrent(...args);
		},
		replaceIfCurrentWhenCurrent: values.replaceIfCurrentWhenCurrent.bind(values),
		async replaceIfCurrent(...args: Parameters<KeyValueRepository['replaceIfCurrent']>) {
			if (args[0] === 'raw-pcm-spool-global-inventory-v1' && options.refuseGlobalRelease()) {
				throw new Error('raw PCM global release interrupted');
			}
			return values.replaceIfCurrent(...args);
		},
		async deleteIfCurrent(...args: Parameters<KeyValueRepository['deleteIfCurrent']>) {
			const deleted = await values.deleteIfCurrent(...args);
			if (deleted && args[0].startsWith('raw-pcm-spool-registry-v1:')) options.onRegistryDelete?.();
			return deleted;
		},
	};
}

export function createFixture() {
	const memory = getMemoryDatabase(uniqueName());
	return { memory, ...createRepositories(memory) };
}

export function createRepositories(memory: ReturnType<typeof getMemoryDatabase>) {
	const port = { memory, database: async () => null };
	const values = new KeyValueRepository(port, 'analysis');
	const mediaChunks = new MediaAssetChunkRecords(port);
	const sourceRecords = new SourceRecordRepository(port);
	const encodedSpools = new EncodedCaptureSpoolRepository(values, mediaChunks);
	const rawPcmSpools = new RawPcmSpoolRepository(values, sourceRecords);
	const manifests = new FramescaperCaptureSessionManifestRepository(values);
	return { values, mediaChunks, sourceRecords, encodedSpools, rawPcmSpools, manifests };
}

export function encodedPort(repository: EncodedCaptureSpoolRepository) {
	return {
		create: repository.create.bind(repository), load: repository.load.bind(repository),
		append: repository.append.bind(repository), seal: repository.seal.bind(repository),
		delete: repository.delete.bind(repository), releaseAdopted: repository.releaseAdopted.bind(repository),
		restoreAcknowledgedPrefix: repository.restoreAcknowledgedPrefix.bind(repository),
		reconcileAppend: repository.reconcileAppend.bind(repository),
	};
}

export function rawPcmPort(repository: RawPcmSpoolRepository) {
	return {
		create: repository.create.bind(repository), load: repository.load.bind(repository),
		createFramescaper: repository.createFramescaper.bind(repository),
		append: repository.append.bind(repository), seal: repository.seal.bind(repository),
		remove: repository.remove.bind(repository),
		releaseReservation: repository.releaseReservation.bind(repository),
		restoreAcknowledgedPrefix: repository.restoreAcknowledgedPrefix.bind(repository),
		reconcileAppend: repository.reconcileAppend.bind(repository),
	};
}

export function manifestPort(repository: FramescaperCaptureSessionManifestRepository) {
	return {
		create: repository.create.bind(repository), load: repository.load.bind(repository),
		listProject: repository.listProject.bind(repository), replace: repository.replace.bind(repository),
		remove: repository.remove.bind(repository), createCreation: repository.createCreation.bind(repository),
		listCreations: repository.listCreations.bind(repository),
		loadCreation: repository.loadCreation.bind(repository),
		publishCreation: repository.publishCreation.bind(repository),
		listProjectCreations: repository.listProjectCreations.bind(repository),
		replaceCreation: repository.replaceCreation.bind(repository),
		removeCreation: repository.removeCreation.bind(repository),
	};
}

export async function commitManifest(
	repository: FramescaperCaptureSessionManifestRepository,
	sealed: FramescaperCaptureSessionManifestV1,
): Promise<void> {
	let current = sealed;
	current = await repository.replace(current, { ...current, state: 'finalizing' });
	current = await repository.replace(current, {
		...current, state: 'published',
		streams: current.streams.map((stream) => ({ ...stream, playability: 'playable' })),
	});
	await repository.replace(current, { ...current, state: 'committed' });
}

export function sequentialId(prefix: string): () => string {
	let next = 0;
	return () => `${prefix}-${String(next += 1)}`;
}

function uniqueName(): string {
	return `framescaper-capture-creation-recovery-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
