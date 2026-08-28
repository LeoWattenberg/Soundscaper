/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { HelperDataPlaneIoPort } from '../desktop/helper-data-plane-io.ts';
import { sendHelperDataPlaneFile } from '../desktop/helper-data-plane-io.ts';
import { framescaperNativeQueueEnqueueRequest } from '../desktop/native-services-lifecycle.ts';
import {
	FRAMESCAPER_NATIVE_RENDER_INPUT_MAXIMUM_PENDING_STAGES,
	FRAMESCAPER_NATIVE_RENDER_INPUT_STAGE_EXPIRY_MS,
	FRAMESCAPER_NATIVE_RENDER_INPUT_TOTAL_MAXIMUM_BYTES,
	FramescaperNativeRenderInputStaging,
} from '../desktop/native-services-render-input-staging.ts';
import { nativeMediaEvaluatedCarrierCadenceV1 } from '../src/common/editor/native-media-evaluated-carrier-v1.ts';
import { createNativeMediaPlanEnvelopeV1 } from '../src/common/editor/native-media-plan-envelope.ts';
import { createNativeQueueRecordV2 } from '../src/common/editor/native-queue-record.ts';
import { createVideoKeyframeExportPlanV7 } from '../src/common/editor/video-keyframe-export-plan-v7.ts';
import { createUnifiedExactRenderPlan } from '../src/common/editor/unified-exact-render-plan.ts';
import {
	nativeQueueSmallStaticAudioPlanV8,
	nativeQueueSmallStaticPlanV8,
} from './helpers/native-queue-plan-fixture.ts';
import { unifiedExactPlanFixture } from './helpers/unified-exact-render-plan-fixture.ts';
const STAGE_ID = 'ab'.repeat(20);
const OWNER = Object.freeze({ generation: 20 });

test('V7 evaluated RGBA and WAV staging survives restart and materializes exact helper grants', async () => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-render-stage-'));
	const senderRoot = await mkdtemp(join(tmpdir(), 'framescaper-render-sender-'));
	try {
		const plan = keyedPlan(true);
		const envelope = createNativeMediaPlanEnvelopeV1(plan);
		const carrier = framePack(envelope);
		const audio = float32Wav(8_000, 8_000, 2);
		const sources = await sourceFiles(senderRoot, [carrier, audio]);
		const staging = new FramescaperNativeRenderInputStaging({
			root, mintStageId: () => STAGE_ID,
		});
		const admission = await staging.begin(OWNER, beginRequest(envelope, [
			input('evaluated-rgba-frame-pack', carrier), input('staged-audio-mix', audio),
		]));
		assert.equal(admission.stageId, STAGE_ID);
		assert.deepEqual(admission.inputs.map(({ role }) => role), [
			'evaluated-rgba-frame-pack', 'staged-audio-mix',
		]);
		for (const [index, descriptor] of admission.inputs.entries()) {
			const [sender, receiver] = portPair();
			const received = staging.receive(OWNER, {
				stageId: STAGE_ID, inputIndex: index, binding: descriptor.binding,
			}, receiver);
			await sendHelperDataPlaneFile({
				binding: descriptor.binding, port: sender, path: sources[index]!,
			});
			await received;
		}
		await staging.finalize(OWNER, { stageId: STAGE_ID });
		await staging.claim(OWNER, claimRequest(envelope));
		await assert.rejects(() => staging.claim(OWNER, claimRequest(envelope)), /already claimed/iu);

		const record = queueRecord(envelope);
		const restarted = new FramescaperNativeRenderInputStaging({
			root, mintStageId: () => { throw new Error('restart must not mint'); },
		});
		assert.equal(await restarted.revalidate(record), true);
		const destination = join(root, 'queue-scratch');
		await mkdir(destination);
		const inspected = await restarted.inspect(record);
		assert.equal(inspected.byteLength, carrier.byteLength + audio.byteLength);
		const grants = await inspected.materialize(destination);
		assert.deepEqual(grants.map(({ role }) => role), [
			'evaluated-rgba-frame-pack', 'staged-audio-mix',
		]);
		assert.deepEqual(grants.map(({ type }) => type), ['file', 'file']);
		if (grants[0]!.type !== 'file' || grants[1]!.type !== 'file')
			throw new Error('Durable render-input staging must materialize file grants.');
		assert.deepEqual(await readFile(grants[0].path), carrier);
		assert.deepEqual(await readFile(grants[1].path), audio);
	} finally {
		await rm(root, { recursive: true, force: true });
		await rm(senderRoot, { recursive: true, force: true });
	}
});

test('V8 stages audio only, rejects carriers, and silent V8 has no durable stage', async () => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-render-stage-v8-'));
	const senderRoot = await mkdtemp(join(tmpdir(), 'framescaper-render-sender-v8-'));
	try {
		const silentEnvelope = createNativeMediaPlanEnvelopeV1(nativeQueueSmallStaticPlanV8());
		assert.deepEqual(nativeMediaEvaluatedCarrierCadenceV1(silentEnvelope), { num: 2, den: 1 });
		assert.deepEqual(nativeMediaEvaluatedCarrierCadenceV1(
			createNativeMediaPlanEnvelopeV1(nativeQueueSmallStaticPlanV8(29.97)),
		), { num: 2_997, den: 100 });
		assert.throws(() => nativeMediaEvaluatedCarrierCadenceV1(
			createNativeMediaPlanEnvelopeV1(nativeQueueSmallStaticPlanV8(30_000 / 1_001)),
		), /exact V8 cadence.*carrier.*domain/iu);
		const envelope = createNativeMediaPlanEnvelopeV1(nativeQueueSmallStaticAudioPlanV8());
		const audio = float32Wav(1_000, 1_000, 2);
		const [source] = await sourceFiles(senderRoot, [audio]);
		const staging = new FramescaperNativeRenderInputStaging({ root, mintStageId: () => STAGE_ID });
		const admission = await staging.begin(OWNER, beginRequest(envelope, [
			input('staged-audio-mix', audio),
		]));
		assert.deepEqual(admission.inputs.map(({ role }) => role), ['staged-audio-mix']);
		const [sender, receiver] = portPair();
		const received = staging.receive(OWNER, {
			stageId: admission.stageId, inputIndex: 0, binding: admission.inputs[0]!.binding,
		}, receiver);
		await sendHelperDataPlaneFile({ binding: admission.inputs[0]!.binding, port: sender, path: source! });
		await received;
		await staging.finalize(OWNER, { stageId: admission.stageId });
		await staging.claim(OWNER, claimRequest(envelope));
		const record = queueRecord(envelope);
		const restarted = new FramescaperNativeRenderInputStaging({
			root, mintStageId: () => { throw new Error('restart must not mint'); },
		});
		assert.equal(await restarted.revalidate(record), true);
		const inspected = await restarted.inspect(record);
		assert.equal(inspected.byteLength, audio.byteLength);
		await assert.rejects(() => staging.begin(OWNER, beginRequest(silentEnvelope, [
			input('evaluated-rgba-frame-pack', framePack(silentEnvelope)),
		])), /V8|carrier|derived.*audio/iu);
		const silentRecord = queueRecord(silentEnvelope);
		assert.equal(await restarted.revalidate(silentRecord), true);
		await assert.rejects(() => restarted.inspect(silentRecord), /silent V8|no durable derived/iu);
		const silentRequest = queueEnqueueRequest(silentRecord, null);
		assert.equal(framescaperNativeQueueEnqueueRequest(silentRequest).derivedInputStageId, null);
		assert.throws(() => framescaperNativeQueueEnqueueRequest({
			...silentRequest, derivedInputStageId: STAGE_ID,
		}), /silent V8|derived-input stage/iu);

		const unified = createUnifiedExactRenderPlan(unifiedExactPlanFixture(9));
		const unifiedRecord = queueRecord(createNativeMediaPlanEnvelopeV1(unified));
		assert.equal(framescaperNativeQueueEnqueueRequest(
			queueEnqueueRequest(unifiedRecord, null),
		).derivedInputStageId, null);
		assert.throws(() => framescaperNativeQueueEnqueueRequest(
			queueEnqueueRequest(unifiedRecord, STAGE_ID),
		), /unified V9|derived-input stage|durable.*carrier/iu);
		await assert.rejects(
			() => restarted.inspect(unifiedRecord),
			/V9.*evaluated RGBA carrier|evaluated RGBA carrier.*V9/iu,
		);
		await restarted.settle(record, 'cancelled');
		assert.equal(await restarted.revalidate(record), false);
	} finally {
		await rm(root, { recursive: true, force: true });
		await rm(senderRoot, { recursive: true, force: true });
	}
});

test('V7 staging rejects wrong owners, replayed streams, and tampered durable bytes', async () => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-render-stage-hostile-'));
	const senderRoot = await mkdtemp(join(tmpdir(), 'framescaper-render-sender-hostile-'));
	try {
		const envelope = createNativeMediaPlanEnvelopeV1(keyedPlan(false));
		const carrier = framePack(envelope);
		const [source] = await sourceFiles(senderRoot, [carrier]);
		const staging = new FramescaperNativeRenderInputStaging({ root, mintStageId: () => STAGE_ID });
		const admission = await staging.begin(OWNER, beginRequest(envelope, [
			input('evaluated-rgba-frame-pack', carrier),
		]));
		const binding = admission.inputs[0]!.binding;
		const [, refused] = portPair();
		await assert.rejects(() => staging.receive({}, {
			stageId: STAGE_ID, inputIndex: 0, binding,
		}, refused), /owner/iu);
		const [sender, receiver] = portPair();
		const received = staging.receive(OWNER, {
			stageId: STAGE_ID, inputIndex: 0, binding,
		}, receiver);
		await sendHelperDataPlaneFile({ binding, port: sender, path: source! });
		await received;
		const [, replay] = portPair();
		await assert.rejects(() => staging.receive(OWNER, {
			stageId: STAGE_ID, inputIndex: 0, binding,
		}, replay), /already received|replay/iu);
		await staging.finalize(OWNER, { stageId: STAGE_ID });
		await staging.claim(OWNER, claimRequest(envelope));
		const record = queueRecord(envelope);
		await writeFile(join(root, `stage-${STAGE_ID}`, 'input-00.frames'), Buffer.from('tampered'));
		assert.equal(await staging.revalidate(record), false);
		await assert.rejects(() => staging.inspect(record), /changed|digest|length/iu);
	} finally {
		await rm(root, { recursive: true, force: true });
		await rm(senderRoot, { recursive: true, force: true });
	}
});

test('V7 staging refuses missing audio and plan/input identity substitution', async () => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-render-stage-refusal-'));
	try {
		const audioPlan = createNativeMediaPlanEnvelopeV1(keyedPlan(true));
		const carrier = framePack(audioPlan);
		const staging = new FramescaperNativeRenderInputStaging({ root, mintStageId: () => STAGE_ID });
		await assert.rejects(() => staging.begin(OWNER, beginRequest(audioPlan, [
			input('evaluated-rgba-frame-pack', carrier),
		])), /audio/iu);
		await assert.rejects(() => staging.begin(OWNER, {
			...beginRequest(audioPlan, [
				input('evaluated-rgba-frame-pack', carrier),
				input('staged-audio-mix', float32Wav(8_000, 8_000, 2)),
			]),
			planFingerprint: 'ff'.repeat(32),
		}), /plan identity|fingerprint/iu);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('V7 staging bounds pending stages and aggregate declared durable bytes before transfer', async () => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-render-stage-quota-'));
	let nextId = 0;
	try {
		const envelope = createNativeMediaPlanEnvelopeV1(keyedPlan(false));
		const carrier = framePack(envelope);
		const staging = new FramescaperNativeRenderInputStaging({
			root,
			mintStageId: () => String(nextId++).padStart(40, '0'),
		});
		const admissions = [];
		for (let index = 0; index < FRAMESCAPER_NATIVE_RENDER_INPUT_MAXIMUM_PENDING_STAGES; index += 1) {
			admissions.push(await staging.begin(OWNER, beginRequest(envelope, [
				input('evaluated-rgba-frame-pack', carrier),
			])));
		}
		await assert.rejects(() => staging.begin(OWNER, beginRequest(envelope, [
			input('evaluated-rgba-frame-pack', carrier),
		])), /pending.*ceiling/iu);
		await staging.abandon(OWNER, { stageId: admissions[0]!.stageId });
		await staging.begin(OWNER, beginRequest(envelope, [
			input('evaluated-rgba-frame-pack', carrier),
		]));

		const byteRoot = await mkdtemp(join(tmpdir(), 'framescaper-render-stage-byte-quota-'));
		try {
			let byteId = 10_000;
			const byteStaging = new FramescaperNativeRenderInputStaging({
				root: byteRoot,
				mintStageId: () => String(byteId++).padStart(40, '0'),
			});
			const half = FRAMESCAPER_NATIVE_RENDER_INPUT_TOTAL_MAXIMUM_BYTES / 2;
			for (let index = 0; index < 2; index += 1) {
				await byteStaging.begin(OWNER, beginRequest(envelope, [Object.freeze({
					role: 'evaluated-rgba-frame-pack' as const,
					byteLength: half,
					sha256: digest(`declared-${String(index)}`),
				})]));
			}
			await assert.rejects(() => byteStaging.begin(OWNER, beginRequest(envelope, [
				input('evaluated-rgba-frame-pack', carrier),
			])), /aggregate.*durable.*ceiling/iu);
		} finally {
			await rm(byteRoot, { recursive: true, force: true });
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('renderer-owner revocation immediately abandons only its unclaimed stages and fences reuse', async () => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-render-stage-owner-loss-'));
	const otherOwner = Object.freeze({ generation: 21 });
	const ids = [STAGE_ID, 'cd'.repeat(20)];
	try {
		const envelope = createNativeMediaPlanEnvelopeV1(keyedPlan(false));
		const carrier = framePack(envelope);
		const staging = new FramescaperNativeRenderInputStaging({
			root, mintStageId: () => ids.shift()!,
		});
		const lost = await staging.begin(OWNER, beginRequest(envelope, [
			input('evaluated-rgba-frame-pack', carrier),
		]));
		const preserved = await staging.begin(otherOwner, beginRequest(envelope, [
			input('evaluated-rgba-frame-pack', carrier),
		]));
		assert.equal(await staging.abandonOwner(OWNER), 1);
		assert.equal(await staging.abandonOwner(OWNER), 0);
		await assert.rejects(() => access(join(root, `stage-${lost.stageId}`)), /ENOENT/u);
		await access(join(root, `stage-${preserved.stageId}`));
		await assert.rejects(() => staging.begin(OWNER, beginRequest(envelope, [
			input('evaluated-rgba-frame-pack', carrier),
		])), /owner.*revoked/iu);
		await staging.abandonOwner(otherOwner);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('a claim rollback racing renderer loss settles the now-ownerless stage', async () => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-render-stage-claim-loss-'));
	const senderRoot = await mkdtemp(join(tmpdir(), 'framescaper-render-stage-claim-loss-source-'));
	try {
		const envelope = createNativeMediaPlanEnvelopeV1(keyedPlan(false));
		const carrier = framePack(envelope);
		const [source] = await sourceFiles(senderRoot, [carrier]);
		const staging = new FramescaperNativeRenderInputStaging({ root, mintStageId: () => STAGE_ID });
		await stageExact(staging, OWNER, envelope, carrier, source!);
		await staging.claim(OWNER, claimRequest(envelope));
		assert.equal(await staging.abandonOwner(OWNER), 0);
		await staging.rollbackClaim(OWNER, { stageId: STAGE_ID });
		await assert.rejects(() => access(join(root, `stage-${STAGE_ID}`)), /ENOENT/u);
	} finally {
		await rm(root, { recursive: true, force: true });
		await rm(senderRoot, { recursive: true, force: true });
	}
});

test('V7 staging reclaims expired, finalized, and claimed-without-queue owned stages after restart', async () => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-render-stage-reclaim-'));
	const senderRoot = await mkdtemp(join(tmpdir(), 'framescaper-render-stage-reclaim-source-'));
	let nowMs = 1_000;
	let nextId = 1;
	try {
		const envelope = createNativeMediaPlanEnvelopeV1(keyedPlan(false));
		const carrier = framePack(envelope);
		const [source] = await sourceFiles(senderRoot, [carrier]);
		const mintStageId = () => String(nextId++).padStart(40, '0');
		const staging = new FramescaperNativeRenderInputStaging({ root, mintStageId, now: () => nowMs });
		const expired = await staging.begin(OWNER, beginRequest(envelope, [
			input('evaluated-rgba-frame-pack', carrier),
		]));
		nowMs += FRAMESCAPER_NATIVE_RENDER_INPUT_STAGE_EXPIRY_MS + 1;
		const expiry = await staging.reclaim([]);
		assert.deepEqual(expiry, {
			scannedStages: 1, preservedStages: 0, removedStages: 1,
			reclaimedDeclaredBytes: carrier.byteLength,
		});
		await assert.rejects(() => access(join(root, `stage-${expired.stageId}`)), /ENOENT/u);

		const finalized = await stageExact(staging, OWNER, envelope, carrier, source!);
		const claimed = await stageExact(staging, OWNER, envelope, carrier, source!);
		await staging.claim(OWNER, claimRequest(envelope, claimed.stageId));
		await mkdir(join(root, `stage-${'ff'.repeat(20)}`));
		await writeFile(join(root, `stage-${'ff'.repeat(20)}`, 'foreign.txt'), 'foreign');

		const restarted = new FramescaperNativeRenderInputStaging({
			root, mintStageId: () => { throw new Error('must not mint during restart'); }, now: () => nowMs,
		});
		const startup = await restarted.reclaim([]);
		assert.equal(startup.removedStages, 2);
		assert.equal(startup.reclaimedDeclaredBytes, carrier.byteLength * 2);
		await assert.rejects(() => access(join(root, `stage-${finalized.stageId}`)), /ENOENT/u);
		await assert.rejects(() => access(join(root, `stage-${claimed.stageId}`)), /ENOENT/u);
		assert.equal(await readFile(join(root, `stage-${'ff'.repeat(20)}`, 'foreign.txt'), 'utf8'), 'foreign');
	} finally {
		await rm(root, { recursive: true, force: true });
		await rm(senderRoot, { recursive: true, force: true });
	}
});

test('V7 staging preserves an exact live restart stage and remove is authenticated and idempotent', async () => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-render-stage-live-'));
	const senderRoot = await mkdtemp(join(tmpdir(), 'framescaper-render-stage-live-source-'));
	try {
		const envelope = createNativeMediaPlanEnvelopeV1(keyedPlan(false));
		const carrier = framePack(envelope);
		const [source] = await sourceFiles(senderRoot, [carrier]);
		const staging = new FramescaperNativeRenderInputStaging({ root, mintStageId: () => STAGE_ID });
		await stageExact(staging, OWNER, envelope, carrier, source!);
		await staging.claim(OWNER, claimRequest(envelope));
		assert.equal(await staging.abandonOwner(OWNER), 0,
			'a claimed stage belongs to its durable queue row, not the lost renderer');
		const record = queueRecord(envelope);

		const restarted = new FramescaperNativeRenderInputStaging({
			root, mintStageId: () => { throw new Error('must not mint during restart'); },
		});
		assert.deepEqual(await restarted.reclaim([record]), {
			scannedStages: 1, preservedStages: 1, removedStages: 0, reclaimedDeclaredBytes: 0,
		});
		assert.equal(await restarted.revalidate(record), true);
		const substituted = Object.freeze({ ...record, projectRevision: record.projectRevision + 1 });
		await assert.rejects(() => restarted.remove(substituted), /identity|queue record/iu);
		await rm(join(root, `stage-${STAGE_ID}`), { recursive: true, force: false });
		await restarted.remove(record);
		await restarted.remove(record);
		await assert.rejects(() => access(join(root, `stage-${STAGE_ID}`)), /ENOENT/u);
		await assert.rejects(() => access(
			join(root, `stage-${STAGE_ID}.ownership.json`),
		), /ENOENT/u);
	} finally {
		await rm(root, { recursive: true, force: true });
		await rm(senderRoot, { recursive: true, force: true });
	}
});

test('paused V7 cleanup preserves the durable stage while cancellation removes it', async () => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-render-stage-paused-'));
	const senderRoot = await mkdtemp(join(tmpdir(), 'framescaper-render-stage-paused-source-'));
	try {
		const envelope = createNativeMediaPlanEnvelopeV1(keyedPlan(false));
		const carrier = framePack(envelope);
		const [source] = await sourceFiles(senderRoot, [carrier]);
		const staging = new FramescaperNativeRenderInputStaging({ root, mintStageId: () => STAGE_ID });
		await stageExact(staging, OWNER, envelope, carrier, source!);
		await staging.claim(OWNER, claimRequest(envelope));
		const record = queueRecord(envelope);

		await staging.settle(record, 'paused');
		assert.equal(await staging.revalidate(record), true);
		await access(join(root, `stage-${STAGE_ID}`));
		await staging.settle(record, 'cancelled');
		assert.equal(await staging.revalidate(record), false);
		await assert.rejects(() => access(join(root, `stage-${STAGE_ID}`)), /ENOENT/u);
	} finally {
		await rm(root, { recursive: true, force: true });
		await rm(senderRoot, { recursive: true, force: true });
	}
});

test('V7 startup reclamation refuses a forged ownership sidecar without deleting its directory', async () => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-render-stage-forged-owner-'));
	try {
		const envelope = createNativeMediaPlanEnvelopeV1(keyedPlan(false));
		const carrier = framePack(envelope);
		const staging = new FramescaperNativeRenderInputStaging({ root, mintStageId: () => STAGE_ID });
		await staging.begin(OWNER, beginRequest(envelope, [
			input('evaluated-rgba-frame-pack', carrier),
		]));
		const ownershipPath = join(root, `stage-${STAGE_ID}.ownership.json`);
		const ownership = JSON.parse(await readFile(ownershipPath, 'utf8')) as Record<string, unknown>;
		await writeFile(ownershipPath, JSON.stringify({
			...ownership,
			declaredByteLength: Number(ownership.declaredByteLength) + 1,
		}));
		const restarted = new FramescaperNativeRenderInputStaging({
			root, mintStageId: () => { throw new Error('must not mint during restart'); },
		});
		await assert.rejects(() => restarted.reclaim([]), /authentication/iu);
		await access(join(root, `stage-${STAGE_ID}`));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

function keyedPlan(includeAudio: boolean) {
	return createVideoKeyframeExportPlanV7({
		format: 'mp4', sampleRate: 8_000,
		range: { startFrame: 0, endFrame: 8_000, durationFrames: 8_000 },
		canvas: {
			width: 2, height: 2, frameRate: { num: 2, den: 1 }, fit: 'contain',
			pixelFormat: 'yuv420p', backgroundColor: '#000000',
			referenceClipId: 'clip-1', referenceSourceId: 'source-1',
		},
		activeClipIds: ['clip-1'], activeSourceIds: ['source-1'],
		sources: [{
			kind: 'video', id: 'source-1', storageKey: 'source-1', mimeType: 'video/mp4',
			contentSha256: '12'.repeat(32),
		}],
		includeAudio,
		...(includeAudio ? { audioLayout: 'stereo' as const, audioFileName: 'audio.wav' } : {}),
	});
}

function beginRequest(
	envelope: ReturnType<typeof createNativeMediaPlanEnvelopeV1>,
	derivedInputs: readonly ReturnType<typeof input>[],
) {
	return Object.freeze({
		stageVersion: 1 as const, schemaFamily: 'framescaper' as const, schemaVersion: 1 as const,
		planVersion: envelope.planVersion as 7 | 8,
		planFingerprint: envelope.fingerprint,
		planPayload: JSON.stringify(envelope.plan),
		projectId: 'project-1', projectRevision: 7,
		inputFingerprints: Object.freeze([{ sourceId: 'source-1', sha256: '12'.repeat(32) }]),
		derivedInputs,
	});
}

function input(role: 'evaluated-rgba-frame-pack' | 'staged-audio-mix', bytes: Uint8Array) {
	return Object.freeze({ role, byteLength: bytes.byteLength, sha256: digest(bytes) });
}

function claimRequest(
	envelope: ReturnType<typeof createNativeMediaPlanEnvelopeV1>,
	derivedInputStageId = STAGE_ID,
) {
	return Object.freeze({
		schemaFamily: 'framescaper' as const, schemaVersion: 1 as const, derivedInputStageId,
		planVersion: envelope.planVersion as 7 | 8, planFingerprint: envelope.fingerprint,
		planPayload: JSON.stringify(envelope.plan), projectId: 'project-1', projectRevision: 7,
		inputFingerprints: Object.freeze([{ sourceId: 'source-1', sha256: '12'.repeat(32) }]),
	});
}

async function stageExact(
	staging: FramescaperNativeRenderInputStaging,
	owner: object,
	envelope: ReturnType<typeof createNativeMediaPlanEnvelopeV1>,
	carrier: Uint8Array,
	source: string,
) {
	const admission = await staging.begin(owner, beginRequest(envelope, [
		input('evaluated-rgba-frame-pack', carrier),
	]));
	const [sender, receiver] = portPair();
	const received = staging.receive(owner, {
		stageId: admission.stageId, inputIndex: 0, binding: admission.inputs[0]!.binding,
	}, receiver);
	await sendHelperDataPlaneFile({ binding: admission.inputs[0]!.binding, port: sender, path: source });
	await received;
	await staging.finalize(owner, { stageId: admission.stageId });
	return admission;
}

function queueRecord(envelope: ReturnType<typeof createNativeMediaPlanEnvelopeV1>) {
	return createNativeQueueRecordV2({
		schemaFamily: 'framescaper', schemaVersion: 1,
		jobId: STAGE_ID, taskKind: 'encoded-export', plan: envelope.plan,
		projectId: 'project-1', projectRevision: 7,
		inputFingerprints: [{ sourceId: 'source-1', sha256: '12'.repeat(32) }],
		rootGrantId: 'cd'.repeat(16), relativeDestination: 'renders/test.mp4',
		reservations: {
			cpuCores: 1, processTreeRssBytes: 256 * 1_024 ** 2,
			scratchBytes: 32 * 1_024 ** 2, minimumFreeBytes: 0, hardwareBackend: null,
		},
		position: 0, createdAtMs: 1,
	});
}

function queueEnqueueRequest(
	record: ReturnType<typeof queueRecord>,
	derivedInputStageId: string | null,
) {
	return Object.freeze({
		schemaFamily: record.schemaFamily, schemaVersion: record.schemaVersion,
		taskKind: record.taskKind, planVersion: record.planVersion, derivedInputStageId,
		planFingerprint: record.planFingerprint, planPayload: record.planPayload,
		projectId: record.projectId, projectRevision: record.projectRevision,
		inputFingerprints: record.inputFingerprints, rootGrantId: record.rootGrantId,
		relativeDestination: record.relativeDestination, reservations: record.reservations,
		recoveryClass: record.recoveryClass,
	});
}

function framePack(envelope: ReturnType<typeof createNativeMediaPlanEnvelopeV1>): Buffer {
	const { width, height, outputFrameCount, frameRate } = envelope.summary;
	const rate = frameRate.kind === 'rational'
		? frameRate
		: { kind: 'rational' as const, num: frameRate.value, den: 1 };
	assert.equal(Number.isSafeInteger(rate.num), true);
	const frameBytes = width * height * 4;
	const output = Buffer.alloc(59 + outputFrameCount * (32 + frameBytes));
	output.write('framescaper-rgba-frame-pack-v1\n', 0, 'ascii');
	output.writeUInt32LE(1, 31); output.writeUInt32LE(width, 35); output.writeUInt32LE(height, 39);
	output.writeBigUInt64LE(BigInt(outputFrameCount), 43);
	output.writeUInt32LE(rate.den, 51); output.writeUInt32LE(rate.num, 55);
	let offset = 59;
	for (let ordinal = 0; ordinal < outputFrameCount; ordinal += 1) {
		output.writeBigUInt64LE(BigInt(ordinal), offset);
		output.writeBigInt64LE(BigInt(ordinal), offset + 8);
		output.writeBigInt64LE(1n, offset + 16);
		output.writeBigUInt64LE(BigInt(frameBytes), offset + 24);
		output.fill(ordinal * 17, offset + 32, offset + 32 + frameBytes);
		offset += 32 + frameBytes;
	}
	return output;
}

function float32Wav(sampleRate: number, frameCount: number, channels: number): Buffer {
	const dataBytes = frameCount * channels * 4;
	const output = Buffer.alloc(44 + dataBytes);
	output.write('RIFF', 0, 'ascii'); output.writeUInt32LE(output.byteLength - 8, 4);
	output.write('WAVEfmt ', 8, 'ascii'); output.writeUInt32LE(16, 16);
	output.writeUInt16LE(3, 20); output.writeUInt16LE(channels, 22);
	output.writeUInt32LE(sampleRate, 24); output.writeUInt32LE(sampleRate * channels * 4, 28);
	output.writeUInt16LE(channels * 4, 32); output.writeUInt16LE(32, 34);
	output.write('data', 36, 'ascii'); output.writeUInt32LE(dataBytes, 40);
	return output;
}

async function sourceFiles(root: string, values: readonly Uint8Array[]): Promise<readonly string[]> {
	return Promise.all(values.map(async (value, index) => {
		const path = join(root, `source-${String(index)}.bin`);
		await writeFile(path, value);
		return path;
	}));
}

function digest(value: Uint8Array | string): string {
	return createHash('sha256').update(value).digest('hex');
}

class Port extends EventEmitter implements HelperDataPlaneIoPort {
	peer: Port | null = null;
	postMessage(message: unknown): void { queueMicrotask(() => this.peer?.emit('message', { data: message })); }
	start(): void {}
	close(): void {}
}

function portPair(): readonly [Port, Port] {
	const left = new Port(); const right = new Port();
	left.peer = right; right.peer = left;
	return [left, right];
}
