/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { HelperDataPlaneIoPort } from '../desktop/helper-data-plane-io.ts';
import type { HelperDataPlaneTransferPort } from '../desktop/helper-data-plane-transfer.ts';
import {
	FRAMESCAPER_NATIVE_LIVE_RENDER_REPLAY_OVERHEAD_BYTES,
	FramescaperNativeLiveRenderInputStaging,
} from '../desktop/native-services-live-render-input-staging.ts';
import {
	createFramescaperOpenFxLiveFrameTransformFactory,
	isFramescaperOpenFxLiveFrameTransformAudit,
} from '../desktop/framescaper-openfx-live-frame-transform.ts';
import { createNativeMediaPlanEnvelopeV2 } from '../src/common/editor/native-media-plan-envelope-v2.ts';
import { framescaperOpenFxPluginProjectionV1 } from '../src/common/editor/native-ofx-service-contract.ts';
import { createNativeQueueRecordV3 } from '../src/common/editor/native-queue-record-v3.ts';
import { nativeRgbaFramePackV1ByteLength } from '../src/common/editor/native-rgba-frame-pack-v1-contract.ts';
import { createUnifiedExactRenderPlan } from '../src/common/editor/unified-exact-render-plan.ts';
import { createFramescaperNativeRenderPlanAuthorityV28 } from '../src/framescaper/editor-native-render-plan-authority-v28.ts';
import { createFramescaperProjectUnifiedExactRenderPlanV28 } from '../src/framescaper/editor-project-unified-render-plan-v28.ts';
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v28.ts';
import { createFramescaperProjectV28 } from '../src/framescaper/editor-project-v28.ts';
import { streamFramescaperNativeRgbaFramePackV1 } from '../src/framescaper/native-render-frame-pack-v1.ts';
import type {
	FramescaperNativeRenderDeliveryRequestV28,
} from '../src/framescaper/editor-native-project-action-requests-v28.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

const STAGE_ID = 'ab'.repeat(20);
const OWNER = Object.freeze({ renderer: 28 });
const OPENFX_SHA = 'a1'.repeat(32);
const OPENFX_HANDLE = '12'.repeat(20);

test('live V14 staging durably authenticates one bounded carrier for repeat native attempts', async () => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-live-v14-'));
	try {
		const fixture = liveFixture();
		const staging = new FramescaperNativeLiveRenderInputStaging({
			root, mintStageId: () => STAGE_ID,
			createMessageChannel: () => {
				const [host, helper] = portPair();
				return { hostPort: host, helperPort: helper };
			},
		});
		const admission = await staging.beginLive(OWNER, beginRequest(fixture));
		assert.equal(admission.carrierByteLength, fixture.carrierByteLength);
		assert.equal(admission.scratchByteLength,
			fixture.carrierByteLength + FRAMESCAPER_NATIVE_LIVE_RENDER_REPLAY_OVERHEAD_BYTES);
		assert.deepEqual(admission.streams, [{
			role: 'evaluated-rgba-frame-pack', byteLength: fixture.carrierByteLength,
		}]);
		await staging.finalize(OWNER, { stageId: STAGE_ID });
		await staging.claim(OWNER, claimRequest(fixture));
		const record = queueRecord(fixture);
		assert.equal(await staging.revalidate(record), true);
		const derived = await staging.inspect(record);
		assert.equal(derived.scratchByteLength, admission.scratchByteLength);
		let materialized = false;
		const firstMaterialization = derived.materialize(root).then((value) => {
			materialized = true; return value;
		});
		const chunks = await carrierChunks(fixture);
		let sequence = 0; let offset = 0; let firstSettled = false;
		const firstWrite = staging.writeLive(OWNER, {
			stageId: STAGE_ID, role: 'evaluated-rgba-frame-pack', sequence, offset, bytes: chunks[0]!,
		}).then((value) => { firstSettled = true; return value; });
		await firstWrite;
		assert.equal(firstSettled, true, 'main acknowledges only after its bounded awaited spool write');
		assert.equal(materialized, false, 'native attempts wait for the authenticated trailer');
		sequence += 1; offset += chunks[0]!.byteLength;
		for (const bytes of chunks.slice(1)) {
			await staging.writeLive(OWNER, {
				stageId: STAGE_ID, role: 'evaluated-rgba-frame-pack', sequence, offset, bytes,
			});
			sequence += 1; offset += bytes.byteLength;
		}
		const streamed = await carrierResult(fixture);
		assert.deepEqual(await staging.completeLive(OWNER, {
			stageId: STAGE_ID, role: 'evaluated-rgba-frame-pack',
			byteLength: streamed.byteLength, sha256: streamed.sha256,
		}), { byteLength: streamed.byteLength, sha256: streamed.sha256 });
		const firstGrants = await firstMaterialization;
		const secondGrants = await derived.materialize(root);
		const firstGrant = firstGrants[0]; const secondGrant = secondGrants[0];
		if (firstGrant?.type !== 'file' || secondGrant?.type !== 'file') {
			throw new Error('A completed live stage returned no replayable exact file.');
		}
		assert.deepEqual(firstGrant.identity, secondGrant.identity);
		assert.equal(firstGrant.sha256, streamed.sha256);
		assert.equal((await readFile(firstGrant.path)).byteLength, fixture.carrierByteLength);
		await staging.settle(record, 'succeeded');
		assert.equal(await staging.revalidate(record), false);
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('selected V28 image-sequence delivery revalidates its live carrier while proxy custody stays refused', async () => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-live-v14-image-sequence-'));
	try {
		const fixture = liveFixture(false, Object.freeze({
			kind: 'image-sequence', format: 'png',
			frameRate: Object.freeze({ num: 1, den: 1 }), preserveAlpha: true,
		}));
		const staging = new FramescaperNativeLiveRenderInputStaging({
			root, mintStageId: () => STAGE_ID,
			createMessageChannel: () => { throw new Error('durable replay opens no helper port'); },
		});
		await staging.beginLive(OWNER, beginRequest(fixture));
		await staging.finalize(OWNER, { stageId: STAGE_ID });
		await staging.claim(OWNER, claimRequest(fixture));
		const imageSequence = queueRecord(fixture, 'image-sequence-export');
		assert.equal(await staging.revalidate(imageSequence), true);
		const derived = await staging.inspect(imageSequence);
		const materialized = derived.materialize(root);
		let sequence = 0; let offset = 0;
		for (const bytes of await carrierChunks(fixture)) {
			await staging.writeLive(OWNER, {
				stageId: STAGE_ID, role: 'evaluated-rgba-frame-pack', sequence, offset, bytes,
			});
			sequence += 1; offset += bytes.byteLength;
		}
		const trailer = await carrierResult(fixture);
		await staging.completeLive(OWNER, {
			stageId: STAGE_ID, role: 'evaluated-rgba-frame-pack',
			byteLength: trailer.byteLength, sha256: trailer.sha256,
		});
		const [grant] = await materialized;
		assert.equal(grant?.type, 'file');
		assert.equal(grant?.sha256, trailer.sha256);
		const proxy = queueRecord(fixture, 'proxy-generation');
		assert.equal(await staging.revalidate(proxy), false);
		await assert.rejects(() => staging.inspect(proxy), /queue record|stage disagrees/iu);
		await staging.settle(imageSequence, 'succeeded');
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('live V14 OpenFX mounting authenticates renderer input separately from transformed helper bytes', async () => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-live-v14-openfx-'));
	try {
		const fixture = liveFixture(true);
		const factory = createFramescaperOpenFxLiveFrameTransformFactory({
			inventory: () => [openFxPlugin()],
			execute: async (request) => {
				const rgba = Uint8Array.from(request.inputs[0]!.rgba, (value) => 255 - value);
				return {
					mode: 'render', availability: 'available', authoredStatePreserved: true,
					reportsDegradation: false, backend: 'cpu', retriedOnCpu: false,
					output: { streamId: '34'.repeat(20), ...byteDescriptor(rgba) }, rgba,
				};
			},
		});
		const staging = new FramescaperNativeLiveRenderInputStaging({
			root, mintStageId: () => STAGE_ID, openFxTransformFactory: factory,
			createMessageChannel: () => {
				const [host, helper] = portPair(); return { hostPort: host, helperPort: helper };
			},
		});
		await staging.beginLive(OWNER, beginRequest(fixture));
		await staging.finalize(OWNER, { stageId: STAGE_ID });
		await staging.claim(OWNER, claimRequest(fixture));
		const derived = await staging.inspect(queueRecord(fixture));
		const materialized = derived.materialize(root);
		let sequence = 0; let offset = 0;
		for (const bytes of await carrierChunks(fixture)) {
			await staging.writeLive(OWNER, {
				stageId: STAGE_ID, role: 'evaluated-rgba-frame-pack', sequence, offset, bytes,
			});
			sequence += 1; offset += bytes.byteLength;
		}
		const renderer = await carrierResult(fixture);
		const rendererTrailer = Object.freeze({
			byteLength: renderer.byteLength, sha256: renderer.sha256,
		});
		assert.deepEqual(await staging.completeLive(OWNER, {
			stageId: STAGE_ID, role: 'evaluated-rgba-frame-pack', ...rendererTrailer,
		}), rendererTrailer, 'renderer acknowledgement remains bound to the pre-transform trailer');
		await new Promise((resolve) => setImmediate(resolve));
		const audit = staging.openFxTransformAudit(STAGE_ID);
		assert.equal(isFramescaperOpenFxLiveFrameTransformAudit(audit), true);
		assert.deepEqual(audit?.rendererInput, rendererTrailer);
		const grant = (await materialized)[0];
		if (grant?.type !== 'file') throw new Error('OpenFX live stage returned no replayable video file.');
		const native = new Uint8Array(await readFile(grant.path));
		assert.deepEqual(audit?.transformedOutput, byteDescriptor(native));
		assert.notEqual(audit?.rendererInput.sha256, audit?.transformedOutput.sha256);
		assert.deepEqual([...native.subarray(native.byteLength - 16)], Array(16).fill(254));
		await staging.settle(queueRecord(fixture), 'succeeded');

		const unavailable = new FramescaperNativeLiveRenderInputStaging({
			root, mintStageId: () => STAGE_ID,
			createMessageChannel: () => { const [host, helper] = portPair(); return { hostPort: host, helperPort: helper }; },
		});
		const unavailableAdmission = await unavailable.beginLive(OWNER, beginRequest(fixture));
		assert.equal(unavailableAdmission.carrierByteLength,
			fixture.carrierByteLength,
			'evaluated renderer bytes pass through once when no legacy final-carrier transform is mounted');
		await unavailable.abandon(OWNER, { stageId: unavailableAdmission.stageId });
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('live V14 owner revocation cancels a pending replay and restart reclaims incomplete authority', async () => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-live-v14-cancel-'));
	try {
		const fixture = liveFixture();
		const staging = new FramescaperNativeLiveRenderInputStaging({
			root, mintStageId: () => STAGE_ID,
			createMessageChannel: () => { const [host, helper] = portPair(); return {
				hostPort: host, helperPort: helper,
			}; },
		});
		await staging.beginLive(OWNER, beginRequest(fixture));
		await staging.finalize(OWNER, { stageId: STAGE_ID });
		await staging.claim(OWNER, claimRequest(fixture));
		const derived = await staging.inspect(queueRecord(fixture));
		const refused = assert.rejects(derived.materialize(root), /cancel|disposed|ended/iu);
		const [first] = await carrierChunks(fixture);
		await staging.writeLive(OWNER, {
			stageId: STAGE_ID, role: 'evaluated-rgba-frame-pack', sequence: 0, offset: 0, bytes: first!,
		});
		assert.equal(await staging.abandonOwner(OWNER), 1);
		await refused;
		const restarted = new FramescaperNativeLiveRenderInputStaging({
			root, mintStageId: () => { throw new Error('restart must not mint'); },
			createMessageChannel: () => { throw new Error('restart must not open ports'); },
		});
		assert.equal((await restarted.reclaim([])).preservedStages, 0);
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('live V14 regeneration reuses only its explicit paused durable job identity', async () => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-live-v14-regenerate-'));
	try {
		const fixture = liveFixture();
		const restartJobId = 'cd'.repeat(20);
		const staging = new FramescaperNativeLiveRenderInputStaging({
			root, mintStageId: () => { throw new Error('regeneration must not mint a new job'); },
			createMessageChannel: () => { const [host, helper] = portPair(); return {
				hostPort: host, helperPort: helper,
			}; },
		});
		const admission = await staging.beginLive(OWNER, {
			...beginRequest(fixture), restartJobId,
		});
		assert.equal(admission.stageId, restartJobId);
		await staging.abandon(OWNER, { stageId: restartJobId });
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('live V14 replay refuses sampled disk exhaustion before it creates queue authority', async () => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-live-v14-space-'));
	try {
		const fixture = liveFixture();
		const staging = new FramescaperNativeLiveRenderInputStaging({
			root, mintStageId: () => STAGE_ID,
			createMessageChannel: () => { throw new Error('durable replay opens no helper port'); },
			availableBytes: async () => fixture.carrierByteLength - 1,
		});
		await assert.rejects(
			() => staging.beginLive(OWNER, beginRequest(fixture)),
			/insufficient.*free space/iu,
		);
		assert.equal((await staging.reclaim([])).scannedStages, 0);
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('live V14 replay invokes full main storage admission before creating its spool', async () => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-live-v14-admission-'));
	try {
		const fixture = liveFixture();
		let calls = 0;
		const staging = new FramescaperNativeLiveRenderInputStaging({
			root, mintStageId: () => STAGE_ID,
			createMessageChannel: () => { throw new Error('durable replay opens no helper port'); },
			availableBytes: async () => 20 * 1024 ** 3,
			storageAdmission: async (request, replayBytes, outstandingBytes, availableBytes) => {
				calls += 1;
				assert.equal(request.planFingerprint, fixture.envelope.fingerprint);
				assert.equal(replayBytes, fixture.carrierByteLength
					+ FRAMESCAPER_NATIVE_LIVE_RENDER_REPLAY_OVERHEAD_BYTES);
				assert.equal(outstandingBytes, 0);
				assert.equal(availableBytes, 20 * 1024 ** 3);
				throw new Error('full working reservation unavailable');
			},
		});
		await assert.rejects(() => staging.beginLive(OWNER, beginRequest(fixture)),
			/full working reservation/iu);
		assert.equal(calls, 1);
		assert.equal((await staging.reclaim([])).scannedStages, 0);
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('live V14 replay reauthenticates digest and identity before every attempt', async () => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-live-v14-tamper-'));
	try {
		const fixture = liveFixture();
		const staging = new FramescaperNativeLiveRenderInputStaging({
			root, mintStageId: () => STAGE_ID,
			createMessageChannel: () => { throw new Error('durable replay opens no helper port'); },
		});
		await staging.beginLive(OWNER, beginRequest(fixture));
		await staging.finalize(OWNER, { stageId: STAGE_ID });
		await staging.claim(OWNER, claimRequest(fixture));
		const record = queueRecord(fixture);
		const derived = await staging.inspect(record);
		let sequence = 0; let offset = 0;
		for (const bytes of await carrierChunks(fixture)) {
			await staging.writeLive(OWNER, {
				stageId: STAGE_ID, role: 'evaluated-rgba-frame-pack', sequence, offset, bytes,
			});
			sequence += 1; offset += bytes.byteLength;
		}
		const trailer = await carrierResult(fixture);
		await staging.completeLive(OWNER, {
			stageId: STAGE_ID, role: 'evaluated-rgba-frame-pack',
			byteLength: trailer.byteLength, sha256: trailer.sha256,
		});
		const grant = (await derived.materialize(root))[0];
		if (grant?.type !== 'file') throw new Error('The tamper fixture returned no replay file.');
		await writeFile(grant.path, new Uint8Array(grant.bytes), { flag: 'w' });
		await assert.rejects(() => derived.materialize(root), /digest|changed/iu);
		await assert.rejects(() => derived.materialize(root), /digest|changed/iu,
			'a failed authentication poisons replay authority and never refunds its reservation');
		await staging.settle(record, 'failed');
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('live V14 replay atomically admits only two of three concurrent native attempts', async () => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-live-v14-concurrent-'));
	try {
		const fixture = liveFixture();
		const staging = new FramescaperNativeLiveRenderInputStaging({
			root, mintStageId: () => STAGE_ID,
			createMessageChannel: () => { throw new Error('durable replay opens no helper port'); },
		});
		await staging.beginLive(OWNER, beginRequest(fixture));
		await staging.finalize(OWNER, { stageId: STAGE_ID });
		await staging.claim(OWNER, claimRequest(fixture));
		const record = queueRecord(fixture);
		const derived = await staging.inspect(record);
		let sequence = 0; let offset = 0;
		for (const bytes of await carrierChunks(fixture)) {
			await staging.writeLive(OWNER, {
				stageId: STAGE_ID, role: 'evaluated-rgba-frame-pack', sequence, offset, bytes,
			});
			sequence += 1; offset += bytes.byteLength;
		}
		const trailer = await carrierResult(fixture);
		await staging.completeLive(OWNER, {
			stageId: STAGE_ID, role: 'evaluated-rgba-frame-pack',
			byteLength: trailer.byteLength, sha256: trailer.sha256,
		});
		const attempts = await Promise.allSettled([
			derived.materialize(root), derived.materialize(root), derived.materialize(root),
		]);
		const fulfilled = attempts.filter((result) => result.status === 'fulfilled');
		const rejected = attempts.filter((result) => result.status === 'rejected');
		assert.equal(fulfilled.length, 2);
		assert.equal(rejected.length, 1);
		assert.match(String((rejected[0] as PromiseRejectedResult).reason),
			/only hardware and one CPU attempt/iu);
		await staging.settle(record, 'succeeded');
	} finally { await rm(root, { recursive: true, force: true }); }
});

function liveFixture(
	withOpenFx = false,
	delivery?: FramescaperNativeRenderDeliveryRequestV28,
) {
	const options = framescaperV20Options();
	options.sources = (options.sources as Array<Record<string, unknown>>).filter(({ kind }) => kind === 'video')
		.map((source) => ({
			...source, width: 2, height: 2, sourceFrameCount: 1, frameRate: { num: 1, den: 1 },
			timingDecision: { mode: 'conform-cfr-at-ingest', rate: { num: 1, den: 1 } },
		}));
	options.clips = (options.clips as Array<Record<string, unknown>>).filter(({ kind }) => kind === 'video')
		.map((clip) => ({ ...clip, sequenceFrameCount: 1, sourceFrameCount: 1 }));
	options.projectBin = { clips: ((options.projectBin as { clips: Array<Record<string, unknown>> }).clips)
		.map((clip) => ({ ...clip, sequenceFrameCount: 1, sourceFrameCount: 1 })) };
	options.tracks = (options.tracks as Array<Record<string, unknown>>).filter(({ type }) => type === 'video');
	options.sequences = [{ id: 'main-sequence', rate: { num: 1, den: 1 }, trackIds: ['video-track'] }];
	if (withOpenFx) options.ofxEffects = [openFxEffect()];
	const project = createFramescaperProjectV28(FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE, options);
	const created = createFramescaperProjectUnifiedExactRenderPlanV28(
		FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE, project,
		createFramescaperNativeRenderPlanAuthorityV28(project, delivery), delivery,
	);
	let plan = created;
	if (withOpenFx) {
		const raw = structuredClone(created) as unknown as Record<string, unknown>;
		const output = raw.output as Record<string, unknown>;
		output.canvas = { ...(output.canvas as Record<string, unknown>), width: 2, height: 2 };
		const finishing = (raw.nodes as Array<Record<string, unknown>>)
			.find(({ kind }) => kind === 'finishing')!;
		Object.assign((finishing.sourceInterpretations as Array<Record<string, unknown>>)[0]!, {
			primaries: 'bt709', transfer: 'bt709', matrix: 'rgb', range: 'full',
			provenance: 'user-override',
		});
		const validated = createUnifiedExactRenderPlan(raw);
		if (validated.version !== 14) throw new Error('OpenFX fixture plan is not V14.');
		plan = validated as typeof created;
	}
	const envelope = createNativeMediaPlanEnvelopeV2(plan);
	const carrierByteLength = nativeRgbaFramePackV1ByteLength({
		width: envelope.summary.width, height: envelope.summary.height,
		frameCount: envelope.summary.outputFrameCount,
	});
	return { project, plan, envelope, carrierByteLength };
}

function openFxEffect() {
	return {
		schemaVersion: 1, instanceId: 'ofx-instance', pluginId: 'net.example.Filter',
		binarySha256: OPENFX_SHA, context: 'filter',
		attachment: { kind: 'filter', targetId: 'video-clip' },
		inputs: [{ name: 'Source', sourceRef: 'video-source' }], parameters: [],
		customEncodings: {}, enabled: true,
		freshness: {
			authoredStateSha256: OPENFX_SHA, inputIdentitiesSha256: 'b2'.repeat(32),
			renderPlanFingerprintSha256: 'c3'.repeat(32), nativeEffectFingerprintSha256: 'd4'.repeat(32),
		}, frozenFallback: null,
	};
}

function openFxPlugin() {
	return framescaperOpenFxPluginProjectionV1({
		pluginHandle: OPENFX_HANDLE, pluginId: 'net.example.Filter', vendor: 'Example',
		version: { major: 1, minor: 0 }, binarySha256: OPENFX_SHA,
		supportedContexts: ['filter'], parameters: [], components: ['RGBA'], pixelDepths: ['byte'],
		threading: 'instance-safe', state: 'enabled', quarantined: false,
	});
}

function byteDescriptor(bytes: Uint8Array) {
	return Object.freeze({
		byteLength: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex'),
	});
}

function beginRequest(fixture: ReturnType<typeof liveFixture>) {
	return Object.freeze({
		liveRenderVersion: 1 as const, planVersion: 14 as const,
		planFingerprint: fixture.envelope.fingerprint,
		planPayload: JSON.stringify(fixture.plan), projectId: fixture.project.id,
		projectRevision: fixture.project.revision,
		inputFingerprints: [{ sourceId: 'video-source', sha256: '12'.repeat(32) }],
		restartJobId: null,
		carrierByteLength: fixture.carrierByteLength, audio: null,
	});
}

function claimRequest(fixture: ReturnType<typeof liveFixture>) {
	const begin = beginRequest(fixture);
	return Object.freeze({
		derivedInputStageId: STAGE_ID, planVersion: 14 as const,
		planFingerprint: begin.planFingerprint, planPayload: begin.planPayload,
		projectId: begin.projectId, projectRevision: begin.projectRevision,
		inputFingerprints: begin.inputFingerprints,
	});
}

function queueRecord(
	fixture: ReturnType<typeof liveFixture>,
	taskKind: 'encoded-export' | 'image-sequence-export' | 'proxy-generation' = 'encoded-export',
) {
	return createNativeQueueRecordV3({
		jobId: STAGE_ID, taskKind, plan: fixture.plan,
		projectId: String(fixture.project.id), projectRevision: Number(fixture.project.revision),
		inputFingerprints: [{ sourceId: 'video-source', sha256: '12'.repeat(32) }],
		rootGrantId: 'cd'.repeat(16), relativeDestination: taskKind === 'image-sequence-export'
			? 'renders/live-png' : 'renders/live.mov',
		reservations: { cpuCores: 2, processTreeRssBytes: 1024 ** 3,
			scratchBytes: 32 * 1024 ** 3, minimumFreeBytes: 0, hardwareBackend: null },
		...(taskKind === 'image-sequence-export'
			? { recoveryClass: 'verified-frame-checkpoint' as const } : {}),
		position: 0, createdAtMs: 1,
	});
}

async function carrierChunks(fixture: ReturnType<typeof liveFixture>): Promise<readonly Uint8Array[]> {
	const chunks: Uint8Array[] = [];
	await streamFramescaperNativeRgbaFramePackV1(carrierRequest(fixture), {
		write: (bytes) => { chunks.push(new Uint8Array(bytes)); },
	});
	return chunks;
}

function carrierResult(fixture: ReturnType<typeof liveFixture>) {
	return streamFramescaperNativeRgbaFramePackV1(carrierRequest(fixture), { write: () => undefined });
}

function carrierRequest(fixture: ReturnType<typeof liveFixture>) {
	const rate = fixture.envelope.summary.frameRate;
	if (rate.kind !== 'rational') throw new Error('Fixture cadence is not rational.');
	return {
		width: fixture.envelope.summary.width, height: fixture.envelope.summary.height,
		frameCount: fixture.envelope.summary.outputFrameCount,
		frameRate: { num: rate.num, den: rate.den }, signal: new AbortController().signal,
		assertCurrent: () => undefined,
		renderFrame: (ordinal: number, output: Uint8Array) => { output.fill(ordinal + 1); },
	};
}

class Port extends EventEmitter implements HelperDataPlaneIoPort, HelperDataPlaneTransferPort {
	peer: Port | null = null;
	postMessage(message: unknown): void { queueMicrotask(() => this.peer?.emit('message', { data: message })); }
	start(): void {}
	close(): void { this.emit('close'); }
}

function portPair(): readonly [Port, Port] {
	const left = new Port(); const right = new Port(); left.peer = right; right.peer = left;
	return [left, right];
}
