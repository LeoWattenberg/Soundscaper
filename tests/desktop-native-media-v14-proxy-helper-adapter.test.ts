/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { FramescaperMediaHostDescriptor } from '../desktop/framescaper-media-host-payload.ts';
import { executeNativeMediaPlanV14 } from '../desktop/native-media-v14-executor.ts';
import type { HelperDataPlaneIoPort } from '../desktop/helper-data-plane-io.ts';
import {
	receiveHelperDataPlaneFile,
	receiveHelperDataPlaneInputStream,
} from '../desktop/helper-data-plane-io.ts';
import type {
	HelperMediaEncodeJobGrant,
	HelperMediaProxyJobGrant,
} from '../desktop/helper-native-job-contract.ts';
import { createNativeMediaV14HelperAdapter } from '../desktop/native-media-v14-helper-adapter.ts';
import type { NativeMediaHelperPoolJobRequest } from '../desktop/native-media-helper-pool.ts';
import { FramescaperNativeLiveRenderInputStaging } from '../desktop/native-services-live-render-input-staging.ts';
import { createNativeMediaPublicationPlan } from '../src/common/editor/native-media-atomic-publication.ts';
import {
	NATIVE_MEDIA_CPU_BACKEND,
	NATIVE_MEDIA_WEB_BACKEND,
} from '../src/common/editor/native-media-backend-policy.ts';
import { createNativeMediaPlanEnvelopeV2 } from '../src/common/editor/native-media-plan-envelope-v2.ts';
import { createNativeQueueRecordV3 } from '../src/common/editor/native-queue-record-v3.ts';
import { nativeRgbaFramePackV1ByteLength } from '../src/common/editor/native-rgba-frame-pack-v1-contract.ts';
import { normalizeVideoSourceCharacteristicsV25 } from '../src/common/editor/video-source-professional-characteristics-v25.ts';
import { createFramescaperNativeRenderPlanAuthorityV28 } from '../src/framescaper/editor-native-render-plan-authority-v28.ts';
import { createFramescaperProjectUnifiedExactRenderPlanV28 } from '../src/framescaper/editor-project-unified-render-plan-v28.ts';
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v28.ts';
import { createFramescaperProjectV28 } from '../src/framescaper/editor-project-v28.ts';
import { streamFramescaperNativeRgbaFramePackV1 } from '../src/framescaper/native-render-frame-pack-v1.ts';
import { framescaperMediaHostDescriptorFixture } from './helpers/framescaper-media-host-descriptor-fixture.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

const SOURCE_BYTES = new Uint8Array([9, 8, 7, 6]);
const OUTPUT_BYTES = new Uint8Array([1, 3, 3, 7]);
const LIVE_JOB_ID = 'bc'.repeat(20);
const LIVE_OWNER = Object.freeze({ renderer: 'retry-test' });

test('V14 proxy adapter grants one exact original and ProRes Proxy MOV recipe to the helper', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'framescaper-v14-proxy-adapter-'));
	try {
		const descriptor = await mediaHostDescriptor(directory);
		const root = join(directory, 'exports');
		await mkdir(root);
		const rootDetails = await lstat(root, { bigint: true });
		const envelope = proxyEnvelope();
		const sourceSha256 = digest(SOURCE_BYTES);
		let observedGrant: HelperMediaProxyJobGrant | null = null;
		const adapter = createNativeMediaV14HelperAdapter({
			descriptor,
			scratchRoot: join(directory, 'scratch'),
			createMessageChannel: () => {
				const [hostPort, helperPort] = portPair();
				return { hostPort, helperPort };
			},
			runJob: async (request: NativeMediaHelperPoolJobRequest) => {
				assert.equal(request.kind, 'media-proxy');
				const grant = request.grant as HelperMediaProxyJobGrant;
				observedGrant = grant;
				const planPath = join(directory, 'received-plan.json');
				await receiveHelperDataPlaneFile({
					binding: grant.plan,
					port: request.dataPlaneTransfers![0]!.port as HelperDataPlaneIoPort,
					path: planPath,
				});
				await writeFile(grant.output.temporaryPath, OUTPUT_BYTES, { flag: 'wx' });
				const outputDetails = await lstat(grant.output.temporaryPath);
				return { output: { temporaryPath: grant.output.temporaryPath,
					byteLength: OUTPUT_BYTES.byteLength, sha256: digest(OUTPUT_BYTES),
					identity: { dev: outputDetails.dev, ino: outputDetails.ino } } };
			},
		});
		const receipt = await adapter.executeProxy({
			adapterVersion: 1,
			envelope,
			sourceBody: {
				grantId: 'ab'.repeat(20), sourceId: 'video-source', contentSha256: sourceSha256,
				mimeType: 'video/mp4', byteLength: SOURCE_BYTES.byteLength,
				materialize: async (destination) => {
					await writeFile(destination, SOURCE_BYTES, { flag: 'wx' });
					return { byteLength: SOURCE_BYTES.byteLength, sha256: sourceSha256 };
				},
			},
			timingBodies: [],
			recipe: { id: 'framescaper-native-prores-proxy-mov-v1', width: 1_280, height: 720 },
			destination: {
				jobId: 'cd'.repeat(20), rootPath: root,
				volumeIdentity: `device:${rootDetails.dev.toString(16)}`,
				directoryIdentity: `device:${rootDetails.dev.toString(16)}:inode:${rootDetails.ino.toString(16)}`,
				relativeDestination: 'proxies/video-source.mov',
				temporaryRelativePath: 'proxies/video-source.mov.cdcdcdcdcdcdcdcd.partial',
			},
			onProgress: () => undefined,
		});
		assert.deepEqual(receipt, {
			planFingerprint: envelope.fingerprint, byteLength: OUTPUT_BYTES.byteLength,
			sha256: digest(OUTPUT_BYTES), publication: 'verified-temporary',
		});
		assert.ok(observedGrant);
		const grant = observedGrant as HelperMediaProxyJobGrant;
		assert.equal(grant.source.type, 'file');
		assert.equal(grant.source.role, 'original');
		assert.deepEqual(grant.proxyRecipe, {
			id: 'framescaper-native-prores-proxy-mov-v1', width: 1_280, height: 720,
		});
		assert.equal(grant.plan.sha256, envelope.fingerprint);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test('V14 evaluated-carrier execution never materializes whole project originals into helper scratch', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'framescaper-v14-live-adapter-'));
	try {
		const descriptor = await mediaHostDescriptor(directory);
		const root = join(directory, 'exports'); await mkdir(root);
		const rootDetails = await lstat(root, { bigint: true });
		const envelope = proxyEnvelope();
		const jobId = 'cd'.repeat(20);
		let originalMaterializations = 0;
		let observedGrant: HelperMediaEncodeJobGrant | null = null;
		const [liveHost, liveHelper] = portPair();
		const reservation = Object.freeze({
			dataPlaneVersion: 1 as const, transport: 'message-port' as const,
			streamId: 'ef'.repeat(20), direction: 'host-to-helper' as const,
			authentication: 'trailer-sha256-v1' as const,
			byteLength: 5, maximumChunkBytes: 5, maximumInFlightChunks: 1,
		});
		const adapter = createNativeMediaV14HelperAdapter({
			descriptor, scratchRoot: join(directory, 'scratch'),
			createMessageChannel: () => { const [hostPort, helperPort] = portPair(); return { hostPort, helperPort }; },
			runJob: async (request) => {
				assert.equal(request.kind, 'media-render');
				const grant = request.grant as HelperMediaEncodeJobGrant;
				observedGrant = grant;
				await receiveHelperDataPlaneFile({ binding: grant.plan,
					port: request.dataPlaneTransfers![0]!.port as HelperDataPlaneIoPort,
					path: join(directory, 'received-live-plan.json') });
				await writeFile(grant.output.temporaryPath, OUTPUT_BYTES, { flag: 'wx' });
				const outputDetails = await lstat(grant.output.temporaryPath);
				return { output: { temporaryPath: grant.output.temporaryPath,
					byteLength: OUTPUT_BYTES.byteLength, sha256: digest(OUTPUT_BYTES),
					identity: { dev: outputDetails.dev, ino: outputDetails.ino } } };
			},
		});
		const receipt = await adapter.execute({
			adapterVersion: 1,
			attempt: {
				jobId: '12'.repeat(20), backend: 'vaapi', envelope,
				sources: envelope.plan.sources.map((source, index) => ({
					sourceId: source.sourceId, contentSha256: source.contentSha256,
					grantId: String(index + 1).repeat(40),
				})),
				rootGrantId: 'ab'.repeat(20), relativeDestination: 'renders/live.mov', stages: [],
			},
			sourceBodies: envelope.plan.sources.map((source, index) => ({
				grantId: String(index + 1).repeat(40), sourceId: source.sourceId,
				contentSha256: source.contentSha256, mimeType: source.mimeType, byteLength: 4,
				materialize: async () => { originalMaterializations += 1; throw new Error('original copied'); },
			})),
			timingBodies: [],
			derivedInputs: {
				byteLength: reservation.byteLength,
				materialize: async () => [{
					type: 'stream', role: 'evaluated-rgba-frame-pack', binding: reservation,
				}],
				transfers: () => [{ streamId: reservation.streamId, port: liveHelper }],
			},
			destination: {
				jobId, rootPath: root,
				volumeIdentity: `device:${rootDetails.dev.toString(16)}`,
				directoryIdentity: `device:${rootDetails.dev.toString(16)}:inode:${rootDetails.ino.toString(16)}`,
				relativeDestination: 'renders/live.mov',
				temporaryRelativePath: `renders/live.mov.${jobId.slice(0, 16)}.partial`,
			},
			onProgress: () => undefined,
		});
		assert.equal(originalMaterializations, 0);
		assert.ok(observedGrant);
		assert.deepEqual((observedGrant as HelperMediaEncodeJobGrant).sources.map(({ type, role }) => (
			{ type, role }
		)), [{ type: 'stream', role: 'evaluated-rgba-frame-pack' }]);
		assert.equal((observedGrant as HelperMediaEncodeJobGrant).backend, 'vaapi');
		assert.equal(receipt.sha256, digest(OUTPUT_BYTES));
		liveHost.close();
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test('V14 hardware refusal replays one authenticated live carrier exactly once on native CPU', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'framescaper-v14-live-retry-'));
	try {
		const fixture = liveRetryFixture();
		const staging = new FramescaperNativeLiveRenderInputStaging({
			root: join(directory, 'render-inputs'), mintStageId: () => LIVE_JOB_ID,
			createMessageChannel: () => {
				const [hostPort, helperPort] = portPair(); return { hostPort, helperPort };
			},
		});
		await staging.beginLive(LIVE_OWNER, liveBeginRequest(fixture));
		await staging.finalize(LIVE_OWNER, { stageId: LIVE_JOB_ID });
		await staging.claim(LIVE_OWNER, liveClaimRequest(fixture));
		const record = liveQueueRecord(fixture);
		const derivedInputs = await staging.inspect(record);
		const descriptor = await mediaHostDescriptor(directory);
		const root = join(directory, 'exports'); await mkdir(root);
		const rootDetails = await lstat(root, { bigint: true });
		const publication = createNativeMediaPublicationPlan({
			jobId: LIVE_JOB_ID, relativeDestination: record.relativeDestination,
			planFingerprint: fixture.envelope.fingerprint,
		});
		const attempts: string[] = [];
		const authenticatedCarriers: Uint8Array[] = [];
		let outputWrites = 0;
		let carrierReadyResolve = (): void => undefined;
		const carrierReady = new Promise<void>((resolve) => { carrierReadyResolve = resolve; });
		const adapter = createNativeMediaV14HelperAdapter({
			descriptor, scratchRoot: join(directory, 'helper-scratch'),
			createMessageChannel: () => {
				const [hostPort, helperPort] = portPair(); return { hostPort, helperPort };
			},
			runJob: async (request) => {
				if (request.kind !== 'media-render') throw new Error('The retry fixture requires media-render.');
				const grant = request.grant as HelperMediaEncodeJobGrant;
				attempts.push(grant.backend);
				await receiveHelperDataPlaneFile({
					binding: grant.plan,
					port: request.dataPlaneTransfers![0]!.port as HelperDataPlaneIoPort,
					path: join(directory, `received-${grant.backend}-plan.json`),
				});
				const source = grant.sources[0]!;
				let carrier: Uint8Array;
				if (source.type === 'file') {
					carrierReadyResolve();
					carrier = new Uint8Array(await readFile(source.path));
				}
				else {
					if (!('authentication' in source.binding)) {
						throw new Error('The retry fixture requires a trailer-authenticated live carrier.');
					}
					const chunks: Uint8Array[] = [];
					const receiving = receiveHelperDataPlaneInputStream({
						reservation: source.binding,
						port: request.dataPlaneTransfers![1]!.port as HelperDataPlaneIoPort,
						sink: {
							write: (bytes) => { chunks.push(new Uint8Array(bytes)); },
							complete: () => undefined, abort: () => undefined,
						},
					});
					carrierReadyResolve();
					await receiving;
					carrier = concatenate(chunks);
				}
				authenticatedCarriers.push(carrier);
				if (grant.backend === 'vaapi') {
					throw Object.assign(new Error('VAAPI rejected the exact carrier.'), {
						code: 'hardware-encoder-unavailable',
					});
				}
				outputWrites += 1;
				await writeFile(grant.output.temporaryPath, OUTPUT_BYTES, { flag: 'wx' });
				const outputDetails = await lstat(grant.output.temporaryPath);
				return { output: { temporaryPath: grant.output.temporaryPath,
					byteLength: OUTPUT_BYTES.byteLength, sha256: digest(OUTPUT_BYTES),
					identity: { dev: outputDetails.dev, ino: outputDetails.ino } } };
			},
		});
		const sourceBodies = fixture.envelope.plan.sources.map((source, index) => ({
			grantId: String(index + 1).repeat(40), sourceId: source.sourceId,
			contentSha256: source.contentSha256!, mimeType: source.mimeType, byteLength: 4,
			materialize: async () => { throw new Error('A carrier render must not copy originals.'); },
		}));
		const executing = executeNativeMediaPlanV14({
			envelope: fixture.envelope, jobId: LIVE_JOB_ID,
			backendPlan: { platform: 'linux', operation: 'encode',
				attempts: ['vaapi', NATIVE_MEDIA_CPU_BACKEND],
				fallback: NATIVE_MEDIA_WEB_BACKEND, reason: 'hardware-then-cpu' },
			sources: sourceBodies.map(({ sourceId, grantId, contentSha256 }) => ({
				sourceId, grantId, contentSha256,
			})),
			rootGrantId: 'ab'.repeat(16), relativeDestination: record.relativeDestination,
			native: { execute: (attempt) => adapter.execute({
				adapterVersion: 1, attempt, sourceBodies, timingBodies: [], derivedInputs,
				destination: {
					jobId: LIVE_JOB_ID, rootPath: root,
					volumeIdentity: `device:${rootDetails.dev.toString(16)}`,
					directoryIdentity: `device:${rootDetails.dev.toString(16)}:inode:${rootDetails.ino.toString(16)}`,
					relativeDestination: record.relativeDestination,
					temporaryRelativePath: publication.temporaryRelativePath,
				},
				onProgress: () => undefined,
			}) },
			web: { execute: async () => { throw new Error('CPU replay must succeed before Web Core.'); } },
		});
		await Promise.race([
			carrierReady,
			new Promise<void>((resolve) => setTimeout(resolve, 50)),
		]);
		const carrier = await streamLiveCarrier(staging, fixture);
		const result = await executing;
		assert.equal(result.backend, NATIVE_MEDIA_CPU_BACKEND);
		assert.deepEqual(result.failedBackends, ['vaapi']);
		assert.deepEqual(attempts, ['vaapi', NATIVE_MEDIA_CPU_BACKEND]);
		assert.equal(authenticatedCarriers.length, 2);
		assert.deepEqual(authenticatedCarriers[0], carrier);
		assert.deepEqual(authenticatedCarriers[1], carrier);
		const hardwarePlan = new Uint8Array(await readFile(join(directory, 'received-vaapi-plan.json')));
		const cpuPlan = new Uint8Array(await readFile(join(directory, 'received-native-cpu-plan.json')));
		assert.deepEqual(hardwarePlan, cpuPlan, 'CPU retry retains the identical canonical plan bytes');
		assert.equal(digest(cpuPlan), fixture.envelope.fingerprint);
		assert.equal(outputWrites, 1, 'only the successful CPU attempt creates a publication candidate');
		await assert.rejects(() => derivedInputs.materialize(join(directory, 'third-attempt')),
			/only hardware and one CPU attempt/iu, 'carrier replay is hard-bounded to the selected retry plan');
		await staging.settle(record, 'succeeded');
		await assert.rejects(() => derivedInputs.materialize(join(directory, 'stale')),
			/stage|input|file|exist|resident/iu, 'settled carrier authority cannot be replayed');
	} finally { await rm(directory, { recursive: true, force: true }); }
});

async function mediaHostDescriptor(directory: string): Promise<FramescaperMediaHostDescriptor> {
	const path = join(directory, 'framescaper-media-host');
	const bytes = new Uint8Array([4, 2, 4, 2]);
	await writeFile(path, bytes, { mode: 0o700 });
	const details = await lstat(path);
	return framescaperMediaHostDescriptorFixture(Object.freeze({
		target: 'linux-x64', runtime: 'linux-x64', path,
		byteLength: bytes.byteLength, sha256: digest(bytes),
		hostVersion: 'test', ffmpegVersion: '9.0.1',
		identity: Object.freeze({ dev: details.dev, ino: details.ino }),
	}));
}

function proxyEnvelope() {
	const profile = FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE;
	const options = framescaperV20Options();
	options.sources = (options.sources as Array<Record<string, unknown>>).map((source) => (
		source.kind === 'video' ? { ...source, contentSha256: digest(SOURCE_BYTES), videoCodec: 'h264',
			characteristics: normalizeVideoSourceCharacteristicsV25({
				backend: 'framescaper-media-host', codedWidth: 1_920, codedHeight: 1_080,
				videoCodec: 'h264', hasAlpha: false, bitDepth: 10,
				pixelFormat: 'yuv420p10le', chromaFormat: '4:2:0',
			}) } : source
	));
	const project = createFramescaperProjectV28(profile, options);
	return createNativeMediaPlanEnvelopeV2(createFramescaperProjectUnifiedExactRenderPlanV28(
		profile, project, createFramescaperNativeRenderPlanAuthorityV28(project),
	));
}

function liveRetryFixture() {
	const profile = FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE;
	const options = framescaperV20Options();
	options.sources = (options.sources as Array<Record<string, unknown>>)
		.filter(({ kind }) => kind === 'video').map((source) => ({
			...source, width: 2, height: 2, sourceFrameCount: 1,
			frameRate: { num: 1, den: 1 },
			timingDecision: { mode: 'conform-cfr-at-ingest', rate: { num: 1, den: 1 } },
		}));
	options.clips = (options.clips as Array<Record<string, unknown>>)
		.filter(({ kind }) => kind === 'video').map((clip) => ({
			...clip, sequenceFrameCount: 1, sourceFrameCount: 1,
		}));
	options.projectBin = { clips: ((options.projectBin as { clips: Array<Record<string, unknown>> }).clips)
		.map((clip) => ({ ...clip, sequenceFrameCount: 1, sourceFrameCount: 1 })) };
	options.tracks = (options.tracks as Array<Record<string, unknown>>)
		.filter(({ type }) => type === 'video');
	options.sequences = [{ id: 'main-sequence', rate: { num: 1, den: 1 }, trackIds: ['video-track'] }];
	const project = createFramescaperProjectV28(profile, options);
	const plan = createFramescaperProjectUnifiedExactRenderPlanV28(
		profile, project, createFramescaperNativeRenderPlanAuthorityV28(project),
	);
	const envelope = createNativeMediaPlanEnvelopeV2(plan);
	const carrierByteLength = nativeRgbaFramePackV1ByteLength({
		width: envelope.summary.width, height: envelope.summary.height,
		frameCount: envelope.summary.outputFrameCount,
	});
	return { project, plan, envelope, carrierByteLength };
}

function liveBeginRequest(fixture: ReturnType<typeof liveRetryFixture>) {
	return Object.freeze({
		liveRenderVersion: 1 as const, planVersion: 14 as const,
		planFingerprint: fixture.envelope.fingerprint, planPayload: JSON.stringify(fixture.plan),
		projectId: fixture.project.id, projectRevision: fixture.project.revision,
		inputFingerprints: [{ sourceId: 'video-source', sha256: '12'.repeat(32) }],
		restartJobId: null, carrierByteLength: fixture.carrierByteLength, audio: null,
	});
}

function liveClaimRequest(fixture: ReturnType<typeof liveRetryFixture>) {
	const begin = liveBeginRequest(fixture);
	return Object.freeze({
		derivedInputStageId: LIVE_JOB_ID, planVersion: 14 as const,
		planFingerprint: begin.planFingerprint, planPayload: begin.planPayload,
		projectId: begin.projectId, projectRevision: begin.projectRevision,
		inputFingerprints: begin.inputFingerprints,
	});
}

function liveQueueRecord(fixture: ReturnType<typeof liveRetryFixture>) {
	return createNativeQueueRecordV3({
		jobId: LIVE_JOB_ID, taskKind: 'encoded-export', plan: fixture.plan,
		projectId: String(fixture.project.id), projectRevision: Number(fixture.project.revision),
		inputFingerprints: [{ sourceId: 'video-source', sha256: '12'.repeat(32) }],
		rootGrantId: 'ab'.repeat(16), relativeDestination: 'renders/live-retry.mov',
		reservations: { cpuCores: 2, processTreeRssBytes: 1024 ** 3,
			scratchBytes: 1024 ** 2, minimumFreeBytes: 0, hardwareBackend: 'vaapi' },
		position: 0, createdAtMs: 1,
	});
}

async function streamLiveCarrier(
	staging: FramescaperNativeLiveRenderInputStaging,
	fixture: ReturnType<typeof liveRetryFixture>,
): Promise<Uint8Array> {
	const rate = fixture.envelope.summary.frameRate;
	if (rate.kind !== 'rational') throw new Error('The live retry fixture cadence is not rational.');
	const chunks: Uint8Array[] = [];
	const result = await streamFramescaperNativeRgbaFramePackV1({
		width: fixture.envelope.summary.width, height: fixture.envelope.summary.height,
		frameCount: fixture.envelope.summary.outputFrameCount,
		frameRate: { num: rate.num, den: rate.den }, signal: new AbortController().signal,
		assertCurrent: () => undefined,
		renderFrame: (ordinal, output) => { output.fill(ordinal + 1); },
	}, {
		write: async (bytes) => {
			const owned = new Uint8Array(bytes); const offset = chunks.reduce((sum, row) => sum + row.byteLength, 0);
			await staging.writeLive(LIVE_OWNER, {
				stageId: LIVE_JOB_ID, role: 'evaluated-rgba-frame-pack',
				sequence: chunks.length, offset, bytes: owned,
			});
			chunks.push(owned);
		},
	});
	await staging.completeLive(LIVE_OWNER, {
		stageId: LIVE_JOB_ID, role: 'evaluated-rgba-frame-pack',
		byteLength: result.byteLength, sha256: result.sha256,
	});
	return concatenate(chunks);
}

function concatenate(chunks: readonly Uint8Array[]): Uint8Array {
	const output = new Uint8Array(chunks.reduce((sum, bytes) => sum + bytes.byteLength, 0));
	let offset = 0;
	for (const bytes of chunks) { output.set(bytes, offset); offset += bytes.byteLength; }
	return output;
}

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

class Port extends EventEmitter implements HelperDataPlaneIoPort {
	peer: Port | null = null;
	postMessage(message: unknown): void { queueMicrotask(() => this.peer?.emit('message', { data: message })); }
	start(): void {}
	close(): void {}
}

function portPair(): readonly [Port, Port] {
	const left = new Port();
	const right = new Port();
	left.peer = right;
	right.peer = left;
	return [left, right] as const;
}
