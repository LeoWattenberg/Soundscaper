/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperNativeServicesStore,
	type FramescaperNativeServicesBridge,
	type FramescaperNativeServicesProjection,
} from '../src/common/editor/ui/framescaper-native-services-bridge.ts';
import {
	framescaperNativeServicesActionKey,
	runFramescaperNativeServicesAction,
} from '../src/common/editor/ui/framescaper-native-services-dialog-model.ts';
import {
	canonicalizeNativeMediaPlan,
	fingerprintNativeMediaPlan,
} from '../src/common/editor/native-media-plan-canonical-form.ts';
import { createUnifiedExactRenderPlan } from '../src/common/editor/unified-exact-render-plan.ts';
import { nativeQueueKeyedPlanV7 } from './helpers/native-queue-plan-fixture.ts';
import { unifiedExactPlanFixture } from './helpers/unified-exact-render-plan-fixture.ts';

const ROOT_ID = 'ab'.repeat(16);
const RULE_ID = 'cd'.repeat(16);
const JOB_ID = '12'.repeat(20);

test('renderer lifecycle actions call only exact bridge methods and refresh authoritative state', async () => {
	const fixture = lifecycleBridge();
	const store = createFramescaperNativeServicesStore(fixture.bridge);
	await store.refresh();
	await store.selectRoot();
	await store.revalidateRoot({ grantId: ROOT_ID });
	await store.createWatch({
		grantId: ROOT_ID,
		projectId: 'project-1',
		binId: null,
		extensions: ['wav', 'mov'],
		importMode: 'link',
		generateProxies: false,
	});
	await store.setWatchEnabled({ ruleId: RULE_ID, enabled: false });
	await store.reconcileWatch();
	await store.removeWatch({ ruleId: RULE_ID });
	await store.cleanupScratch();
	await store.settleScratch({ jobId: JOB_ID });
	await store.revokeRoot({ grantId: ROOT_ID });

	assert.deepEqual(fixture.calls.filter((call) => call[0] !== 'snapshot'), [
		['selectRoot'],
		['revalidateRoot', ROOT_ID],
		['createWatch', ROOT_ID, 'project-1', null, 'wav,mov', 'link', false],
		['setWatchEnabled', RULE_ID, false],
		['reconcileWatch'],
		['removeWatch', RULE_ID],
		['cleanupScratch'],
		['settleScratch', JOB_ID],
		['revokeRoot', ROOT_ID],
	]);
	assert.equal(fixture.calls.filter((call) => call[0] === 'snapshot').length, 10);
});

test('renderer lifecycle requests reject stale/path-like or unsupported input before preload', async () => {
	const fixture = lifecycleBridge();
	const store = createFramescaperNativeServicesStore(fixture.bridge);

	await assert.rejects(() => store.createWatch({
		grantId: ROOT_ID,
		projectId: '../escape',
		binId: null,
		extensions: ['wav'],
		importMode: 'link',
		generateProxies: false,
	}), /project id/iu);
	await assert.rejects(() => store.createWatch({
		grantId: ROOT_ID,
		projectId: 'project-1',
		binId: null,
		extensions: ['wav', '.WAV'],
		importMode: 'link',
		generateProxies: false,
	}), /duplicate/iu);
	await assert.rejects(() => store.revokeRoot({ grantId: '/tmp/private' }), /grant id/iu);
	await assert.rejects(() => store.settleScratch({ jobId: ROOT_ID }), /job id/iu);
	assert.deepEqual(fixture.calls, []);
});

test('dialog action model owns watch, root, and scratch mutations', async () => {
	const fixture = lifecycleBridge();
	const store = createFramescaperNativeServicesStore(fixture.bridge);
	const create = {
		type: 'watch-create' as const,
		grantId: ROOT_ID,
		projectId: 'project-1',
		binId: null,
		extensions: ['wav'],
		importMode: 'link' as const,
		generateProxies: false,
	};
	assert.equal(framescaperNativeServicesActionKey(create), 'watch:create:project-1');
	assert.equal((await runFramescaperNativeServicesAction(store, create)).type, 'settled');
	assert.equal((await runFramescaperNativeServicesAction(store, {
		type: 'root-revalidate', grantId: ROOT_ID,
	})).type, 'settled');
	assert.equal((await runFramescaperNativeServicesAction(store, {
		type: 'scratch-cleanup',
	})).type, 'settled');
});

test('queue enqueue is exposed only for an exact canonical plan identity', async () => {
	const fixture = lifecycleBridge();
	const store = createFramescaperNativeServicesStore(fixture.bridge);
	const plan = nativeQueueKeyedPlanV7();
	const fingerprint = fingerprintNativeMediaPlan(plan);
	const request = {
		taskKind: 'encoded-export' as const,
		planVersion: 7 as const,
		derivedInputStageId: JOB_ID,
		planFingerprint: fingerprint.sha256,
		planPayload: canonicalizeNativeMediaPlan(plan),
		projectId: 'project-1',
		projectRevision: 4,
		inputFingerprints: [{ sourceId: 'source-a', sha256: '12'.repeat(32) }],
		rootGrantId: ROOT_ID,
		relativeDestination: 'exports/reel.mp4',
		reservations: {
			cpuCores: 2, processTreeRssBytes: 1024, scratchBytes: 2048,
			minimumFreeBytes: 4096, hardwareBackend: null,
		},
		recoveryClass: 'atomic-restart' as const,
	};
	await store.enqueue(request);
	assert.equal(fixture.calls.some((call) => call[0] === 'enqueue'
		&& call[1] === fingerprint.sha256), true);
	for (const version of [9, 10, 11, 12] as const) {
		const unified = createUnifiedExactRenderPlan(unifiedExactPlanFixture(version));
		const identity = fingerprintNativeMediaPlan(unified);
		await store.enqueue({
			...request, planVersion: version, derivedInputStageId: null,
			planFingerprint: identity.sha256, planPayload: canonicalizeNativeMediaPlan(unified),
			inputFingerprints: [{ sourceId: 'source-1', sha256: '12'.repeat(32) }],
		});
	}
	const unified = createUnifiedExactRenderPlan(unifiedExactPlanFixture(12));
	await assert.rejects(() => store.enqueue({
		...request, planVersion: 12, derivedInputStageId: JOB_ID,
		planFingerprint: fingerprintNativeMediaPlan(unified).sha256,
		planPayload: canonicalizeNativeMediaPlan(unified),
	}), /unified V12|derived-input stage|durable.*carrier/iu);
	await assert.rejects(
		() => store.enqueue({ ...request, planFingerprint: '34'.repeat(32) }),
		/exact plan identity/iu,
	);
});

function lifecycleBridge(): Readonly<{
	bridge: FramescaperNativeServicesBridge;
	calls: unknown[][];
}> {
	const calls: unknown[][] = [];
	const bridge: FramescaperNativeServicesBridge = {
		snapshot: () => {
			calls.push(['snapshot']);
			return Promise.resolve(snapshot());
		},
		control: () => Promise.reject(new Error('not used')),
		reorder: () => Promise.reject(new Error('not used')),
		remove: () => Promise.reject(new Error('not used')),
		enqueue: (request) => {
			calls.push(['enqueue', request.planFingerprint]);
			return Promise.resolve({ jobId: JOB_ID });
		},
		selectRoot: () => {
			calls.push(['selectRoot']);
			return Promise.resolve({ grantId: ROOT_ID, displayName: 'Exports', revoked: false });
		},
		revalidateRoot: ({ grantId }) => {
			calls.push(['revalidateRoot', grantId]);
			return Promise.resolve(true);
		},
		revokeRoot: ({ grantId }) => {
			calls.push(['revokeRoot', grantId]);
			return Promise.resolve(true);
		},
		createWatch: (request) => {
			calls.push([
				'createWatch', request.grantId, request.projectId, request.binId,
				request.extensions.join(','), request.importMode, request.generateProxies,
			]);
			return Promise.resolve(watchRule());
		},
		setWatchEnabled: ({ ruleId, enabled }) => {
			calls.push(['setWatchEnabled', ruleId, enabled]);
			return Promise.resolve({ ...watchRule(), enabled });
		},
		removeWatch: ({ ruleId }) => {
			calls.push(['removeWatch', ruleId]);
			return Promise.resolve(true);
		},
		reconcileWatch: () => {
			calls.push(['reconcileWatch']);
			return Promise.resolve(snapshot());
		},
		cleanupScratch: () => {
			calls.push(['cleanupScratch']);
			return Promise.resolve([JOB_ID]);
		},
		settleScratch: ({ jobId }) => {
			calls.push(['settleScratch', jobId]);
			return Promise.resolve('released');
		},
	};
	return { bridge, calls };
}

function snapshot(): FramescaperNativeServicesProjection {
	return {
		snapshotVersion: 1,
		runtimeAvailable: true,
		nativeMediaEnabled: true,
		queue: [],
		roots: [{ grantId: ROOT_ID, displayName: 'Exports', revoked: false }],
		watchRules: [watchRule()],
	};
}

function watchRule() {
	return {
		ruleId: RULE_ID,
		grantId: ROOT_ID,
		projectId: 'project-1',
		extensions: ['wav'],
		importMode: 'link' as const,
		generateProxies: false,
		enabled: true,
	};
}
