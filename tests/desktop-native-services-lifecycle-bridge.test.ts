/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
	FramescaperNativeServicesLifecycle,
} from '../desktop/native-services-lifecycle.ts';
import {
	FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS,
	registerFramescaperNativeServicesMainIpc,
} from '../desktop/native-services-main-ipc.ts';
import {
	createFramescaperNativeServicesMainPreloadBridge,
} from '../desktop/native-services-main-preload.ts';
import { FramescaperNativeQueueRepository } from '../desktop/native-services-queue-repository.ts';
import { FramescaperNativeRootRepository } from '../desktop/native-services-root-repository.ts';
import { FramescaperNativeScratchRepository } from '../desktop/native-services-scratch-repository.ts';
import { FramescaperNativeWatchRepository } from '../desktop/native-services-watch-repository.ts';
import { createNativeQueueRecordV2 } from '../src/common/editor/native-queue-record.ts';
import {
	NATIVE_MEDIA_CAPABILITY_IDS,
	createNativeMediaCapabilitySnapshotV1,
} from '../src/common/editor/native-media-capability-snapshot.ts';
import { nativeQueueKeyedPlanV7 } from './helpers/native-queue-plan-fixture.ts';

const GRANT_ID = 'ab'.repeat(16);
const RULE_ID = 'cd'.repeat(16);
const JOB_ID = 'ef'.repeat(20);
const ROOT = '/private/native-output';
const SHA_B = 'b'.repeat(64);

const usableCapabilities = () => createNativeMediaCapabilitySnapshotV1({
	masterEnabled: true,
	entries: Object.values(NATIVE_MEDIA_CAPABILITY_IDS).map((reference) => ({
		...reference, policyCleared: true, buildSupported: true, probeSucceeded: true,
		selfTestPassed: true, userEnabled: true,
	})),
});

test('the pathless lifecycle bridge owns roots, watch reconciliation, cleanup, publication, checkpoints, and display', async () => {
	const database = new DatabaseSync(':memory:');
	initializeFramescaperNativeServicesDatabase(database);
	const lease = acquireFramescaperNativeServicesWriterLease(database, {
		leaseId: 'lease-lifecycle', instanceId: 'instance-lifecycle', processId: 7, nowMs: 1_000,
	});
	const queue = new FramescaperNativeQueueRepository(database);
	const roots = new FramescaperNativeRootRepository(database);
	const watch = new FramescaperNativeWatchRepository(database);
	const scratch = new FramescaperNativeScratchRepository(database);
	let reconciliations = 0;
	let hintRefreshes = 0;
	let displayId: string | null = null;
	let storedCheckpoint: unknown = null;
	const removedRenderInputs: string[] = [];
	const abandonedRenderInputs: string[] = [];
	const files = new Map([
		['exports/reel.mp4.efefefefefefefef.partial', {
			byteLength: 10, sha256: SHA_B, symbolicLink: false,
		}],
	]);
	const lifecycle = new FramescaperNativeServicesLifecycle({
		queue, roots, watch, scratch,
		lease: () => lease,
		now: () => 1_001,
		mintOpaqueId: () => RULE_ID,
		mintJobId: () => JOB_ID,
		selectRoot: async () => ({
			grantId: GRANT_ID,
			rootPath: ROOT,
			volumeIdentity: 'volume-a',
			directoryIdentity: 'directory-a',
			authorizedAtMs: 1_001,
		}),
		probeRoot: async () => ({
			exists: true, directory: true, symbolicLink: false, canonicalPath: ROOT,
			volumeIdentity: 'volume-a', directoryIdentity: 'directory-a',
		}),
		watchCoordinator: {
			refreshHints: () => { hintRefreshes += 1; },
			reconcileNow: async () => { reconciliations += 1; },
		},
		scratchCleanup: {
			inspect: async () => null,
			remove: async () => { throw new Error('an unauthenticated scratch directory must not be removed'); },
		},
		publicationPortFor: () => ({
			inspect: async (relativePath) => files.get(relativePath) ?? null,
			renameTemporarySibling: async (temporary, destination) => {
				const file = files.get(temporary);
				if (!file) throw new Error('missing temporary');
				files.delete(temporary);
				files.set(destination, file);
			},
			removePublishedOutput: async (destination) => { files.delete(destination); },
		}),
		publicationFenceFor: () => ({
			beforePublication: async () => undefined,
			afterPublication: async () => undefined,
		}),
		removeRenderInputs: async (record) => { removedRenderInputs.push(record.jobId); },
		checkpointInspectFor: () => async (frame) => ({
			byteLength: frame.byteLength,
			sha256: frame.sha256,
			symbolicLink: false,
		}),
		checkpointStore: {
			read: async () => storedCheckpoint,
			write: async (evidence) => { storedCheckpoint = evidence; },
		},
		externalDisplay: {
			list: () => [{
				displayId: 'display-2', label: 'Client', primary: false,
				width: 1920, height: 1080, hdrCapable: false, colorManaged: true,
				bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
			}],
			activeDisplayId: () => displayId,
			open: async (selected) => { displayId = selected.displayId; },
			stop: () => { displayId = null; },
			present: () => undefined,
		},
	});
	const controller = new FramescaperNativeServicesController({
		queue, roots, watch, lifecycle, lease: () => lease, now: () => 1_001,
		runtimeAvailable: () => true, nativeMediaEnabled: () => true,
		projectState: () => ({ open: true, writable: true }),
		capabilities: usableCapabilities,
	});
	const handlers = new Map<string, (event: unknown, request?: unknown) => unknown>();
	const owner = {};
	const registration = registerFramescaperNativeServicesMainIpc({
		handle: (channel: string, handler: (event: unknown, request?: unknown) => Promise<unknown> | unknown) => handlers.set(channel, handler),
		removeHandler: (channel: string) => { handlers.delete(channel); },
		on: () => undefined,
		removeListener: () => undefined,
		authorizeOwner: (event: unknown) => event === owner ? owner : false,
		controller,
		renderInputs: {
			begin: async () => { throw new Error('unused'); },
			receive: async () => { throw new Error('unused'); },
			finalize: async () => { throw new Error('unused'); },
			abandon: async (_owner: object, request: Readonly<{ stageId: string }>) => {
				abandonedRenderInputs.push(request.stageId);
			},
			claim: async () => undefined,
			rollbackClaim: async () => undefined,
		},
	});
	const bridge = createFramescaperNativeServicesMainPreloadBridge({
		invoke: async (channel: string, request?: unknown): Promise<unknown> => {
			const handler = handlers.get(channel);
			if (!handler) throw new Error(`missing ${channel}`);
			return handler(owner, request);
		},
	});
	assert.equal(await bridge.abandonRenderInputs({ stageId: JOB_ID }), true);
	assert.deepEqual(abandonedRenderInputs, [JOB_ID]);

	assert.deepEqual(await bridge.selectRoot(), {
		grantId: GRANT_ID, displayName: 'Authorized folder', revoked: false,
	});
	assert.equal(await bridge.revalidateRoot({ grantId: GRANT_ID }), true);
	await assert.rejects(() => bridge.createWatch({
		grantId: GRANT_ID, projectId: 'project-1', binId: null,
		extensions: ['mov'], importMode: 'link', generateProxies: true,
	}), /watch-folder proxy generation is unavailable/u);
	await assert.rejects(() => bridge.createWatch({
		grantId: GRANT_ID, projectId: 'project-1', binId: 'bin-1',
		extensions: ['mov'], importMode: 'link', generateProxies: false,
	}), /watch-folder destination bins are unavailable/u);
	const rule = await bridge.createWatch({
		grantId: GRANT_ID, projectId: 'project-1', binId: null,
		extensions: ['mov'], importMode: 'link', generateProxies: false,
	});
	assert.equal(rule.ruleId, RULE_ID);
	assert.equal(rule.enabled, true);
	assert.equal((await bridge.setWatchEnabled({ ruleId: RULE_ID, enabled: false })).enabled, false);
	assert.equal(await bridge.removeWatch({ ruleId: RULE_ID }), true);
	await bridge.reconcileWatch();
	assert.equal(reconciliations, 1);
	assert.ok(hintRefreshes >= 3);
	assert.deepEqual(await bridge.cleanupScratch(), []);

	const planned = queueRecord();
	const enqueued = await bridge.enqueue({
		taskKind: planned.taskKind,
		planVersion: planned.planVersion as 7,
		derivedInputStageId: JOB_ID,
		planFingerprint: planned.planFingerprint,
		planPayload: planned.planPayload,
		projectId: planned.projectId,
		projectRevision: planned.projectRevision,
		inputFingerprints: planned.inputFingerprints,
		rootGrantId: planned.rootGrantId,
		relativeDestination: planned.relativeDestination,
		reservations: planned.reservations,
		recoveryClass: planned.recoveryClass,
	});
	assert.equal(enqueued.jobId, JOB_ID);
	assert.equal(enqueued.state, 'queued');
	assert.equal((await bridge.reorder({ jobId: JOB_ID, index: 0 }))[0]?.jobId, JOB_ID);
	queue.control(JOB_ID, { kind: 'dispatch' }, lease, 1_003);
	const sourceInventoryDigest = createHash('sha256').update('[]').digest('hex');
	const checkpoint = await bridge.checkpoint({
		jobId: JOB_ID,
		sourceInventoryDigest,
		plannedFrameCount: 30,
		manifest: [{
			frameIndex: 0, relativePath: 'frames/000001.png', byteLength: 2, sha256: SHA_B,
			planFingerprint: queueRecord().planFingerprint, sourceInventoryDigest,
		}],
	});
	assert.equal(checkpoint.verifiedFrameCount, 1);
	assert.equal(checkpoint.complete, false);
	assert.equal((storedCheckpoint as { manifest: unknown[] }).manifest.length, 1);
	const published = await bridge.publish({
		jobId: JOB_ID, currentPlanFingerprint: queueRecord().planFingerprint,
		finalized: true, declaredByteLength: 10, declaredSha256: SHA_B,
	});
	assert.equal(published.outcome, 'published');
	assert.equal(queue.read(JOB_ID)?.state, 'completed');
	assert.equal(await bridge.remove({ jobId: JOB_ID }), true);
	assert.deepEqual(removedRenderInputs, [JOB_ID]);
	assert.equal(queue.read(JOB_ID), null);

	assert.deepEqual(await bridge.externalDisplays(), {
		displays: [{
			displayId: 'display-2', label: 'Client', primary: false,
			width: 1920, height: 1080, hdrCapable: false, colorManaged: true,
		}],
		activeDisplayId: null,
	});
	assert.equal((await bridge.setExternalDisplay({ displayId: 'display-2' })).activeDisplayId, 'display-2');
	assert.equal((await bridge.setExternalDisplay({ displayId: null })).activeDisplayId, null);
	assert.equal(await bridge.revokeRoot({ grantId: GRANT_ID }), true);

	for (const method of [
		'enqueue', 'abandonRenderInputs', 'selectRoot', 'revalidateRoot', 'revokeRoot', 'createWatch', 'setWatchEnabled',
		'removeWatch', 'reconcileWatch', 'cleanupScratch', 'publish', 'checkpoint',
		'externalDisplays', 'setExternalDisplay',
	] as const) assert.equal(typeof bridge[method], 'function', method);
	await assert.rejects(() => bridge.enqueue({
		...{
			taskKind: planned.taskKind, derivedInputStageId: JOB_ID,
			planFingerprint: planned.planFingerprint,
			planPayload: planned.planPayload, projectId: planned.projectId,
			projectRevision: planned.projectRevision, inputFingerprints: planned.inputFingerprints,
			rootGrantId: planned.rootGrantId, relativeDestination: planned.relativeDestination,
			reservations: planned.reservations, recoveryClass: planned.recoveryClass,
		},
		planVersion: 6 as 7,
	}), /unsupported plan/iu);
	assert.ok(Object.keys(FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS).length >= 18);
	registration.dispose();
	database.close();
});

function queueRecord() {
	return createNativeQueueRecordV2({
		jobId: JOB_ID,
		taskKind: 'image-sequence-export',
		plan: nativeQueueKeyedPlanV7(),
		projectId: 'project-1',
		projectRevision: 1,
		inputFingerprints: [],
		rootGrantId: GRANT_ID,
		relativeDestination: 'exports/reel.mp4',
		reservations: {
			cpuCores: 1, processTreeRssBytes: 1_024, scratchBytes: 4_096,
			minimumFreeBytes: 0, hardwareBackend: null,
		},
		recoveryClass: 'verified-frame-checkpoint',
		position: 0,
		createdAtMs: 1_002,
	});
}
