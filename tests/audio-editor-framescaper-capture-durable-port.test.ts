/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperCaptureDurablePortBinding,
} from '../src/common/editor/controller/framescaper-capture-durable-port.ts';
import type {
	CreateFramescaperCaptureDurableSessionRequest,
	FramescaperCaptureDurableSession as CoordinatorSession,
	FramescaperCaptureRecoveryInventoryEntry,
} from '../src/common/editor/controller/framescaper-capture-durable-session.ts';
import type { FramescaperCaptureSessionManifestV1 } from '../src/common/editor/framescaper-capture-session-manifest.ts';

const SHA = 'ab'.repeat(32);

test('durable port maps recorder formats and keeps coordinator ownership private', async () => {
	const harness = coordinatorHarness();
	const binding = createFramescaperCaptureDurablePortBinding({
		coordinator: harness.coordinator,
		createId: (prefix) => `${prefix}-id`,
	});
	const session = await binding.port.prepare({
		sessionId: 'session-a', generation: 2,
		projectFence: { projectId: 'project-a', baseRevision: 4, baseSha256: SHA },
		origin: { sequenceId: 'sequence-a', playheadMicroseconds: 100, destination: 'both' },
		destination: 'both',
		sources: [
			{ streamId: 'video-a', sourceId: 'source-video', role: 'camera' },
			{ streamId: 'audio-a', sourceId: 'source-audio', role: 'microphone' },
		],
		monotonicOriginMicroseconds: 1_000,
		streams: [
			{
				streamId: 'video-a', sourceId: 'source-video', role: 'camera', required: true,
				format: { kind: 'encoded-media', mimeType: 'video/webm' },
			},
			{
				streamId: 'audio-a', sourceId: 'source-audio', role: 'microphone', required: true,
				format: { kind: 'raw-pcm', sampleRate: 48_000, channelCount: 2, chunkFrames: 4_096 },
			},
		],
	});

	assert.deepEqual(harness.created?.streams, [
		{
			kind: 'encoded-media', role: 'camera', required: true,
			streamId: 'video-a', spoolId: 'camera-capture-spool-id',
			sourceId: 'source-video', mimeType: 'video/webm',
		},
		{
			kind: 'raw-pcm', role: 'microphone', required: true,
			streamId: 'audio-a', spoolId: 'microphone-capture-spool-id',
			sourceId: 'source-audio', sampleRate: 48_000, channelCount: 2, chunkFrames: 4_096,
		},
	]);
	assert.equal(binding.coordinatorSession(session), harness.session);
	await binding.port.append(session, packet());
	await binding.port.recordPauseSpan(session, { startMicroseconds: 2, endMicroseconds: 4 });
	await binding.port.seal(session);
	await binding.port.discard(session);
	assert.deepEqual(harness.events, ['append', 'pause', 'seal', 'delete']);
});

test('startup recovery seals an exact crash prefix and rejects ambiguous or changed ownership', async () => {
	const harness = coordinatorHarness({ recovery: [inventory('capturing')] });
	const binding = createFramescaperCaptureDurablePortBinding({
		coordinator: harness.coordinator, createId: () => 'spool-id',
	});
	const recovered = await binding.port.findRecovery('project-a');
	assert.equal(recovered?.sessionId, 'session-a');
	assert.deepEqual(harness.events, ['load', 'seal']);

	harness.recovery = [inventory('sealed'), inventory('sealed', 'session-b')];
	await assert.rejects(binding.port.findRecovery('project-a'), /more than one/iu);
	harness.recovery = [{ ...inventory('sealed'), storageStatus: 'changed' }];
	await assert.rejects(binding.port.findRecovery('project-a'), /storage is changed/iu);
});

test('a finalizer refresh rebinds discard to the current finalizing manifest session', async () => {
	const harness = coordinatorHarness();
	const binding = createFramescaperCaptureDurablePortBinding({
		coordinator: harness.coordinator, createId: () => 'spool-id',
	});
	const wrapped = await binding.port.prepare(prepareRequest());
	const finalizing = sessionStub(harness.events, manifest('finalizing'));
	harness.loadedSession = finalizing;

	assert.equal(await binding.refresh(wrapped), finalizing);
	assert.equal(binding.coordinatorSession(wrapped), finalizing);
	await binding.port.discard(wrapped);
	assert.deepEqual(harness.events, ['load', 'delete']);
});

test('a durable refresh rejects changed manifest ownership', async () => {
	const harness = coordinatorHarness();
	const binding = createFramescaperCaptureDurablePortBinding({
		coordinator: harness.coordinator, createId: () => 'spool-id',
	});
	const wrapped = await binding.port.prepare(prepareRequest());
	harness.loadedSession = sessionStub(harness.events, manifest('finalizing', 'session-b'));

	await assert.rejects(binding.refresh(wrapped), /changed ownership/iu);
	assert.equal(binding.coordinatorSession(wrapped), harness.session);
});

function coordinatorHarness(options: Readonly<{
	recovery?: readonly FramescaperCaptureRecoveryInventoryEntry[];
}> = {}) {
	const events: string[] = [];
	let created: CreateFramescaperCaptureDurableSessionRequest | null = null;
	let recovery = options.recovery ?? [];
	const session = sessionStub(events, manifest('capturing'));
	let loadedSession = session;
	return {
		events,
		get created() { return created; },
		get session() { return session; },
		get recovery() { return recovery; },
		set recovery(value) { recovery = value; },
		get loadedSession() { return loadedSession; },
		set loadedSession(value) { loadedSession = value; },
		coordinator: {
			async create(request: CreateFramescaperCaptureDurableSessionRequest) {
				created = request;
				return session;
			},
			async load() { events.push('load'); return loadedSession; },
			async recoveryInventory() { return recovery; },
		},
	};
}

function prepareRequest() {
	return {
		sessionId: 'session-a', generation: 2,
		projectFence: { projectId: 'project-a', baseRevision: 4, baseSha256: SHA },
		origin: { sequenceId: 'sequence-a', playheadMicroseconds: 100, destination: 'both' as const },
		destination: 'both' as const,
		sources: [{ streamId: 'video-a', sourceId: 'source-a', role: 'camera' as const }],
		monotonicOriginMicroseconds: 1_000,
		streams: [{
			streamId: 'video-a', sourceId: 'source-a', role: 'camera' as const, required: true as const,
			format: { kind: 'encoded-media' as const, mimeType: 'video/webm' },
		}],
	};
}

function sessionStub(events: string[], initialManifest: FramescaperCaptureSessionManifestV1): CoordinatorSession {
	let current = initialManifest;
	return {
		get manifest() { return current; },
		async append() { events.push('append'); return current; },
		async addPauseSpan() { events.push('pause'); return current; },
		async seal() { events.push('seal'); current = manifest('sealed'); return current; },
		async setPlayability() { return current; },
		async retireCommitted() { events.push('retire'); },
		async delete() { events.push('delete'); },
	};
}

function inventory(state: FramescaperCaptureSessionManifestV1['state'], sessionId = 'session-a') {
	return Object.freeze({
		manifest: manifest(state, sessionId),
		storageStatus: 'exact' as const,
		affectedStreamIds: Object.freeze([]),
	});
}

function manifest(state: FramescaperCaptureSessionManifestV1['state'], sessionId = 'session-a') {
	return Object.freeze({
		version: 1 as const, sessionId, generation: 1, state, recoveryDecision: null,
		projectFence: { projectId: 'project-a', baseRevision: 4, baseSha256: SHA },
		origin: { sequenceId: 'sequence-a', playheadMicroseconds: 100, destination: 'both' as const },
		clock: { monotonicOriginMicroseconds: 1_000, pauseSpans: Object.freeze([]) },
		streams: Object.freeze([{
			streamId: 'video-a', role: 'camera' as const, required: true, playability: 'unknown' as const,
			timing: { firstPresentationMicroseconds: 0, lastPresentationEndMicroseconds: 1_000 },
			storage: {
				kind: 'encoded-media' as const, spoolId: 'spool-a', spoolToken: 'token-a',
				sourceId: 'source-a', chunkCount: 1, mimeType: 'video/webm', packetCount: 1, byteLength: 4,
			},
		}]),
		createdAt: 1, updatedAt: 1,
	}) satisfies FramescaperCaptureSessionManifestV1;
}

function packet() {
	return Object.freeze({
		kind: 'encoded-video' as const, sessionId: 'session-a', streamId: 'video-a', role: 'camera' as const,
		sequence: 0, presentationTimeUs: 0, durationUs: 1_000, receiptTimeMs: 1,
		droppedBefore: { value: null, confidence: 'unavailable' as const },
		byteLength: 1, bytes: new Uint8Array([1]), mimeType: 'video/webm', keyFrame: null,
	});
}
