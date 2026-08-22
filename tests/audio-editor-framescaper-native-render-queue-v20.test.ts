/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	canonicalizeNativeMediaPlan,
	fingerprintNativeMediaPlan,
} from '../src/common/editor/native-media-plan-canonical-form.ts';
import {
	createNativeMediaCapabilitySnapshotV1,
	NATIVE_MEDIA_CAPABILITY_IDS,
} from '../src/common/editor/native-media-capability-snapshot.ts';
import {
	framescaperNativeProjectActionRuntimeFor,
} from '../src/common/editor/ui/framescaper-native-project-actions.ts';
import {
	bindFramescaperNativeRenderQueueActionV20,
} from '../src/framescaper/editor-native-render-queue-action-v20.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsV20,
} from '../src/framescaper/editor-project-feature-requirements-v20.ts';
import { FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v20.ts';
import { createFramescaperProjectV20 } from '../src/framescaper/editor-project-v20.ts';
import type { FramescaperProjectV20 } from '../src/framescaper/editor-project-v20.ts';
import {
	framescaperV20Options,
	opacityKeyframes,
} from './helpers/framescaper-v20-model-fixture.ts';

const ROOT_GRANT_ID = 'ab'.repeat(16);
const STAGE_ID = 'cd'.repeat(20);
const PROFILE = FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE;

test('selected V20 advertises only queue enqueue and authors canonical static V8', async (context) => {
	const project = createFramescaperProjectV20(PROFILE, framescaperV20Options());
	const owner = projectOwner(project);
	const requests: unknown[] = [];
	bindFramescaperNativeRenderQueueActionV20(PROFILE, owner);
	const runtime = framescaperNativeProjectActionRuntimeFor(owner);
	assert.ok(runtime);
	assert.deepEqual(runtime.surfaces, ['render-queue-enqueue']);

	installDesktopBridge(context, bridgeFixture({ requests }));
	await runtime.run('render-queue-enqueue');
	assert.equal(requests.length, 1);
	const request = requestRecord(requests[0]);
	const plan = JSON.parse(String(request.planPayload)) as Record<string, unknown>;
	assert.equal(request.planVersion, 8);
	assert.equal(request.derivedInputStageId, null);
	assert.equal(plan.version, 8);
	assert.equal(request.planPayload, canonicalizeNativeMediaPlan(plan));
	assert.equal(request.planFingerprint, fingerprintNativeMediaPlan(plan).sha256);
	assert.equal(request.projectId, project.id);
	assert.equal(request.projectRevision, project.revision);
	assert.deepEqual(request.inputFingerprints, [{
		sourceId: 'video-source', sha256: '12'.repeat(32),
	}]);
	assert.equal(request.rootGrantId, ROOT_GRANT_ID);
	assert.equal(request.relativeDestination, 'renders/framescaper-framescaper-v20-r0.mp4');
	assert.deepEqual(request.reservations, {
		cpuCores: 2,
		processTreeRssBytes: 2 * 1_024 ** 3,
		scratchBytes: 16 * 1_024 ** 3,
		minimumFreeBytes: 4 * 1_024 ** 3,
		hardwareBackend: null,
	});
	assert.equal(JSON.stringify(request).includes('/private/authorized-root'), false);
	assert.equal(Object.isFrozen(request), true);
});

test('selected V20 authors V7 only for an active authored keyframe range', async (context) => {
	const project = createFramescaperProjectV20(PROFILE, framescaperV20Options());
	(project.clips[0] as unknown as Record<string, unknown>).videoKeyframes = opacityKeyframes();
	(project as unknown as Record<string, unknown>).featureRequirements =
		reconcileFramescaperProjectFeatureRequirementsV20(PROFILE, project);
	const owner = projectOwner(project);
	const requests: unknown[] = [];
	bindFramescaperNativeRenderQueueActionV20(PROFILE, owner);
	installDesktopBridge(context, bridgeFixture({ requests }));

	await framescaperNativeProjectActionRuntimeFor(owner)!.run('render-queue-enqueue');
	const request = requestRecord(requests[0]);
	const plan = JSON.parse(String(request.planPayload)) as Record<string, unknown>;
	assert.equal(request.planVersion, 7);
	assert.equal(request.derivedInputStageId, STAGE_ID);
	assert.equal(plan.version, 7);
	assert.equal(request.planPayload, canonicalizeNativeMediaPlan(plan));
	assert.equal(request.planFingerprint, fingerprintNativeMediaPlan(plan).sha256);
});

test('queue action resolves the bridge at invocation and refuses unavailable runtime authority', async (context) => {
	const project = createFramescaperProjectV20(PROFILE, framescaperV20Options());
	const owner = projectOwner(project);
	bindFramescaperNativeRenderQueueActionV20(PROFILE, owner);
	const runtime = framescaperNativeProjectActionRuntimeFor(owner)!;
	const original = Object.getOwnPropertyDescriptor(globalThis, 'framescaperDesktop');
	context.after(() => restoreGlobalDesktop(original));
	delete (globalThis as Record<string, unknown>).framescaperDesktop;
	await assert.rejects(() => runtime.run('render-queue-enqueue'), /desktop.*bridge|unavailable/iu);

	const requests: unknown[] = [];
	Object.defineProperty(globalThis, 'framescaperDesktop', {
		configurable: true,
		value: { v1: { nativeServices: bridgeFixture({ requests, capabilityReady: false }) } },
	});
	await assert.rejects(() => runtime.run('render-queue-enqueue'), /capability|unavailable|enabled/iu);
	assert.equal(requests.length, 0);
});

test('queue action rejects project revision and source-identity changes across root selection', async (context) => {
	const initial = createFramescaperProjectV20(PROFILE, framescaperV20Options());
	const owner = projectOwner(initial);
	const requests: unknown[] = [];
	bindFramescaperNativeRenderQueueActionV20(PROFILE, owner);
	const runtime = framescaperNativeProjectActionRuntimeFor(owner)!;
	installDesktopBridge(context, bridgeFixture({
		requests,
		onSelectRoot: () => {
			owner.project = createFramescaperProjectV20(PROFILE, {
				...framescaperV20Options(), revision: initial.revision + 1,
			});
		},
	}));
	await assert.rejects(() => runtime.run('render-queue-enqueue'), /changed|stale|revision/iu);
	assert.equal(requests.length, 0);

	const original = createFramescaperProjectV20(PROFILE, framescaperV20Options());
	owner.project = original;
	installDesktopBridge(context, bridgeFixture({
		requests,
		onSelectRoot: () => {
			const options = framescaperV20Options();
			(options.sources as Record<string, unknown>[])[0]!.contentSha256 = '34'.repeat(32);
			owner.project = createFramescaperProjectV20(PROFILE, options);
		},
	}));
	await assert.rejects(() => runtime.run('render-queue-enqueue'), /changed|stale|fingerprint/iu);
	assert.equal(requests.length, 0);
});

test('queue action refuses revoked, malformed, and no-longer-authorized roots', async (context) => {
	const project = createFramescaperProjectV20(PROFILE, framescaperV20Options());
	const owner = projectOwner(project);
	const runtime = bindFramescaperNativeRenderQueueActionV20(PROFILE, owner);
	for (const root of [
		{ grantId: ROOT_GRANT_ID, displayName: '/private/authorized-root', revoked: true },
		{ grantId: '../escape', displayName: 'unsafe', revoked: false },
	] as const) {
		installDesktopBridge(context, bridgeFixture({ root }));
		await assert.rejects(() => runtime.run('render-queue-enqueue'), /root|grant|revoked|invalid/iu);
	}
	installDesktopBridge(context, bridgeFixture({ rootAuthorized: false }));
	await assert.rejects(() => runtime.run('render-queue-enqueue'), /root|authorized|changed/iu);
});

test('V7 queue admission abandons a finalized pathless stage after project drift or enqueue refusal', async (context) => {
	const original = createFramescaperProjectV20(PROFILE, framescaperV20Options());
	(original.clips[0] as unknown as Record<string, unknown>).videoKeyframes = opacityKeyframes();
	(original as unknown as Record<string, unknown>).featureRequirements =
		reconcileFramescaperProjectFeatureRequirementsV20(PROFILE, original);
	const owner = projectOwner(original);
	const runtime = bindFramescaperNativeRenderQueueActionV20(PROFILE, owner);
	const abandoned: string[] = [];
	installDesktopBridge(context, bridgeFixture({
		abandoned,
		onStage: () => {
			owner.project = createFramescaperProjectV20(PROFILE, {
				...framescaperV20Options(), revision: original.revision + 1,
			});
		},
	}));
	await assert.rejects(() => runtime.run('render-queue-enqueue'), /changed.*staged/iu);
	assert.deepEqual(abandoned, [STAGE_ID]);

	owner.project = original;
	abandoned.length = 0;
	installDesktopBridge(context, bridgeFixture({
		abandoned,
		enqueueError: new Error('durable enqueue refused'),
	}));
	await assert.rejects(() => runtime.run('render-queue-enqueue'), /durable enqueue refused/iu);
	assert.deepEqual(abandoned, [STAGE_ID]);
});

test('V7 queue admission reports both enqueue and stage-abandon failures', async (context) => {
	const project = createFramescaperProjectV20(PROFILE, framescaperV20Options());
	(project.clips[0] as unknown as Record<string, unknown>).videoKeyframes = opacityKeyframes();
	(project as unknown as Record<string, unknown>).featureRequirements =
		reconcileFramescaperProjectFeatureRequirementsV20(PROFILE, project);
	const owner = projectOwner(project);
	const runtime = bindFramescaperNativeRenderQueueActionV20(PROFILE, owner);
	installDesktopBridge(context, bridgeFixture({
		enqueueError: new Error('enqueue failed'),
		abandonError: new Error('abandon failed'),
	}));
	await assert.rejects(() => runtime.run('render-queue-enqueue'), (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.equal(error.cause, error.errors[0]);
		assert.deepEqual(error.errors.map((entry) => (entry as Error).message), [
			'enqueue failed', 'abandon failed',
		]);
		return true;
	});
});

function projectOwner(project: FramescaperProjectV20) {
	return {
		project,
		prepareNativeRenderInputsV20: async () => {
			const carrier = new Blob([new Uint8Array([1, 2, 3])]);
			const audio = new Blob([new Uint8Array([4, 5])]);
			return Object.freeze([
				Object.freeze({ role: 'evaluated-rgba-frame-pack' as const,
					byteLength: carrier.size, sha256: '56'.repeat(32), bytes: carrier }),
				Object.freeze({ role: 'staged-audio-mix' as const,
					byteLength: audio.size, sha256: '78'.repeat(32), bytes: audio }),
			]);
		},
	};
}

function bridgeFixture(options: Readonly<{
	readonly requests?: unknown[];
	readonly capabilityReady?: boolean;
	readonly root?: Readonly<{ grantId: string; displayName: string; revoked: boolean }>;
	readonly rootAuthorized?: boolean;
	readonly onSelectRoot?: () => void;
	readonly onStage?: () => void;
	readonly abandoned?: string[];
	readonly enqueueError?: Error;
	readonly abandonError?: Error;
}> = {}) {
	const requests = options.requests ?? [];
	return {
		snapshot: async () => ({
			snapshotVersion: 1, runtimeAvailable: true, nativeMediaEnabled: true,
			queue: [], roots: [], watchRules: [],
		}),
		control: async () => ({}),
		reorder: async () => [],
		remove: async () => true,
		capabilities: async () => createNativeMediaCapabilitySnapshotV1({
			masterEnabled: true,
			entries: [{
				...NATIVE_MEDIA_CAPABILITY_IDS.renderQueue,
				policyCleared: true,
				buildSupported: options.capabilityReady !== false,
				probeSucceeded: true,
				selfTestPassed: true,
				userEnabled: true,
			}],
		}),
		selectRoot: async () => {
			options.onSelectRoot?.();
			return options.root ?? {
				grantId: ROOT_GRANT_ID,
				displayName: '/private/authorized-root',
				revoked: false,
			};
		},
		revalidateRoot: async () => options.rootAuthorized !== false,
		stageRenderInputs: async () => {
			options.onStage?.();
			return Object.freeze({ stageId: STAGE_ID });
		},
		abandonRenderInputs: async ({ stageId }: Readonly<{ stageId: string }>) => {
			if (options.abandonError) throw options.abandonError;
			options.abandoned?.push(stageId);
			return true;
		},
		enqueue: async (request: unknown) => {
			if (options.enqueueError) throw options.enqueueError;
			requests.push(request);
			return {};
		},
	};
}

function installDesktopBridge(context: test.TestContext, nativeServices: unknown): void {
	const original = Object.getOwnPropertyDescriptor(globalThis, 'framescaperDesktop');
	context.after(() => restoreGlobalDesktop(original));
	Object.defineProperty(globalThis, 'framescaperDesktop', {
		configurable: true,
		value: { v1: { nativeServices } },
	});
}

function restoreGlobalDesktop(original: PropertyDescriptor | undefined): void {
	if (original) Object.defineProperty(globalThis, 'framescaperDesktop', original);
	else delete (globalThis as Record<string, unknown>).framescaperDesktop;
}

function requestRecord(value: unknown): Record<string, unknown> {
	assert.ok(value && typeof value === 'object' && !Array.isArray(value));
	return value as Record<string, unknown>;
}
