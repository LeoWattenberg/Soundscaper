/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperNativeQueueStorageAuthority,
} from '../desktop/framescaper-native-services-options.mjs';

test('main storage authority binds exact replay, working demand, floor, and backend', async () => {
	let freeBytes = 1_300;
	const observations = [];
	const staging = {
		scratchReservation: (owner, request) => {
			assert.equal(owner, OWNER); assert.equal(request.derivedInputStageId, STAGE_ID); return 300;
		},
		outstandingLiveScratchByteLength: async () => 500,
	};
	const authority = createFramescaperNativeQueueStorageAuthority({
		projectAuthority: () => ({
			queueReservations: (request, replayScratchByteLength) => {
				observations.push({ taskKind: request.taskKind, replayScratchByteLength });
				return Object.freeze({ cpuCores: 2, processTreeRssBytes: 4_096,
					scratchBytes: 1_000, minimumFreeBytes: 100, hardwareBackend: null });
			},
		}),
		renderInputStaging: staging,
		queueCapacity: async () => ({ volumeFreeBytes: freeBytes }),
		runtime: async () => ({ queue: { list: () => [] }, scratch: { list: () => [] } }),
		reserveBackend: (request) => Object.freeze({ ...request.reservations, hardwareBackend: 'vaapi' }),
	});
	await authority.admitStage(BEGIN, 300, 200, 1_300);
	const reserved = await authority.reserveQueue(OWNER, REQUEST);
	assert.equal(reserved.hardwareBackend, 'vaapi');
	assert.equal(reserved.scratchBytes, 1_000);
	assert.deepEqual(observations, [
		{ taskKind: 'encoded-export', replayScratchByteLength: 300 },
		{ taskKind: 'encoded-export', replayScratchByteLength: 300 },
	]);
	await assert.rejects(() => authority.admitStage(BEGIN, 300, 200, 1_299), /cannot reserve/iu);
	freeBytes = 1_299;
	await assert.rejects(() => authority.reserveQueue(OWNER, REQUEST), /cannot reserve/iu);
});

test('main storage authority refuses unsafe or caller-inflated accounting', async () => {
	const base = {
		projectAuthority: () => ({ queueReservations: () => ({
			cpuCores: 2, processTreeRssBytes: 4_096, scratchBytes: 100,
			minimumFreeBytes: 10, hardwareBackend: null,
		}) }),
		renderInputStaging: {
			scratchReservation: () => 200,
			outstandingLiveScratchByteLength: async () => 0,
		},
		queueCapacity: async () => ({ volumeFreeBytes: Number.MAX_SAFE_INTEGER }),
		runtime: async () => ({ queue: { list: () => [] }, scratch: { list: () => [] } }),
		reserveBackend: (request) => request.reservations,
	};
	const authority = createFramescaperNativeQueueStorageAuthority(base);
	await assert.rejects(() => authority.reserveQueue(OWNER, REQUEST), /safe integer|storage/iu);
	await assert.rejects(
		() => authority.admitStage(BEGIN, Number.MAX_SAFE_INTEGER, 1, Number.MAX_SAFE_INTEGER),
		/safe integer|storage/iu,
	);
});

const OWNER = Object.freeze({ renderer: 1 });
const STAGE_ID = 'ab'.repeat(20);
const BEGIN = Object.freeze({
	liveRenderVersion: 1, planVersion: 14, planFingerprint: '12'.repeat(32), planPayload: '{}',
	projectId: 'project-1', projectRevision: 1, inputFingerprints: [], restartJobId: null,
	carrierByteLength: 200, audio: null,
});
const REQUEST = Object.freeze({
	...BEGIN, taskKind: 'encoded-export', derivedInputStageId: STAGE_ID,
	rootGrantId: '34'.repeat(16), relativeDestination: 'output.mov', recoveryClass: 'atomic-restart',
	reservations: Object.freeze({ cpuCores: 1, processTreeRssBytes: 1,
		scratchBytes: Number.MAX_SAFE_INTEGER, minimumFreeBytes: 0, hardwareBackend: null }),
});
