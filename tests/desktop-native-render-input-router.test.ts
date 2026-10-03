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
import { FramescaperNativeRenderInputRouter } from '../desktop/native-services-render-input-router.ts';
import { createNativeMediaPlanEnvelopeV1 } from '../src/common/editor/native-media-plan-envelope.ts';
import { createNativeMediaPlanEnvelopeV2 } from '../src/common/editor/native-media-plan-envelope-v2.ts';
import { createNativeQueueRecordV2 } from '../src/common/editor/native-queue-record.ts';
import { createNativeQueueRecordV3 } from '../src/common/editor/native-queue-record-v3.ts';
import { nativeRgbaFramePackV1ByteLength } from '../src/common/editor/native-rgba-frame-pack-v1-contract.ts';
import { createFramescaperNativeRenderPlanAuthorityNativeMedia } from '../src/framescaper/editor-native-render-plan-authority.ts';
import { createFramescaperProjectUnifiedExactRenderPlanNativeMedia } from '../src/framescaper/editor-project-unified-render-plan-native-media.ts';
import { FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectNativeMedia } from '../src/framescaper/editor-project-native-media.ts';
import { streamFramescaperNativeRgbaFramePackV1 } from '../src/framescaper/native-render-frame-pack-v1.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';
import { nativeQueueSmallStaticAudioPlanV8 } from './helpers/native-queue-plan-fixture.ts';

const DURABLE_STAGE_ID = '11'.repeat(20);
const LIVE_STAGE_ID = '22'.repeat(20);
const PENDING_STAGE_ID = '33'.repeat(20);
const DURABLE_OWNER = Object.freeze({ renderer: 'durable' });
const LIVE_OWNER = Object.freeze({ renderer: 'live' });

test('router isolates mixed owners and dispatches claims, abandonment, and settlement by stage', async () => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-render-router-'));
	const senderRoot = await mkdtemp(join(tmpdir(), 'framescaper-render-router-source-'));
	try {
		const durable = durableFixture();
		const live = liveFixture();
		const router = createRouter(root, [DURABLE_STAGE_ID, LIVE_STAGE_ID, PENDING_STAGE_ID]);
		const durableAdmission = await router.begin(DURABLE_OWNER, durableBeginRequest(durable));
		const liveAdmission = await router.beginLive(LIVE_OWNER, liveBeginRequest(live));

		assert.equal(durableAdmission.stageId, DURABLE_STAGE_ID);
		assert.equal(liveAdmission.stageId, LIVE_STAGE_ID);
		await assertStageLocation(root, 'durable', DURABLE_STAGE_ID);
		await assertStageLocation(root, 'live', LIVE_STAGE_ID);

		const [, wrongOwnerPort] = portPair();
		await assert.rejects(router.receive(LIVE_OWNER, {
			stageId: DURABLE_STAGE_ID, inputIndex: 0,
			binding: durableAdmission.inputs[0]!.binding,
		}, wrongOwnerPort), /owner/iu);
		const [, refusedLivePort] = portPair();
		await assert.rejects(router.receive(LIVE_OWNER, {
			stageId: LIVE_STAGE_ID, inputIndex: 0,
			binding: durableAdmission.inputs[0]!.binding,
		}, refusedLivePort), /live V14 stage.*refuses pre-staged input/iu);
		await assert.rejects(
			router.finalize(DURABLE_OWNER, { stageId: LIVE_STAGE_ID }), /owner/iu,
		);
		await assert.rejects(
			router.abandon(DURABLE_OWNER, { stageId: LIVE_STAGE_ID }), /owner/iu,
		);

		const source = join(senderRoot, 'mix.wav');
		await writeFile(source, durable.audio);
		const [sender, receiver] = portPair();
		const received = router.receive(DURABLE_OWNER, {
			stageId: DURABLE_STAGE_ID, inputIndex: 0,
			binding: durableAdmission.inputs[0]!.binding,
		}, receiver);
		await sendHelperDataPlaneFile({
			binding: durableAdmission.inputs[0]!.binding, port: sender, path: source,
		});
		await received;
		await router.finalize(DURABLE_OWNER, { stageId: DURABLE_STAGE_ID });
		await router.finalize(LIVE_OWNER, { stageId: LIVE_STAGE_ID });

		const durableClaim = durableClaimRequest(durable, DURABLE_STAGE_ID);
		const liveClaim = liveClaimRequest(live, LIVE_STAGE_ID);
		await assert.rejects(router.claim(LIVE_OWNER, durableClaim), /owner/iu);
		await assert.rejects(router.claim(DURABLE_OWNER, liveClaim), /owner/iu);
		await router.claim(DURABLE_OWNER, durableClaim);
		await router.claim(LIVE_OWNER, liveClaim);
		await router.rollbackClaim(DURABLE_OWNER, { stageId: DURABLE_STAGE_ID });
		await router.rollbackClaim(LIVE_OWNER, { stageId: LIVE_STAGE_ID });
		await router.claim(DURABLE_OWNER, durableClaim);
		await router.claim(LIVE_OWNER, liveClaim);

		assert.equal(router.scratchReservation(LIVE_OWNER, liveClaim), liveAdmission.scratchByteLength);
		assert.throws(
			() => router.scratchReservation(DURABLE_OWNER, durableClaim), /only a live V14 carrier/iu,
		);
		const durableRecord = durableQueueRecord(durable, DURABLE_STAGE_ID);
		const liveRecord = liveQueueRecord(live, LIVE_STAGE_ID);
		assert.equal(await router.revalidate(durableRecord), true);
		assert.equal(await router.revalidate(liveRecord), true);
		const durableInputs = await router.inspect(durableRecord);
		const liveInputs = await router.inspect(liveRecord);
		assert.equal(durableInputs.byteLength, durable.audio.byteLength);
		assert.equal(liveInputs.byteLength, live.carrierByteLength);
		assert.equal(liveInputs.scratchByteLength, liveAdmission.scratchByteLength);
		const materializedRoot = join(root, 'materialized');
		await mkdir(materializedRoot);
		const [durableGrant] = await durableInputs.materialize(materializedRoot);
		assert.equal(durableGrant?.type, 'file');
		if (durableGrant?.type !== 'file') throw new Error('Durable routing returned no file grant.');
		assert.deepEqual(await readFile(durableGrant.path), durable.audio);

		const liveMaterialization = liveInputs.materialize(root);
		await writeLiveCarrier(router, LIVE_OWNER, live);
		const [liveGrant] = await liveMaterialization;
		assert.equal(liveGrant?.type, 'file');
		if (liveGrant?.type !== 'file') throw new Error('Live routing returned no replay file grant.');
		assert.equal(liveGrant.path.startsWith(join(root, 'live')), true);

		const pending = await router.begin(DURABLE_OWNER, durableBeginRequest(durable));
		assert.equal(pending.stageId, PENDING_STAGE_ID);
		await assert.rejects(
			router.abandon(LIVE_OWNER, { stageId: PENDING_STAGE_ID }), /owner/iu,
		);
		assert.equal(await router.abandonOwner(DURABLE_OWNER), 1);
		await assertPathMissing(stageDirectory(root, 'durable', PENDING_STAGE_ID));
		await access(stageDirectory(root, 'durable', DURABLE_STAGE_ID));
		await access(stageDirectory(root, 'live', LIVE_STAGE_ID));
		await assert.rejects(
			() => router.begin(DURABLE_OWNER, durableBeginRequest(durable)), /owner.*revoked/iu,
		);

		await router.settle(durableRecord, 'succeeded');
		await router.settle(liveRecord, 'succeeded');
		assert.equal(await router.revalidate(durableRecord), false);
		assert.equal(await router.revalidate(liveRecord), false);
		assert.equal(await router.outstandingLiveScratchByteLength(), 0);
		await assertStageRemoved(root, 'durable', DURABLE_STAGE_ID);
		await assertStageRemoved(root, 'live', LIVE_STAGE_ID);
	} finally {
		await rm(root, { recursive: true, force: true });
		await rm(senderRoot, { recursive: true, force: true });
	}
});

test('router restart preserves durable queue authority and reclaims live memory authority', async () => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-render-router-restart-'));
	const senderRoot = await mkdtemp(join(tmpdir(), 'framescaper-render-router-restart-source-'));
	try {
		const durable = durableFixture();
		const live = liveFixture();
		const router = createRouter(root, [DURABLE_STAGE_ID, LIVE_STAGE_ID]);
		const durableAdmission = await router.begin(DURABLE_OWNER, durableBeginRequest(durable));
		const liveAdmission = await router.beginLive(LIVE_OWNER, liveBeginRequest(live));
		const source = join(senderRoot, 'mix.wav');
		await writeFile(source, durable.audio);
		const [sender, receiver] = portPair();
		const received = router.receive(DURABLE_OWNER, {
			stageId: DURABLE_STAGE_ID, inputIndex: 0,
			binding: durableAdmission.inputs[0]!.binding,
		}, receiver);
		await sendHelperDataPlaneFile({
			binding: durableAdmission.inputs[0]!.binding, port: sender, path: source,
		});
		await received;
		await router.finalize(DURABLE_OWNER, { stageId: DURABLE_STAGE_ID });
		await router.finalize(LIVE_OWNER, { stageId: LIVE_STAGE_ID });
		await router.claim(DURABLE_OWNER, durableClaimRequest(durable, DURABLE_STAGE_ID));
		await router.claim(LIVE_OWNER, liveClaimRequest(live, LIVE_STAGE_ID));
		await writeLiveCarrier(router, LIVE_OWNER, live);

		const durableRecord = durableQueueRecord(durable, DURABLE_STAGE_ID);
		const liveRecord = liveQueueRecord(live, LIVE_STAGE_ID);
		const restarted = createRouter(root, []);
		assert.equal(await restarted.revalidate(durableRecord), true);
		assert.equal(await restarted.revalidate(liveRecord), false);
		assert.deepEqual(await restarted.reclaim([durableRecord, liveRecord]), {
			scannedStages: 2, preservedStages: 1, removedStages: 1,
			reclaimedDeclaredBytes: liveAdmission.scratchByteLength,
		});
		assert.equal(await restarted.revalidate(durableRecord), true);
		assert.equal(await restarted.revalidate(liveRecord), false);
		await access(stageDirectory(root, 'durable', DURABLE_STAGE_ID));
		await assertStageRemoved(root, 'live', LIVE_STAGE_ID);
		assert.equal((await restarted.inspect(durableRecord)).byteLength, durable.audio.byteLength);

		await restarted.settle(durableRecord, 'cancelled');
		await assertStageRemoved(root, 'durable', DURABLE_STAGE_ID);
		assert.deepEqual(await restarted.reclaim([]), {
			scannedStages: 0, preservedStages: 0, removedStages: 0, reclaimedDeclaredBytes: 0,
		});
	} finally {
		await rm(root, { recursive: true, force: true });
		await rm(senderRoot, { recursive: true, force: true });
	}
});

function createRouter(root: string, stageIds: readonly string[]): FramescaperNativeRenderInputRouter {
	const remaining = [...stageIds];
	return new FramescaperNativeRenderInputRouter({
		root,
		mintStageId: () => {
			const id = remaining.shift();
			if (!id) throw new Error('Restarted router must not mint a stage.');
			return id;
		},
		createMessageChannel: () => { throw new Error('Durable replay opens no helper port.'); },
	});
}

function durableFixture() {
	const envelope = createNativeMediaPlanEnvelopeV1(nativeQueueSmallStaticAudioPlanV8());
	return { envelope, audio: float32Wav(1_000, 1_000, 2) };
}

function durableBeginRequest(fixture: ReturnType<typeof durableFixture>) {
	return Object.freeze({
		stageVersion: 1 as const, schemaFamily: 'framescaper' as const, schemaVersion: 1 as const,
		planVersion: 8 as const, planFingerprint: fixture.envelope.fingerprint,
		planPayload: JSON.stringify(fixture.envelope.plan),
		projectId: 'durable-project', projectRevision: 8,
		inputFingerprints: [{ sourceId: 'source-1', sha256: '12'.repeat(32) }],
		derivedInputs: [{
			role: 'staged-audio-mix' as const, byteLength: fixture.audio.byteLength,
			sha256: digest(fixture.audio),
		}],
	});
}

function durableClaimRequest(fixture: ReturnType<typeof durableFixture>, stageId: string) {
	const begin = durableBeginRequest(fixture);
	return Object.freeze({
		schemaFamily: begin.schemaFamily, schemaVersion: begin.schemaVersion,
		derivedInputStageId: stageId, planVersion: begin.planVersion,
		planFingerprint: begin.planFingerprint, planPayload: begin.planPayload,
		projectId: begin.projectId, projectRevision: begin.projectRevision,
		inputFingerprints: begin.inputFingerprints,
	});
}

function durableQueueRecord(fixture: ReturnType<typeof durableFixture>, jobId: string) {
	return createNativeQueueRecordV2({
		schemaFamily: 'framescaper', schemaVersion: 1, jobId,
		taskKind: 'encoded-export', plan: fixture.envelope.plan,
		projectId: 'durable-project', projectRevision: 8,
		inputFingerprints: [{ sourceId: 'source-1', sha256: '12'.repeat(32) }],
		rootGrantId: '44'.repeat(16), relativeDestination: 'renders/durable.mp4',
		reservations: {
			cpuCores: 1, processTreeRssBytes: 256 * 1_024 ** 2,
			scratchBytes: 32 * 1_024 ** 2, minimumFreeBytes: 0, hardwareBackend: null,
		},
		position: 0, createdAtMs: 1,
	});
}

function liveFixture() {
	const options = framescaperV20Options();
	options.sources = (options.sources as Array<Record<string, unknown>>)
		.filter(({ kind }) => kind === 'video').map((source) => ({
			...source, width: 2, height: 2, sourceFrameCount: 1,
			frameRate: { num: 1, den: 1 },
			timingDecision: { mode: 'conform-cfr-at-ingest', rate: { num: 1, den: 1 } },
		}));
	options.clips = (options.clips as Array<Record<string, unknown>>)
		.filter(({ kind }) => kind === 'video')
		.map((clip) => ({ ...clip, sequenceFrameCount: 1, sourceFrameCount: 1 }));
	options.projectBin = {
		clips: ((options.projectBin as { clips: Array<Record<string, unknown>> }).clips)
			.map((clip) => ({ ...clip, sequenceFrameCount: 1, sourceFrameCount: 1 })),
	};
	options.tracks = (options.tracks as Array<Record<string, unknown>>)
		.filter(({ type }) => type === 'video');
	options.sequences = [{
		id: 'main-sequence', rate: { num: 1, den: 1 }, trackIds: ['video-track'],
	}];
	const project = createFramescaperProjectNativeMedia(
		FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE, options,
	);
	const plan = createFramescaperProjectUnifiedExactRenderPlanNativeMedia(
		FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE,
		project,
		createFramescaperNativeRenderPlanAuthorityNativeMedia(project),
	);
	const envelope = createNativeMediaPlanEnvelopeV2(plan);
	const carrierByteLength = nativeRgbaFramePackV1ByteLength({
		width: envelope.summary.width, height: envelope.summary.height,
		frameCount: envelope.summary.outputFrameCount,
	});
	return { project, plan, envelope, carrierByteLength };
}

function liveBeginRequest(fixture: ReturnType<typeof liveFixture>) {
	return Object.freeze({
		liveRenderVersion: 1 as const, schemaFamily: 'framescaper' as const,
		schemaVersion: 1 as const, planVersion: 14 as const,
		planFingerprint: fixture.envelope.fingerprint,
		planPayload: JSON.stringify(fixture.plan),
		projectId: fixture.project.id, projectRevision: fixture.project.revision,
		inputFingerprints: [{ sourceId: 'video-source', sha256: '12'.repeat(32) }],
		restartJobId: null, carrierByteLength: fixture.carrierByteLength, audio: null,
	});
}

function liveClaimRequest(fixture: ReturnType<typeof liveFixture>, stageId: string) {
	const begin = liveBeginRequest(fixture);
	return Object.freeze({
		schemaFamily: begin.schemaFamily, schemaVersion: begin.schemaVersion,
		derivedInputStageId: stageId, planVersion: begin.planVersion,
		planFingerprint: begin.planFingerprint, planPayload: begin.planPayload,
		projectId: begin.projectId, projectRevision: begin.projectRevision,
		inputFingerprints: begin.inputFingerprints,
	});
}

function liveQueueRecord(fixture: ReturnType<typeof liveFixture>, jobId: string) {
	return createNativeQueueRecordV3({
		schemaFamily: 'framescaper', schemaVersion: 1, jobId,
		taskKind: 'encoded-export', plan: fixture.plan,
		projectId: String(fixture.project.id), projectRevision: Number(fixture.project.revision),
		inputFingerprints: [{ sourceId: 'video-source', sha256: '12'.repeat(32) }],
		rootGrantId: '55'.repeat(16), relativeDestination: 'renders/live.mov',
		reservations: {
			cpuCores: 2, processTreeRssBytes: 1_024 ** 3,
			scratchBytes: 32 * 1_024 ** 3, minimumFreeBytes: 0, hardwareBackend: null,
		},
		position: 1, createdAtMs: 2,
	});
}

async function writeLiveCarrier(
	router: FramescaperNativeRenderInputRouter,
	owner: object,
	fixture: ReturnType<typeof liveFixture>,
): Promise<void> {
	const chunks: Uint8Array[] = [];
	const rate = fixture.envelope.summary.frameRate;
	if (rate.kind !== 'rational') throw new Error('Live fixture cadence is not rational.');
	const result = await streamFramescaperNativeRgbaFramePackV1({
		width: fixture.envelope.summary.width, height: fixture.envelope.summary.height,
		frameCount: fixture.envelope.summary.outputFrameCount,
		frameRate: { num: rate.num, den: rate.den }, signal: new AbortController().signal,
		assertCurrent: () => undefined,
		renderFrame: (ordinal: number, output: Uint8Array) => { output.fill(ordinal + 1); },
	}, { write: (bytes) => { chunks.push(new Uint8Array(bytes)); } });
	let sequence = 0;
	let offset = 0;
	for (const bytes of chunks) {
		await router.writeLive(owner, {
			stageId: LIVE_STAGE_ID, role: 'evaluated-rgba-frame-pack', sequence, offset, bytes,
		});
		sequence += 1;
		offset += bytes.byteLength;
	}
	await router.completeLive(owner, {
		stageId: LIVE_STAGE_ID, role: 'evaluated-rgba-frame-pack',
		byteLength: result.byteLength, sha256: result.sha256,
	});
}

function float32Wav(sampleRate: number, frameCount: number, channels: number): Buffer {
	const dataBytes = frameCount * channels * 4;
	const output = Buffer.alloc(44 + dataBytes);
	output.write('RIFF', 0, 'ascii');
	output.writeUInt32LE(output.byteLength - 8, 4);
	output.write('WAVEfmt ', 8, 'ascii');
	output.writeUInt32LE(16, 16);
	output.writeUInt16LE(3, 20);
	output.writeUInt16LE(channels, 22);
	output.writeUInt32LE(sampleRate, 24);
	output.writeUInt32LE(sampleRate * channels * 4, 28);
	output.writeUInt16LE(channels * 4, 32);
	output.writeUInt16LE(32, 34);
	output.write('data', 36, 'ascii');
	output.writeUInt32LE(dataBytes, 40);
	return output;
}

function digest(value: Uint8Array): string {
	return createHash('sha256').update(value).digest('hex');
}

function stageDirectory(root: string, kind: 'durable' | 'live', stageId: string): string {
	return join(root, kind, `stage-${stageId}`);
}

async function assertStageLocation(
	root: string, kind: 'durable' | 'live', stageId: string,
): Promise<void> {
	await access(stageDirectory(root, kind, stageId));
	await assertPathMissing(stageDirectory(root, kind === 'durable' ? 'live' : 'durable', stageId));
}

async function assertStageRemoved(
	root: string, kind: 'durable' | 'live', stageId: string,
): Promise<void> {
	await assertPathMissing(stageDirectory(root, kind, stageId));
	await assertPathMissing(join(root, kind, `stage-${stageId}.ownership.json`));
}

async function assertPathMissing(path: string): Promise<void> {
	await assert.rejects(access(path), /ENOENT/u);
}

class Port extends EventEmitter implements HelperDataPlaneIoPort {
	peer: Port | null = null;
	postMessage(message: unknown): void {
		queueMicrotask(() => this.peer?.emit('message', { data: message }));
	}
	start(): void {}
	close(): void {}
}

function portPair(): readonly [Port, Port] {
	const left = new Port();
	const right = new Port();
	left.peer = right;
	right.peer = left;
	return [left, right];
}
