/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
	acquireFramescaperNativeServicesWriterLease,
	initializeFramescaperNativeServicesDatabase,
} from '../desktop/native-services-database.ts';
import { initializeFramescaperNativeServicesDatabaseV3 } from '../desktop/native-services-database-v3.ts';
import {
	FramescaperNativeServicesControllerV3,
} from '../desktop/native-services-controller-v3.ts';
import {
	FramescaperNativeServicesLifecycleV3,
} from '../desktop/native-services-lifecycle-v3.ts';
import {
	FRAMESCAPER_NATIVE_SERVICES_MAIN_CHANNELS,
	registerFramescaperNativeServicesMainIpc,
} from '../desktop/native-services-main-ipc.ts';
import {
	createFramescaperNativeServicesMainPreloadBridge,
} from '../desktop/native-services-main-preload.ts';
import { FramescaperNativeQueueRepository } from '../desktop/native-services-queue-repository-v3.ts';
import { FramescaperNativeRootRepository } from '../desktop/native-services-root-repository.ts';
import { FramescaperNativeScratchRepository } from '../desktop/native-services-scratch-repository.ts';
import { FramescaperNativeWatchRepository } from '../desktop/native-services-watch-repository.ts';
import { createNativeQueueRecordV3 } from '../src/common/editor/native-queue-record-v3.ts';
import {
	NATIVE_MEDIA_CAPABILITY_IDS,
	createNativeMediaCapabilitySnapshotV1,
} from '../src/common/editor/native-media-capability-snapshot.ts';
import {
	createFramescaperNativeRenderPlanAuthorityNativeMedia,
} from '../src/framescaper/editor-native-render-plan-authority.ts';
import {
	createFramescaperProjectUnifiedExactRenderPlanNativeMedia,
} from '../src/framescaper/editor-project-unified-render-plan-native-media.ts';
import {
	FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE,
} from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectNativeMedia } from '../src/framescaper/editor-project-native-media.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

const GRANT_ID = 'ab'.repeat(16);
const RULE_ID = 'cd'.repeat(16);
const JOB_ID = 'ef'.repeat(20);
const SILENT_JOB_ID = 'ad'.repeat(20);
const ROOT = '/private/native-output';
const SHA_B = 'b'.repeat(64);
const PROFILE = FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE;
const PROJECT = createFramescaperProjectNativeMedia(PROFILE, framescaperV20Options());
const DELIVERY = Object.freeze({
	kind: 'image-sequence' as const, format: 'png' as const,
	frameRate: Object.freeze({ num: 10, den: 1 }), preserveAlpha: true as const,
});
const PLAN = createFramescaperProjectUnifiedExactRenderPlanNativeMedia(
	PROFILE, PROJECT, createFramescaperNativeRenderPlanAuthorityNativeMedia(PROJECT, DELIVERY), DELIVERY,
);

const usableCapabilities = () => createNativeMediaCapabilitySnapshotV1({
	masterEnabled: true,
	entries: Object.values(NATIVE_MEDIA_CAPABILITY_IDS).map((reference) => ({
		...reference, buildSupported: true, probeSucceeded: true,
		selfTestPassed: true, userEnabled: true,
	})),
});

test('a closed-project watch rule does not fail manual reconcile for the others', async () => {
	const database = new DatabaseSync(':memory:');
	initializeFramescaperNativeServicesDatabase(database);
	initializeFramescaperNativeServicesDatabaseV3(database);
	const lease = acquireFramescaperNativeServicesWriterLease(database, {
		leaseId: 'lease-reconcile', instanceId: 'instance-reconcile', processId: 7, nowMs: 1_000,
	});
	const roots = new FramescaperNativeRootRepository(database);
	roots.authorize({
		grantId: GRANT_ID, rootPath: ROOT,
		volumeIdentity: 'volume-a', directoryIdentity: 'directory-a', authorizedAtMs: 0,
	}, lease, 0);
	const watch = new FramescaperNativeWatchRepository(database);
	watch.create({
		ruleId: 'e'.repeat(32), grantId: GRANT_ID,
		schemaFamily: 'framescaper', schemaVersion: 1, projectId: 'project-open',
		binId: 'project-bin',
		extensions: ['mov'], createdAtMs: 0,
	}, lease, 0);
	watch.create({
		ruleId: 'f'.repeat(32), grantId: GRANT_ID,
		schemaFamily: 'framescaper', schemaVersion: 1, projectId: 'project-closed',
		binId: 'project-bin',
		extensions: ['mov'], createdAtMs: 0,
	}, lease, 0);
	let reconciliations = 0;
	const controller = new FramescaperNativeServicesControllerV3({
		queue: { list: () => [] }, roots, watch,
		lifecycle: { reconcileWatch: async () => { reconciliations += 1; } },
		lease: () => lease, now: () => 1_001,
		runtimeAvailable: () => true, nativeMediaEnabled: () => true,
		// The reconciler leaves closed-project ingests pending by contract, so
		// the manual reconcile must run for the open rule instead of throwing.
		projectState: (projectId: string) => ({
			schemaFamily: 'framescaper', schemaVersion: 1,
			open: projectId === 'project-open', writable: projectId === 'project-open',
			binId: 'project-bin' as const,
		}),
		capabilities: usableCapabilities,
	} as never as ConstructorParameters<typeof FramescaperNativeServicesControllerV3>[0]);
	await controller.reconcileWatch();
	assert.equal(reconciliations, 1);
	database.close();
});

test('the pathless lifecycle bridge owns roots, watch reconciliation, cleanup, publication, checkpoints, and display', async () => {
	const database = new DatabaseSync(':memory:');
	initializeFramescaperNativeServicesDatabase(database);
	initializeFramescaperNativeServicesDatabaseV3(database);
	const lease = acquireFramescaperNativeServicesWriterLease(database, {
		leaseId: 'lease-lifecycle', instanceId: 'instance-lifecycle', processId: 7, nowMs: 1_000,
	});
	const queue = new FramescaperNativeQueueRepository(database);
	const roots = new FramescaperNativeRootRepository(database);
	const watch = new FramescaperNativeWatchRepository(database);
	const scratch = new FramescaperNativeScratchRepository(database, queue);
	let reconciliations = 0;
	let hintRefreshes = 0;
	let displayId: string | null = null;
	let displaySession: object | null = null;
	let storedCheckpoint: unknown = null;
	const removedRenderInputs: string[] = [];
	const abandonedRenderInputs: string[] = [];
	const claimedRenderInputs: string[] = [];
	const files = new Map([
		['exports/reel.mp4.efefefefefefefef.partial', {
			byteLength: 10, sha256: SHA_B, symbolicLink: false,
		}],
	]);
	const lifecycle = new FramescaperNativeServicesLifecycleV3({
		queue, roots, watch, scratch,
		lease: () => lease,
		now: () => 1_001,
		mintOpaqueId: () => RULE_ID,
		mintJobId: () => SILENT_JOB_ID,
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
			schemaFamily: 'framescaper', schemaVersion: 1,
			projectId: 'project-a', projectRevision: 1,
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
			sessionIdentity: () => displaySession,
			open: async (selected) => { displayId = selected.displayId; displaySession = {}; },
			stop: () => { displayId = null; displaySession = null; },
			present: () => undefined,
		},
	});
	const controller = new FramescaperNativeServicesControllerV3({
		queue, roots, watch, lifecycle, lease: () => lease, now: () => 1_001,
		runtimeAvailable: () => true, nativeMediaEnabled: () => true,
		projectState: () => ({
			schemaFamily: 'framescaper', schemaVersion: 1, open: true, writable: true,
			binId: 'project-bin',
		}),
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
			beginLive: async () => { throw new Error('unused'); },
			receive: async () => { throw new Error('unused'); },
			finalize: async () => { throw new Error('unused'); },
			writeLive: async () => { throw new Error('unused'); },
			completeLive: async () => { throw new Error('unused'); },
			abandon: async (_owner: object, request: Readonly<{ stageId: string }>) => {
				abandonedRenderInputs.push(request.stageId);
			},
			claim: async (_owner: unknown, request: unknown) => {
				claimedRenderInputs.push((request as { derivedInputStageId: string }).derivedInputStageId);
			},
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
		grantId: GRANT_ID, schemaFamily: 'framescaper', schemaVersion: 1,
		projectId: 'project-1', binId: 'bin-1',
		extensions: ['mov'], importMode: 'link', generateProxies: false,
	}), /exact v1 writable project bin/u);
	const rule = await bridge.createWatch({
		grantId: GRANT_ID, schemaFamily: 'framescaper', schemaVersion: 1,
		projectId: 'project-1', binId: 'project-bin',
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
		schemaFamily: planned.schemaFamily, schemaVersion: planned.schemaVersion,
		taskKind: planned.taskKind,
		planVersion: 14,
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
	assert.deepEqual(claimedRenderInputs, [JOB_ID]);
	assert.equal((await bridge.reorder({ jobId: JOB_ID, index: 0 }))[0]?.jobId, JOB_ID);
	queue.control(JOB_ID, { kind: 'dispatch' }, lease, 1_003);
	const sourceInventoryDigest = createHash('sha256').update('[]').digest('hex');
	const checkpoint = await bridge.checkpoint({
		schemaFamily: 'framescaper', schemaVersion: 1, jobId: JOB_ID,
		sourceInventoryDigest,
		plannedFrameCount: PLAN.output.frameCount,
		manifest: [{
			frameIndex: 0, relativePath: 'frames/000001.png', byteLength: 2, sha256: SHA_B,
			planFingerprint: queueRecord().planFingerprint, sourceInventoryDigest,
		}],
	});
	assert.equal(checkpoint.verifiedFrameCount, 1);
	assert.equal(checkpoint.complete, PLAN.output.frameCount === 1);
	assert.equal((storedCheckpoint as { manifest: unknown[] }).manifest.length, 1);
	const published = await bridge.publish({
		schemaFamily: 'framescaper', schemaVersion: 1,
		jobId: JOB_ID, currentPlanFingerprint: queueRecord().planFingerprint,
		finalized: true, declaredByteLength: 10, declaredSha256: SHA_B,
	});
	assert.equal(published.outcome, 'published');
	assert.equal(queue.read(JOB_ID)?.state, 'completed');
	assert.equal(await bridge.remove({ jobId: JOB_ID }), true);
	assert.deepEqual(removedRenderInputs, [], 'V14 carrier custody settles before terminal queue removal');
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
		'enqueue', 'abandonRenderInputs', 'selectRoot', 'reauthorizeQueueRoot', 'revalidateRoot', 'revokeRoot', 'createWatch', 'setWatchEnabled',
		'removeWatch', 'reconcileWatch', 'cleanupScratch', 'publish', 'checkpoint',
		'externalDisplays', 'setExternalDisplay',
	] as const) assert.equal(typeof bridge[method], 'function', method);
	await assert.rejects(() => bridge.enqueue({
		...{
			schemaFamily: planned.schemaFamily, schemaVersion: planned.schemaVersion,
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
	return createNativeQueueRecordV3({
		schemaFamily: 'framescaper', schemaVersion: 1,
		jobId: JOB_ID,
		taskKind: 'image-sequence-export',
		plan: PLAN,
		projectId: String(PROJECT.id),
		projectRevision: Number(PROJECT.revision),
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
