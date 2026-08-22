/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
	acquireFramescaperNativeServicesWriterLease,
	initializeFramescaperNativeServicesDatabase,
} from '../desktop/native-services-database.ts';
import {
	FramescaperNativeServicesController,
} from '../desktop/native-services-controller.ts';
import {
	FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS,
	registerFramescaperNativeServicesMainIpc,
} from '../desktop/native-services-main-ipc.ts';
import {
	createFramescaperNativeServicesMainPreloadBridge,
} from '../desktop/native-services-main-preload.ts';
import { FramescaperNativeQueueRepository } from '../desktop/native-services-queue-repository.ts';
import { FramescaperNativeRootRepository } from '../desktop/native-services-root-repository.ts';
import { FramescaperNativeWatchRepository } from '../desktop/native-services-watch-repository.ts';
import { createNativeQueueRecordV2 } from '../src/common/editor/native-queue-record.ts';
import { nativeQueueKeyedPlanV7 } from './helpers/native-queue-plan-fixture.ts';
import { framescaperClosedNativeCapabilityReportV1 } from '../desktop/native-media-capability-report.ts';
import {
	NATIVE_MEDIA_CAPABILITY_IDS,
	createNativeMediaCapabilitySnapshotV1,
} from '../src/common/editor/native-media-capability-snapshot.ts';

test('the authenticated pathless bridge reports blocked state and permits safe queue cleanup', async () => {
	const database = new DatabaseSync(':memory:');
	initializeFramescaperNativeServicesDatabase(database);
	const roots = new FramescaperNativeRootRepository(database);
	const lease = acquireFramescaperNativeServicesWriterLease(database, {
		leaseId: 'lease-a', instanceId: 'instance-a', processId: 1, nowMs: 0,
	});
	roots.authorize({
		grantId: 'f'.repeat(32), rootPath: '/private/export-root',
		volumeIdentity: 'volume-a', directoryIdentity: 'directory-a', authorizedAtMs: 0,
	}, lease, 0);
	const queue = new FramescaperNativeQueueRepository(database);
	queue.enqueue(createNativeQueueRecordV2({
		jobId: '1a'.repeat(20), taskKind: 'encoded-export', plan: nativeQueueKeyedPlanV7(),
		projectId: 'project-1', projectRevision: 1, inputFingerprints: [],
		rootGrantId: 'f'.repeat(32), relativeDestination: 'exports/reel.mp4',
		reservations: {
			cpuCores: 1, processTreeRssBytes: 1_024, scratchBytes: 4_096,
			minimumFreeBytes: 0, hardwareBackend: null,
		},
		position: 0, createdAtMs: 0,
	}), lease, 1);
	let preferences = {
		nativeMediaEnabled: false,
		hardwareDecodeEnabled: false,
		hardwareEncodeEnabled: false,
		ofxConsentEnabled: false,
	};
	const controller = new FramescaperNativeServicesController({
		queue,
		roots,
		watch: new FramescaperNativeWatchRepository(database),
		lease: () => lease,
		now: () => 2,
		preferences: () => preferences,
		capabilities: () => framescaperClosedNativeCapabilityReportV1(preferences),
		setPreference: (preference, enabled) => {
			const key = {
				'native-media': 'nativeMediaEnabled',
				'hardware-decode': 'hardwareDecodeEnabled',
				'hardware-encode': 'hardwareEncodeEnabled',
				'ofx-consent': 'ofxConsentEnabled',
			}[preference] as keyof typeof preferences;
			preferences = { ...preferences, [key]: enabled };
			return Promise.resolve(enabled);
		},
		// Both defaults are deliberately false: unbuilt/disabled helpers remain unavailable.
	});
	const handlers = new Map<string, (event: unknown, value?: unknown) => unknown>();
	const owner = {};
	const watchCalls: unknown[][] = [];
	const imageSequenceCalls: unknown[][] = [];
	const registration = registerFramescaperNativeServicesMainIpc({
		handle: (channel: string, handler: (event: unknown, value?: unknown) => unknown) => handlers.set(channel, handler),
		removeHandler: (channel: string) => { handlers.delete(channel); },
		authorizeOwner: (event: unknown) => event === owner ? owner : false,
		controller,
		watchImports: Object.freeze({
			claim: (claimedOwner: object, request: unknown) => {
				watchCalls.push([claimedOwner, request]);
				return Object.freeze({
					claimId: '2b'.repeat(16), projectId: 'project-1', projectRevision: 1,
					importMode: 'link', locatorId: '3c'.repeat(16), locatorRevision: '4d'.repeat(16),
					name: 'clip.mp4', size: 4, mimeType: 'video/mp4', lastModified: 2,
					contentSha256: '5e'.repeat(32),
				});
			},
			complete: (claimedOwner: object, request: unknown) => {
				watchCalls.push([claimedOwner, request]);
				return true;
			},
		}),
		imageSequenceSelections: Object.freeze({
			select: (claimedOwner: object, request: unknown) => {
				imageSequenceCalls.push([claimedOwner, request]);
				return Object.freeze({
					selectionId: '6f'.repeat(20),
					files: Object.freeze([Object.freeze({
						fileId: '7a'.repeat(20), name: 'shot.0001.png', byteLength: 3,
					})]),
				});
			},
			read: (claimedOwner: object, request: unknown) => {
				imageSequenceCalls.push([claimedOwner, request]);
				return Uint8Array.from([1, 2, 3]);
			},
			release: (claimedOwner: object, request: unknown) => {
				imageSequenceCalls.push([claimedOwner, request]);
				return true;
			},
		}),
	});
	const bridge = createFramescaperNativeServicesMainPreloadBridge({
		invoke: async (channel: string, value?: unknown) => {
			const handler = handlers.get(channel);
			if (!handler) throw new Error('missing handler');
			return handler(owner, value);
		},
	});

	const snapshot = await bridge.snapshot();
	const capabilities = await bridge.capabilities();
	assert.equal(capabilities.entries.length, 6);
	assert.equal(capabilities.entries.some((entry) => entry.id === 'persistent-render-queue'), true);
	assert.equal(capabilities.entries.every((entry) => entry.detail !== null), true);
	assert.equal(snapshot.runtimeAvailable, false);
	assert.equal(snapshot.nativeMediaEnabled, false);
	assert.equal(snapshot.queue[0]?.state, 'queued');
	assert.equal(JSON.stringify(snapshot).includes('/private/export-root'), false);
	assert.deepEqual(snapshot.roots, [{
		grantId: 'f'.repeat(32), displayName: 'Authorized folder', revoked: false,
	}]);
	assert.deepEqual(await bridge.preferences(), preferences);
	assert.equal(await bridge.setPreference({ preference: 'hardware-decode', enabled: true }), true);
	assert.equal((await bridge.preferences()).hardwareDecodeEnabled, true);
	await assert.rejects(
		() => bridge.setPreference({ preference: 'unknown', enabled: true } as never),
		/unsupported preference/u,
	);
	await assert.rejects(
		() => bridge.reorder({ jobId: '1a'.repeat(20), index: 0 }),
		/disabled|unavailable|policy/u,
	);

	assert.equal((await bridge.control({ jobId: '1a'.repeat(20), action: 'cancel' })).state, 'cancelled');
	assert.equal(await bridge.remove({ jobId: '1a'.repeat(20) }), true);
	assert.equal((await bridge.snapshot()).queue.length, 0);
	await assert.rejects(
		() => bridge.claimWatchImport({ projectId: 'project-1', projectRevision: 1 }),
		/disabled|unavailable|policy/u,
	);
	await assert.rejects(() => bridge.selectImageSequence(), /disabled|unavailable|policy/u);
	assert.deepEqual(watchCalls, []);
	assert.deepEqual(imageSequenceCalls, []);
	await assert.rejects(
		() => bridge.control({ jobId: '1a'.repeat(20), action: 'resume', extra: true } as never),
		/unsupported fields/u,
	);
	await assert.rejects(
		() => bridge.claimWatchImport({ projectId: 'project-1', projectRevision: 1, path: '/tmp/x' } as never),
		/missing or unsupported fields/iu,
	);
	await assert.rejects(
		async () => handlers.get(FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS.snapshot)?.({}, undefined),
		/not authorized/u,
	);

	registration.dispose();
	assert.equal(handlers.size, 0);
	database.close();
});

test('direct queue reorder requires a writable owning project after capability admission', () => {
	const database = new DatabaseSync(':memory:');
	initializeFramescaperNativeServicesDatabase(database);
	const lease = acquireFramescaperNativeServicesWriterLease(database, {
		leaseId: 'lease-reorder', instanceId: 'instance-reorder', processId: 3, nowMs: 0,
	});
	const queue = new FramescaperNativeQueueRepository(database);
	const roots = new FramescaperNativeRootRepository(database);
	roots.authorize({
		grantId: '9b'.repeat(16), rootPath: '/private/reorder-root',
		volumeIdentity: 'volume-reorder', directoryIdentity: 'directory-reorder', authorizedAtMs: 0,
	}, lease, 0);
	queue.enqueue(createNativeQueueRecordV2({
		jobId: '8a'.repeat(20), taskKind: 'encoded-export', plan: nativeQueueKeyedPlanV7(),
		projectId: 'project-closed', projectRevision: 1, inputFingerprints: [],
		rootGrantId: '9b'.repeat(16), relativeDestination: 'exports/closed.mp4',
		reservations: { cpuCores: 1, processTreeRssBytes: 1_024, scratchBytes: 4_096,
			minimumFreeBytes: 0, hardwareBackend: null },
		position: 0, createdAtMs: 0,
	}), lease, 1);
	const capabilities = createNativeMediaCapabilitySnapshotV1({
		masterEnabled: true,
		entries: Object.values(NATIVE_MEDIA_CAPABILITY_IDS).map((reference) => ({
			...reference, policyCleared: true, buildSupported: true, probeSucceeded: true,
			selfTestPassed: true, userEnabled: true,
		})),
	});
	const controller = new FramescaperNativeServicesController({
		queue, roots,
		watch: new FramescaperNativeWatchRepository(database), lease: () => lease,
		runtimeAvailable: () => true, nativeMediaEnabled: () => true,
		capabilities: () => capabilities,
		projectState: () => ({ open: true, writable: false }),
	});
	assert.throws(() => controller.reorder({ jobId: '8a'.repeat(20), index: 0 }), /writable/iu);
	assert.equal(queue.read('8a'.repeat(20))?.position, 0);
	database.close();
});

test('the preload boundary rejects a hostile native capability response', async () => {
	const database = new DatabaseSync(':memory:');
	initializeFramescaperNativeServicesDatabase(database);
	const lease = acquireFramescaperNativeServicesWriterLease(database, {
		leaseId: 'lease-b', instanceId: 'instance-b', processId: 2, nowMs: 0,
	});
	const controller = new FramescaperNativeServicesController({
		queue: new FramescaperNativeQueueRepository(database),
		roots: new FramescaperNativeRootRepository(database),
		watch: new FramescaperNativeWatchRepository(database),
		lease: () => lease,
	});
	const bridge = createFramescaperNativeServicesMainPreloadBridge({
		invoke: async () => ({
			snapshotVersion: 1, masterEnabled: false, buildFingerprint: null,
			entries: [{ domain: 'queue', id: 'persistent-render-queue', state: 'available',
				reason: 'ready', userEnabled: false, buildFingerprint: null, detail: null,
				secretPath: '/tmp/payload' }],
		}),
	});
	void controller;
	await assert.rejects(() => bridge.capabilities(), /unsupported fields|exact|keys/iu);
	database.close();
});
