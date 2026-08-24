/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import {
	createNativeMediaCapabilitySnapshotV1,
	NATIVE_MEDIA_CAPABILITY_IDS,
} from '../src/common/editor/native-media-capability-snapshot.ts';
import {
	framescaperNativeProjectActionRuntimeFor,
	runFramescaperNativeCarrierRegeneration,
} from '../src/common/editor/ui/framescaper-native-project-actions.ts';
import { bindFramescaperNativeRenderQueueActionV28 } from '../src/framescaper/editor-native-render-queue-action-v28.ts';
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v28.ts';
import { createFramescaperProjectV28, type FramescaperProjectV28 } from '../src/framescaper/editor-project-v28.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

const ROOT_ID = 'ab'.repeat(16);
const STAGE_ID = 'cd'.repeat(20);
const PROFILE = FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE;

test('selected V28 reserves, enqueues, then directly streams one evaluated V14 carrier', async (context) => {
	const owner = projectOwner(projectFixture());
	const staged: unknown[] = [];
	const enqueued: unknown[] = [];
	const events: string[] = [];
	installBridge(context, bridgeFixture({ staged, enqueued, events }));
	const runtime = bindFramescaperNativeRenderQueueActionV28(PROFILE, owner);
	assert.equal(framescaperNativeProjectActionRuntimeFor(owner), runtime);
	assert.deepEqual(runtime.surfaces, ['render-queue-enqueue']);

	await runtime.run('render-queue-enqueue');
	assert.equal(staged.length, 1);
	assert.equal(enqueued.length, 1);
	const stage = record(staged[0]);
	const request = record(enqueued[0]);
	assert.equal(stage.planVersion, 14);
	assert.equal(request.planVersion, 14);
	assert.equal(request.derivedInputStageId, STAGE_ID);
	assert.equal(request.planPayload, stage.planPayload);
	assert.equal(request.planFingerprint, stage.planFingerprint);
	assert.equal(record(request.reservations).scratchBytes, 64 * 1_024 + 9);
	assert.equal(request.relativeDestination, 'renders/framescaper-framescaper-v28-r0.mov');
	const plan = record(JSON.parse(String(request.planPayload)));
	assert.deepEqual(plan.format, {
		container: 'mov', extension: 'mov', mimeType: 'video/quicktime',
	});
	assert.deepEqual(plan.codecs, {
		video: 'prores', videoEncoder: 'prores_ks', audio: 'pcm_s16le', audioEncoder: 'pcm_s16le',
		pixelFormat: 'yuv422p10le',
	});
	assert.equal(stage.liveRenderVersion, 1);
	assert.equal(stage.restartJobId, null);
	assert.equal(stage.carrierByteLength, 6);
	assert.equal(record(stage.audio).role, 'staged-audio-mix');
	assert.equal(String(request.planPayload).includes('/private/'), false);
	assert.deepEqual(events.slice(0, 2), ['main-live-stage:reserved', 'v3-enqueue']);
	assert.deepEqual(events.filter((event) => event.startsWith('native-sink:')).sort(), [
		'native-sink:evaluated-rgba-frame-pack:0', 'native-sink:evaluated-rgba-frame-pack:1',
		'native-sink:staged-audio-mix:0',
	]);
	assert.deepEqual(events.filter((event) => event.startsWith('main-live-stage:complete:')).sort(), [
		'main-live-stage:complete:evaluated-rgba-frame-pack',
		'main-live-stage:complete:staged-audio-mix',
	]);
});

test('selected V28 regenerates a paused carrier under the exact durable job identity', async (context) => {
	const owner = projectOwner(projectFixture());
	const staged: unknown[] = []; const enqueued: unknown[] = [];
	const restartJobId = 'ef'.repeat(20);
	installBridge(context, bridgeFixture({ staged, enqueued, queue: [{
		jobId: restartJobId, taskKind: 'encoded-export', projectId: 'framescaper-v28',
		relativeDestination: 'renders/framescaper-framescaper-v28-r0.mov', state: 'paused',
		position: 0, progress: null, attempt: 1,
		lastFailureCode: 'awaiting-carrier-regeneration',
	}] }));
	const runtime = bindFramescaperNativeRenderQueueActionV28(PROFILE, owner);
	await runFramescaperNativeCarrierRegeneration(runtime, restartJobId);
	assert.equal(record(staged[0]).restartJobId, restartJobId);
	assert.equal(record(enqueued[0]).derivedInputStageId, restartJobId);
});

test('selected V28 restores an exact 60000/1001 OpenEXR carrier from its durable destination', async (context) => {
	const staged: unknown[] = []; const enqueued: unknown[] = [];
	const restartJobId = 'fa'.repeat(20);
	const destination = 'renders/framescaper-framescaper-v28-r0-60000-1001-openexr';
	installBridge(context, bridgeFixture({ staged, enqueued, queue: [{
		jobId: restartJobId, taskKind: 'image-sequence-export', projectId: 'framescaper-v28',
		relativeDestination: destination, state: 'paused', position: 0, progress: null,
		attempt: 1, lastFailureCode: 'awaiting-carrier-regeneration',
	}] }));
	const runtime = bindFramescaperNativeRenderQueueActionV28(PROFILE, projectOwner(projectFixture()));
	await runFramescaperNativeCarrierRegeneration(runtime, restartJobId);
	const stage = record(staged[0]);
	const request = record(enqueued[0]);
	const plan = record(JSON.parse(String(stage.planPayload)));
	assert.equal(stage.restartJobId, restartJobId);
	assert.equal(request.taskKind, 'image-sequence-export');
	assert.equal(request.relativeDestination, destination);
	assert.equal(plan.deliveryProfile, 'encode-openexr-sequence');
	assert.deepEqual(record(plan.output).frameRate, { num: 60_000, den: 1_001 });
});

test('selected V28 refuses a forged or stale carrier regeneration job before staging', async (context) => {
	const owner = projectOwner(projectFixture());
	const staged: unknown[] = [];
	installBridge(context, bridgeFixture({ staged, enqueued: [] }));
	const runtime = bindFramescaperNativeRenderQueueActionV28(PROFILE, owner);
	await assert.rejects(
		() => runFramescaperNativeCarrierRegeneration(runtime, 'ef'.repeat(20)),
		/exact paused queue job/u,
	);
	assert.deepEqual(staged, []);
});

test('selected V28 sends the closed legacy-unmanaged full-frame family directly to native CPU', async (context) => {
	const owner = projectOwner(legacyUnmanagedProjectFixture());
	const staged: unknown[] = [];
	const enqueued: unknown[] = [];
	installBridge(context, bridgeFixture({ staged, enqueued }));
	const runtime = bindFramescaperNativeRenderQueueActionV28(PROFILE, owner);
	await runtime.run('render-queue-enqueue');
	assert.deepEqual(staged, []);
	assert.equal(enqueued.length, 1);
	assert.equal(record(enqueued[0]).derivedInputStageId, null);
});

for (const delivery of [
	{
		format: 'png', profile: 'encode-png-sequence', extension: 'png', mimeType: 'image/png',
		video: 'png', pixelFormat: 'rgba64be',
	},
	{
		format: 'tiff', profile: 'encode-tiff-sequence', extension: 'tiff', mimeType: 'image/tiff',
		video: 'tiff', pixelFormat: 'rgba64le',
	},
	{
		format: 'openexr', profile: 'encode-openexr-sequence', extension: 'exr', mimeType: 'image/x-exr',
		video: 'exr', pixelFormat: 'gbrapf32le',
	},
] as const) {
	test(`selected V28 enqueues one exact alpha ${delivery.format} output tree`, async (context) => {
		const owner = projectOwner(projectFixture());
		const staged: unknown[] = [];
		const enqueued: unknown[] = [];
		installBridge(context, bridgeFixture({ staged, enqueued }));
		const runtime = bindFramescaperNativeRenderQueueActionV28(PROFILE, owner);

		await runtime.run('render-queue-enqueue', {
			kind: 'image-sequence', format: delivery.format,
			frameRate: { num: 60_000, den: 1_001 }, preserveAlpha: true,
		});
		assert.equal(staged.length, 1);
		assert.equal(enqueued.length, 1);
		const request = record(enqueued[0]);
		assert.equal(request.taskKind, 'image-sequence-export');
		assert.equal(request.recoveryClass, 'verified-frame-checkpoint');
		assert.equal(request.relativeDestination,
			`renders/framescaper-framescaper-v28-r0-60000-1001-${delivery.format}`);
		const plan = record(JSON.parse(String(request.planPayload)));
		assert.equal(plan.deliveryProfile, delivery.profile);
		assert.deepEqual(plan.format, {
			container: 'image2', extension: delivery.extension, mimeType: delivery.mimeType,
		});
		assert.deepEqual(plan.codecs, {
			video: delivery.video, videoEncoder: delivery.video, audio: null, audioEncoder: null,
			pixelFormat: delivery.pixelFormat,
		});
		assert.deepEqual(record(plan.output).frameRate, { num: 60_000, den: 1_001 });
		assert.equal(record(plan.output).includeAudio, false);
		assert.equal(record(record(plan.output).canvas).backgroundColor, '#00000000');
		assert.equal(record(staged[0]).audio, null);
	});
}

test('selected V28 refuses malformed image delivery intent before selecting a root or staging', async (context) => {
	const selectedRoots: string[] = [];
	const staged: unknown[] = [];
	const enqueued: unknown[] = [];
	installBridge(context, bridgeFixture({ staged, enqueued, selectedRoots }));
	const runtime = bindFramescaperNativeRenderQueueActionV28(PROFILE, projectOwner(projectFixture()));
	for (const request of [
		{ kind: 'image-sequence', format: 'jpeg', frameRate: { num: 24, den: 1 }, preserveAlpha: true },
		{ kind: 'image-sequence', format: 'png', frameRate: { num: 48_000, den: 2_002 }, preserveAlpha: true },
		{ kind: 'image-sequence', format: 'png', frameRate: { num: 1_000_001, den: 1 }, preserveAlpha: true },
		{ kind: 'image-sequence', format: 'png', frameRate: { num: 24, den: 1 }, preserveAlpha: false },
	] as const) {
		await assert.rejects(
			() => runtime.run('render-queue-enqueue', request),
			/format|rate|rational|alpha/iu,
		);
	}
	let accessorReads = 0;
	const accessor = Object.create(null) as Record<string, unknown>;
	Object.defineProperty(accessor, 'kind', { enumerable: true, get() { accessorReads += 1; return 'encoded-mov'; } });
	await assert.rejects(() => runtime.run('render-queue-enqueue', accessor), /data property/iu);
	assert.equal(accessorReads, 0);
	assert.deepEqual(selectedRoots, []);
	assert.deepEqual(staged, []);
	assert.deepEqual(enqueued, []);
});

test('selected V28 abandons its authenticated carrier if durable enqueue refuses', async (context) => {
	const owner = projectOwner(projectFixture());
	const abandoned: string[] = [];
	installBridge(context, bridgeFixture({
		abandoned,
		enqueueError: new Error('V3 durable enqueue refused'),
	}));
	const runtime = bindFramescaperNativeRenderQueueActionV28(PROFILE, owner);
	await assert.rejects(() => runtime.run('render-queue-enqueue'), /durable enqueue refused/u);
	assert.deepEqual(abandoned, [STAGE_ID]);
});

test('selected V28 cancels the exact claimed queue job when its native sink refuses', async (context) => {
	const owner = projectOwner(projectFixture());
	const abandoned: string[] = [];
	const cancelled: string[] = [];
	installBridge(context, bridgeFixture({
		abandoned, cancelled, writeError: new Error('native stdin stopped'),
	}));
	const runtime = bindFramescaperNativeRenderQueueActionV28(PROFILE, owner);
	await assert.rejects(() => runtime.run('render-queue-enqueue'), /native stdin stopped/u);
	assert.deepEqual(cancelled, [STAGE_ID]);
	assert.deepEqual(abandoned, [], 'a claimed stage is removed only by queue lifecycle settlement');
});

test('selected V28 refuses queue admission without its renderer carrier producer', async (context) => {
	const owner = { project: projectFixture() };
	const enqueued: unknown[] = [];
	installBridge(context, bridgeFixture({ enqueued }));
	const runtime = bindFramescaperNativeRenderQueueActionV28(PROFILE, owner);
	await assert.rejects(() => runtime.run('render-queue-enqueue'), /live evaluated-carrier authority/iu);
	assert.deepEqual(enqueued, []);
});

function projectFixture(): FramescaperProjectV28 {
	return createFramescaperProjectV28(PROFILE, {
		...framescaperV20Options(), id: 'framescaper-v28', title: 'Framescaper V28',
	});
}

function legacyUnmanagedProjectFixture(): FramescaperProjectV28 {
	const options = silentVideoOptions();
	const derived = createFramescaperProjectV28(PROFILE, options);
	return createFramescaperProjectV28(PROFILE, {
		...options,
		finishing: {
			sourceColorInterpretations: derived.videoSourceColorInterpretations.map(
				(interpretation) => ({ ...interpretation, provenance: 'legacy-unmanaged-encoded' }),
			),
		},
	});
}

function silentVideoOptions(): Record<string, unknown> {
	const options = framescaperV20Options();
	options.sources = (options.sources as Array<Record<string, unknown>>).filter(({ kind }) => kind !== 'audio');
	options.clips = (options.clips as Array<Record<string, unknown>>).filter(({ kind }) => kind !== 'audio');
	options.tracks = (options.tracks as Array<Record<string, unknown>>).filter(({ type }) => type !== 'audio');
	options.sequences = (options.sequences as Array<Record<string, unknown>>).map((sequence) => ({
		...sequence, trackIds: (sequence.trackIds as string[]).filter((id) => id !== 'audio-track'),
	}));
	return options;
}

function projectOwner(project: FramescaperProjectV28) {
	return {
		project,
		prepareNativeRenderInputStreamV28: async (request: Readonly<{ planPayload: string }>) => {
			const plan = JSON.parse(request.planPayload) as { version: number; output: { includeAudio: boolean } };
			assert.equal(plan.version, 14);
			return Object.freeze({
				carrierByteLength: 6,
				audio: plan.output.includeAudio ? Object.freeze({
				role: 'staged-audio-mix' as const,
				byteLength: 3,
				stream: async (sink: Readonly<{ write(bytes: Uint8Array): PromiseLike<void> | void }>) => {
					await sink.write(new Uint8Array([7, 8, 9]));
					return Object.freeze({ byteLength: 3, sha256: '57'.repeat(32), chunkCount: 1 });
				},
			}) : null,
				stream: async (sink: Readonly<{ write(bytes: Uint8Array): PromiseLike<void> | void }>) => {
					await sink.write(new Uint8Array([1, 2, 3]));
					await sink.write(new Uint8Array([4, 5, 6]));
					return Object.freeze({ byteLength: 6, sha256: '56'.repeat(32), chunkCount: 2 });
				},
			});
		},
	};
}

function bridgeFixture(options: Readonly<{
	readonly staged?: unknown[];
	readonly enqueued?: unknown[];
	readonly abandoned?: string[];
	readonly cancelled?: string[];
	readonly enqueueError?: Error;
	readonly writeError?: Error;
	readonly events?: string[];
	readonly queue?: readonly unknown[];
	readonly selectedRoots?: string[];
}> = {}) {
	return {
		snapshot: async () => ({
			snapshotVersion: 1, runtimeAvailable: true, nativeMediaEnabled: true,
			queue: options.queue ?? [], roots: [], watchRules: [],
		}),
		control: async (request: Readonly<{ jobId: string }>) => {
			options.cancelled?.push(request.jobId); return {};
		}, reorder: async () => [], remove: async () => true,
		capabilities: async () => createNativeMediaCapabilitySnapshotV1({
			masterEnabled: true,
			entries: [Object.freeze({
				...NATIVE_MEDIA_CAPABILITY_IDS.renderQueue,
				policyCleared: true, buildSupported: true, probeSucceeded: true,
				selfTestPassed: true, userEnabled: true,
			})],
		}),
		selectRoot: async () => {
			options.selectedRoots?.push(ROOT_ID);
			return { grantId: ROOT_ID, displayName: 'Authorized root', revoked: false };
		},
		revalidateRoot: async () => true,
		stageLiveRenderInputs: async (request: unknown) => {
			options.staged?.push(request);
			options.events?.push('main-live-stage:reserved');
			return { stageId: String(record(request).restartJobId ?? STAGE_ID),
				carrierByteLength: Number(record(request).carrierByteLength),
				scratchByteLength: 64 * 1_024 + Number(record(request).carrierByteLength)
					+ (record(request).audio === null ? 0 : Number(record(record(request).audio).byteLength)) };
		},
		writeLiveRenderInput: async (request: Readonly<{
			role: string; sequence: number; offset: number; bytes: Uint8Array;
		}>) => {
			if (options.writeError) throw options.writeError;
			options.events?.push(`native-sink:${request.role}:${String(request.sequence)}`);
			return { sequence: request.sequence, receivedBytes: request.offset + request.bytes.byteLength };
		},
		completeLiveRenderInput: async (request: Readonly<{ role: string; byteLength: number; sha256: string }>) => {
			options.events?.push(`main-live-stage:complete:${request.role}`); return request;
		},
		abandonRenderInputs: async ({ stageId }: Readonly<{ stageId: string }>) => {
			options.abandoned?.push(stageId);
			return true;
		},
		enqueue: async (request: unknown) => {
			if (options.enqueueError) throw options.enqueueError;
			options.events?.push('v3-enqueue');
			options.enqueued?.push(request);
			return {};
		},
	};
}

function installBridge(context: TestContext, nativeServices: unknown): void {
	const prior = Object.getOwnPropertyDescriptor(globalThis, 'framescaperDesktop');
	Object.defineProperty(globalThis, 'framescaperDesktop', {
		configurable: true, value: { v1: { nativeServices } },
	});
	context.after(() => {
		if (prior) Object.defineProperty(globalThis, 'framescaperDesktop', prior);
		else Reflect.deleteProperty(globalThis, 'framescaperDesktop');
	});
}

function record(value: unknown): Record<string, unknown> {
	assert.ok(value && typeof value === 'object' && !Array.isArray(value));
	return value as Record<string, unknown>;
}
