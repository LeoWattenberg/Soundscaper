/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { FramescaperNativeSelectedV28ProjectAuthority } from '../desktop/native-services-selected-v28-project-authority.ts';
import type {
	FramescaperNativeMediaProxyV14RuntimeRequest,
	FramescaperNativeMediaV14RuntimeRequest,
} from '../desktop/native-media-v14-runtime-contract.ts';
import type { FramescaperNativeRootGrant } from '../desktop/native-services-root-repository.ts';
import type { FramescaperNativeDerivedRenderInputs } from '../desktop/native-services-render-input-staging.ts';
import { createNativeQueueRecordV3 } from '../src/common/editor/native-queue-record-v3.ts';
import { canonicalizeNativeMediaPlan } from '../src/common/editor/native-media-plan-canonical-form.ts';
import { createNativeMediaPlanEnvelopeV2 } from '../src/common/editor/native-media-plan-envelope-v2.ts';
import { normalizeVideoSourceCharacteristicsV25 } from '../src/common/editor/video-source-professional-characteristics-v25.ts';
import { NATIVE_MEDIA_CPU_BACKEND } from '../src/common/editor/native-media-backend-policy.ts';
import { createFramescaperNativeRenderPlanAuthorityV28 } from '../src/framescaper/editor-native-render-plan-authority-v28.ts';
import { createFramescaperProjectUnifiedExactRenderPlanV28 } from '../src/framescaper/editor-project-unified-render-plan-v28.ts';
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v28.ts';
import { createFramescaperProjectV28 } from '../src/framescaper/editor-project-v28.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

const ROOT: FramescaperNativeRootGrant = Object.freeze({
	grantId: 'ab'.repeat(16), rootPath: '/private/v28-exports',
	volumeIdentity: 'volume-v28', directoryIdentity: 'directory-v28',
	authorizedAtMs: 1, revokedAtMs: null,
});

test('selected V28 reserves an image-sequence export from exact pack and inventory custody', async () => {
	const fixture = imageSequenceReservationFixture();
	const replayBytes = 4_096;
	const reservation = fixture.authority.queueReservations(fixture.request, replayBytes);
	assert.ok(reservation.scratchBytes > replayBytes);
	const running = createNativeQueueRecordV3({
		jobId: 'bc'.repeat(20), taskKind: 'image-sequence-export', plan: fixture.plan,
		projectId: fixture.request.projectId, projectRevision: fixture.request.projectRevision,
		inputFingerprints: fixture.request.inputFingerprints, rootGrantId: ROOT.grantId,
		relativeDestination: fixture.request.relativeDestination, reservations: reservation,
		position: 0, createdAtMs: 1,
	});
	const revalidation = await fixture.authority.revalidate(Object.freeze({
		...running, state: 'running' as const, progress: 0.5,
	}), ROOT, true);
	assert.equal(revalidation.scratchIdentityMatches, false);
	assert.throws(() => fixture.authorityWithBodies([
		fixture.bodies[0]!, Object.freeze({ ...fixture.bodies[1]!, sha256: 'ff'.repeat(32) }),
	]).queueReservations(fixture.request, replayBytes), /exact project bodies/iu);
	assert.throws(() => fixture.authority.queueReservations(fixture.request, 0), /replay reservation/iu);
});

test('selected V28 truthfully routes its exact evaluated carrier only through native encode and mux', async () => {
	const bytes = new Uint8Array([1, 2, 3, 4]);
	const sourceSha256 = digest(bytes);
	const profile = FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE;
	const options = framescaperV20Options();
	options.sources = (options.sources as Array<Record<string, unknown>>).map((source) => (
		source.kind === 'video' ? { ...source, contentSha256: sourceSha256 } : source
	));
	const project = createFramescaperProjectV28(profile, options);
	const projectId = String(project.id);
	const projectRevision = Number(project.revision);
	const plan = createFramescaperProjectUnifiedExactRenderPlanV28(
		profile, project, createFramescaperNativeRenderPlanAuthorityV28(project),
	);
	const record = createNativeQueueRecordV3({
		jobId: 'cd'.repeat(20), taskKind: 'encoded-export', plan,
		projectId, projectRevision,
		inputFingerprints: [{ sourceId: 'video-source', sha256: sourceSha256 }],
		rootGrantId: ROOT.grantId, relativeDestination: 'renders/v28.mov',
		reservations: {
			cpuCores: 2, processTreeRssBytes: 1024 ** 3, scratchBytes: 1024 ** 2,
			minimumFreeBytes: 0, hardwareBackend: null,
		},
		position: 0, createdAtMs: 1,
	});
	const body = Object.freeze({
		kind: 'video-original' as const, encoding: 'blob-v1', sourceId: 'video-source',
		storageKey: 'video-source', mimeType: 'video/mp4', byteLength: bytes.byteLength,
		sha256: sourceSha256,
	});
	const projectSha256 = 'ef'.repeat(32);
	const derivedInputs: FramescaperNativeDerivedRenderInputs = Object.freeze({
		byteLength: 16,
		scratchByteLength: 16,
		materialize: async () => Object.freeze([]),
	});
	const publication = publicationHarness(record, { byteLength: 128, sha256: '12'.repeat(32) });
	const requests: FramescaperNativeMediaV14RuntimeRequest[] = [];
	let nativeFailure = false;
	let wholeBodyReads = 0;
	let materializations = 0;
	let renderInputRevalidations = 0;
	let inspectFailure = false;
	let inspectedInputs = derivedInputs;
	const settlements: string[] = [];
	const authority = new FramescaperNativeSelectedV28ProjectAuthority({
		project: {
			projectState: () => Object.freeze({ open: true, writable: true }),
			projectRecord: () => Object.freeze({
				projectId, projectRevision, projectSha256,
				bodies: Object.freeze([body]),
			}),
			readProjectBundle: async () => Object.freeze({
				project: Object.freeze({ projectRevision, sha256: projectSha256 }),
				bodies: Object.freeze([body]),
			}),
			readBody: async () => { wholeBodyReads += 1; return new Uint8Array(bytes); },
			materializeBody: async () => {
				materializations += 1;
				return Object.freeze({ byteLength: bytes.byteLength, sha256: sourceSha256 });
			},
		},
		watch: {
			projectState: () => Object.freeze({ open: true, writable: true }),
			watchProject: () => null, watchImportAlreadyPresent: async () => false,
		},
		runtime: {
			available: () => true,
			executeProxyV14: async () => { throw new Error('proxy path must not run'); },
			executeV14: async (request) => {
				requests.push(request);
				if (nativeFailure) throw Object.assign(new Error('native subset unavailable'), {
					code: 'unsupported-render-subset',
				});
				await request.sourceBodies[0]!.materialize('/private/helper/source.media', request.attempt.signal);
				return Object.freeze({
					planFingerprint: request.attempt.envelope.fingerprint,
					byteLength: 128, sha256: '12'.repeat(32), publication: 'verified-temporary' as const,
				});
			},
		},
		renderInputs: {
			revalidate: async () => { renderInputRevalidations += 1; return true; },
			inspect: async () => {
				if (inspectFailure) throw new Error('injected inspect failure');
				return inspectedInputs;
			},
			settle: async (_record, outcome) => { settlements.push(outcome); },
		},
		platform: 'linux', probeRoot: async () => Object.freeze({
			exists: true, directory: true, symbolicLink: false, canonicalPath: ROOT.rootPath,
			volumeIdentity: ROOT.volumeIdentity, directoryIdentity: ROOT.directoryIdentity,
		}),
		publicationPortFor: publication.portFor,
		publicationFenceFor: publication.fenceFor,
	});

	const prepared = await authority.prepare(record, ROOT);
	if (!prepared.execute || !prepared.publish) throw new Error('Selected V28 preparation returned no executable publication.');
	const result = await prepared.execute({ signal: new AbortController().signal, onProgress: () => undefined });
	assert.equal((result as { outcome: string }).outcome, 'native');
	assert.deepEqual(requests.map(({ attempt }) => attempt.backend), [NATIVE_MEDIA_CPU_BACKEND]);
	assert.strictEqual(requests[0]?.derivedInputs, derivedInputs);
	assert.equal(wholeBodyReads, 0);
	assert.equal(materializations, 1);
	await prepared.publish(result);
	assert.deepEqual(publication.events, ['inspect-destination', 'inspect-temporary',
		'fence-before', 'rename', 'inspect-destination', 'fence-after']);
	await prepared.cleanup?.('succeeded');
	nativeFailure = true;
	publication.events.length = 0;
	const webRequired = await authority.prepare(record, ROOT);
	await assert.rejects(
		webRequired.execute!({ signal: new AbortController().signal, onProgress: () => undefined }),
		(error: unknown) => (error as Readonly<{ readonly code?: unknown }>).code === 'web-core-required',
	);
	assert.deepEqual(requests.map(({ attempt }) => attempt.backend), [
		NATIVE_MEDIA_CPU_BACKEND, NATIVE_MEDIA_CPU_BACKEND,
	]);
	assert.deepEqual(publication.events, [], 'a typed Web Core requirement publishes no native output');
	await webRequired.cleanup?.('failed');
	const recovery = await authority.revalidate(Object.freeze({
		...record, state: 'paused' as const, progress: null,
		lastFailureCode: 'awaiting-carrier-regeneration',
	}), ROOT, true);
	assert.equal(recovery.inputFingerprintsMatch, true);
	assert.equal(recovery.scratchIdentityMatches, true);
	assert.equal(renderInputRevalidations, 0,
		'only the absent process-local carrier stage is exempt while durable source authority is rechecked');
	settlements.length = 0;
	inspectFailure = true;
	await assert.rejects(() => authority.prepare(record, ROOT), /injected inspect failure/iu);
	inspectFailure = false;
	inspectedInputs = Object.freeze({ ...derivedInputs,
		scratchByteLength: record.reservations.scratchBytes });
	await assert.rejects(() => authority.prepare(record, ROOT), /scratch reservation/iu);
	assert.deepEqual(settlements, ['failed', 'failed'],
		'inspect and post-inspect body admission both revoke their authenticated carrier custody');
});

test('selected V28 runs its carrier-free legacy-unmanaged full-frame family on native CPU', async () => {
	const bytes = new Uint8Array([1, 2, 3, 4]);
	const sourceSha256 = digest(bytes);
	const profile = FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE;
	const options = silentVideoOptions();
	options.sources = (options.sources as Array<Record<string, unknown>>).map((source) => (
		source.kind === 'video' ? { ...source, contentSha256: sourceSha256 } : source
	));
	const derived = createFramescaperProjectV28(profile, options);
	options.finishing = { sourceColorInterpretations: derived.videoSourceColorInterpretations.map(
		(interpretation) => ({ ...interpretation, provenance: 'legacy-unmanaged-encoded' }),
	) };
	const project = createFramescaperProjectV28(profile, options);
	const plan = createFramescaperProjectUnifiedExactRenderPlanV28(
		profile, project, createFramescaperNativeRenderPlanAuthorityV28(project),
	);
	const projectId = String(project.id);
	const projectRevision = Number(project.revision);
	const record = createNativeQueueRecordV3({
		jobId: 'de'.repeat(20), taskKind: 'encoded-export', plan, projectId, projectRevision,
		inputFingerprints: [{ sourceId: 'video-source', sha256: sourceSha256 }],
		rootGrantId: ROOT.grantId, relativeDestination: 'renders/v28-cpu.mov',
		reservations: { cpuCores: 2, processTreeRssBytes: 1024 ** 3,
			scratchBytes: 1024 ** 2, minimumFreeBytes: 0, hardwareBackend: null },
		position: 0, createdAtMs: 1,
	});
	const body = Object.freeze({
		kind: 'video-original' as const, encoding: 'blob-v1', sourceId: 'video-source',
		storageKey: 'video-source', mimeType: 'video/mp4', byteLength: bytes.byteLength,
		sha256: sourceSha256,
	});
	const requests: FramescaperNativeMediaV14RuntimeRequest[] = [];
	const publication = publicationHarness(record, { byteLength: 128, sha256: '12'.repeat(32) });
	const authority = new FramescaperNativeSelectedV28ProjectAuthority({
		project: {
			projectState: () => ({ open: true, writable: true }),
			projectRecord: () => ({ projectId, projectRevision, projectSha256: 'ef'.repeat(32), bodies: [body] }),
			readProjectBundle: async () => ({
				project: { projectRevision, sha256: 'ef'.repeat(32) }, bodies: [body],
			}),
			readBody: async () => new Uint8Array(bytes),
			materializeBody: async () => ({ byteLength: bytes.byteLength, sha256: sourceSha256 }),
		},
		watch: { projectState: () => ({ open: true, writable: true }), watchProject: () => null,
			watchImportAlreadyPresent: async () => false },
		runtime: { available: () => true,
			executeProxyV14: async () => { throw new Error('proxy path must not run'); },
			executeV14: async (request) => {
			requests.push(request);
			return { planFingerprint: request.attempt.envelope.fingerprint,
				byteLength: 128, sha256: '12'.repeat(32), publication: 'verified-temporary' as const };
		} },
		renderInputs: { revalidate: async () => true,
			inspect: async () => { throw new Error('carrier inspection must not run'); },
			settle: async () => undefined },
		platform: 'linux', probeRoot: async () => ({ exists: true, directory: true,
			symbolicLink: false, canonicalPath: ROOT.rootPath, volumeIdentity: ROOT.volumeIdentity,
			directoryIdentity: ROOT.directoryIdentity }),
		publicationPortFor: publication.portFor,
		publicationFenceFor: publication.fenceFor,
	});
	const prepared = await authority.prepare(record, ROOT);
	const result = await prepared.execute!({ signal: new AbortController().signal, onProgress: () => undefined });
	assert.equal((result as { outcome: string }).outcome, 'native');
	assert.deepEqual(requests.map(({ attempt }) => attempt.backend), [NATIVE_MEDIA_CPU_BACKEND]);
	assert.equal(requests[0]?.derivedInputs, null);
	await prepared.publish!(result);
	assert.equal(publication.events.includes('rename'), true);
	await prepared.cleanup?.('succeeded');
	const recovery = await authority.revalidate(Object.freeze({
		...record, state: 'running' as const, progress: 0.5,
	}), ROOT, true);
	assert.equal(recovery.inputFingerprintsMatch, true);
	assert.equal(recovery.scratchIdentityMatches, true,
		'carrier-free atomic work owns no process-local stage and can restart from zero');
});

test('selected V28 attempts the opted-in OS baseline encoder once before identical native CPU', async () => {
	const bytes = new Uint8Array([1, 2, 3, 4]);
	const sourceSha256 = digest(bytes);
	const profile = FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE;
	const options = silentVideoOptions();
	options.sources = (options.sources as Array<Record<string, unknown>>).map((source) => (
		source.kind === 'video' ? { ...source, contentSha256: sourceSha256 } : source
	));
	const derived = createFramescaperProjectV28(profile, options);
	options.finishing = { sourceColorInterpretations: derived.videoSourceColorInterpretations.map(
		(interpretation) => ({ ...interpretation, provenance: 'legacy-unmanaged-encoded' }),
	) };
	const project = createFramescaperProjectV28(profile, options);
	const plan = createFramescaperProjectUnifiedExactRenderPlanV28(
		profile, project, createFramescaperNativeRenderPlanAuthorityV28(project),
	);
	const projectId = String(project.id);
	const projectRevision = Number(project.revision);
	const record = createNativeQueueRecordV3({
		jobId: 'da'.repeat(20), taskKind: 'encoded-export', plan, projectId, projectRevision,
		inputFingerprints: [{ sourceId: 'video-source', sha256: sourceSha256 }],
		rootGrantId: ROOT.grantId, relativeDestination: 'renders/v28-hardware.mov',
		reservations: { cpuCores: 2, processTreeRssBytes: 1024 ** 3,
			scratchBytes: 1024 ** 2, minimumFreeBytes: 0, hardwareBackend: 'vaapi' },
		position: 0, createdAtMs: 1,
	});
	const body = Object.freeze({
		kind: 'video-original' as const, encoding: 'blob-v1', sourceId: 'video-source',
		storageKey: 'video-source', mimeType: 'video/mp4', byteLength: bytes.byteLength,
		sha256: sourceSha256,
	});
	const requests: FramescaperNativeMediaV14RuntimeRequest[] = [];
	const publication = publicationHarness(record, { byteLength: 128, sha256: '12'.repeat(32) });
	const authority = new FramescaperNativeSelectedV28ProjectAuthority({
		project: {
			projectState: () => ({ open: true, writable: true }),
			projectRecord: () => ({ projectId, projectRevision, projectSha256: 'ef'.repeat(32), bodies: [body] }),
			readProjectBundle: async () => ({
				project: { projectRevision, sha256: 'ef'.repeat(32) }, bodies: [body],
			}),
			readBody: async () => new Uint8Array(bytes),
			materializeBody: async () => ({ byteLength: bytes.byteLength, sha256: sourceSha256 }),
		},
		watch: { projectState: () => ({ open: true, writable: true }), watchProject: () => null,
			watchImportAlreadyPresent: async () => false },
		runtime: { available: () => true,
			executeProxyV14: async () => { throw new Error('proxy path must not run'); },
			executeV14: async (request) => {
				requests.push(request);
				if (request.attempt.backend === 'vaapi') {
					const error = new Error('The VAAPI encoder is unavailable.') as Error & { code: string };
					error.code = 'hardware-encoder-unavailable';
					throw error;
				}
				return { planFingerprint: request.attempt.envelope.fingerprint,
					byteLength: 128, sha256: '12'.repeat(32), publication: 'verified-temporary' as const };
			} },
		renderInputs: { revalidate: async () => true,
			inspect: async () => { throw new Error('carrier inspection must not run'); },
			settle: async () => undefined },
		platform: 'linux', probeRoot: async () => ({ exists: true, directory: true,
			symbolicLink: false, canonicalPath: ROOT.rootPath, volumeIdentity: ROOT.volumeIdentity,
			directoryIdentity: ROOT.directoryIdentity }),
		publicationPortFor: publication.portFor,
		publicationFenceFor: publication.fenceFor,
	});
	const prepared = await authority.prepare(record, ROOT);
	const result = await prepared.execute!({ signal: new AbortController().signal, onProgress: () => undefined });
	assert.equal((result as { outcome: string }).outcome, 'native');
	assert.deepEqual(requests.map(({ attempt }) => attempt.backend), ['vaapi', NATIVE_MEDIA_CPU_BACKEND]);
	assert.deepEqual((result as { failedBackends: readonly string[] }).failedBackends, ['vaapi']);
});

test('selected V28 prepares one exact original as a native ProRes Proxy MOV job', async () => {
	const bytes = new Uint8Array([4, 3, 2, 1]);
	const sourceSha256 = digest(bytes);
	const profile = FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE;
	const options = framescaperV20Options();
	options.sources = (options.sources as Array<Record<string, unknown>>).map((source) => (
		source.kind === 'video' ? {
			...source,
			contentSha256: sourceSha256,
			videoCodec: 'h264',
			characteristics: professionalCharacteristics(),
		} : source
	));
	const project = createFramescaperProjectV28(profile, options);
	const projectId = String(project.id);
	const projectRevision = Number(project.revision);
	const plan = createFramescaperProjectUnifiedExactRenderPlanV28(
		profile, project, createFramescaperNativeRenderPlanAuthorityV28(project),
	);
	const record = createNativeQueueRecordV3({
		jobId: 'df'.repeat(20), taskKind: 'proxy-generation', plan,
		projectId, projectRevision,
		inputFingerprints: [{ sourceId: 'video-source', sha256: sourceSha256 }],
		rootGrantId: ROOT.grantId, relativeDestination: 'proxies/video-source.mov',
		reservations: { cpuCores: 2, processTreeRssBytes: 1024 ** 3,
			scratchBytes: 1024 ** 2, minimumFreeBytes: 0, hardwareBackend: null },
		position: 0, createdAtMs: 1,
	});
	const body = Object.freeze({
		kind: 'video-original' as const, encoding: 'blob-v1', sourceId: 'video-source',
		storageKey: 'video-source', mimeType: 'video/mp4', byteLength: bytes.byteLength,
		sha256: sourceSha256,
	});
	const requests: FramescaperNativeMediaProxyV14RuntimeRequest[] = [];
	const publication = publicationHarness(record, { byteLength: 96, sha256: '34'.repeat(32) });
	let materializations = 0;
	let recordedProxyOutput = false;
	const authority = new FramescaperNativeSelectedV28ProjectAuthority({
		project: {
			projectState: () => ({ open: true, writable: true }),
			projectRecord: () => ({ projectId, projectRevision,
				projectSha256: 'ef'.repeat(32), bodies: [body] }),
			readProjectBundle: async () => ({
				project: { projectRevision, sha256: 'ef'.repeat(32) }, bodies: [body],
			}),
			readBody: async () => { throw new Error('whole source reads must not run'); },
			materializeBody: async () => {
				materializations += 1;
				return { byteLength: bytes.byteLength, sha256: sourceSha256 };
			},
		},
		watch: { projectState: () => ({ open: true, writable: true }), watchProject: () => null,
			watchImportAlreadyPresent: async () => false },
		runtime: {
			available: () => true,
			executeV14: async () => { throw new Error('render path must not run'); },
			executeProxyV14: async (request) => {
				requests.push(request);
				await request.sourceBody.materialize('/private/helper/source.media', request.signal);
				return { planFingerprint: request.envelope.fingerprint, byteLength: 96,
					sha256: '34'.repeat(32), publication: 'verified-temporary' as const };
			},
		},
		renderInputs: { revalidate: async () => true,
			inspect: async () => { throw new Error('proxy carrier inspection must not run'); },
			settle: async () => undefined },
		platform: 'linux', probeRoot: async () => ({ exists: true, directory: true,
			symbolicLink: false, canonicalPath: ROOT.rootPath, volumeIdentity: ROOT.volumeIdentity,
			directoryIdentity: ROOT.directoryIdentity }),
		publicationPortFor: publication.portFor,
		publicationFenceFor: publication.fenceFor,
		recordProxyOutput: (_record, _root, receipt) => {
			recordedProxyOutput = receipt.sha256 === '34'.repeat(32);
		},
	});

	const prepared = await authority.prepare(record, ROOT);
	const result = await prepared.execute!({ signal: new AbortController().signal, onProgress: () => undefined });
	assert.equal((result as { outcome: string }).outcome, 'native');
	assert.equal(materializations, 1);
	assert.equal(requests.length, 1);
	assert.deepEqual(requests[0]?.recipe, {
		id: 'framescaper-native-prores-proxy-mov-v1', width: 1_280, height: 720,
	});
	assert.equal(requests[0]?.sourceBody.sourceId, 'video-source');
	assert.equal(requests[0]?.timingBodies.length, 0);
	await prepared.publish!(result);
	assert.equal(publication.events.includes('rename'), true);
	assert.equal(recordedProxyOutput, true);
	await prepared.cleanup?.('succeeded');
});

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

function publicationHarness(
	record: Readonly<{ relativeDestination: string; planFingerprint: string }>,
	output: Readonly<{ byteLength: number; sha256: string }>,
) {
	const events: string[] = [];
	let published = false;
	const observation = Object.freeze({ ...output, symbolicLink: false });
	return Object.freeze({
		events,
		portFor: () => Object.freeze({
			inspect: async (relativePath: string) => {
				const destination = relativePath === record.relativeDestination;
				events.push(destination ? 'inspect-destination' : 'inspect-temporary');
				return destination ? (published ? observation : null) : observation;
			},
			renameTemporarySibling: async () => { events.push('rename'); published = true; },
			removePublishedOutput: async () => { events.push('remove'); published = false; },
		}),
		fenceFor: () => Object.freeze({
			beforePublication: async () => { events.push('fence-before'); },
			afterPublication: async () => { events.push('fence-after'); },
		}),
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

function professionalCharacteristics() {
	return normalizeVideoSourceCharacteristicsV25({
		backend: 'framescaper-media-host', codedWidth: 1_920, codedHeight: 1_080,
		hasAlpha: false, videoCodec: 'h264', bitDepth: 10, pixelFormat: 'yuv420p10le',
		chromaFormat: '4:2:0', colour: {
			primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', range: 'limited',
		},
	});
}

function imageSequenceReservationFixture() {
	const packSha256 = 'ab'.repeat(32);
	const inventorySha256 = 'cd'.repeat(32);
	const packStorageKey = `image-sequence-pack-sha256:${packSha256}`;
	const inventoryStorageKey = `image-sequence-inventory-sha256:${inventorySha256}`;
	const characteristics = normalizeVideoSourceCharacteristicsV25({
		backend: 'framescaper-media-host', codedWidth: 1_920, codedHeight: 1_080,
		hasAlpha: true, videoCodec: 'png', bitDepth: 16, pixelFormat: 'rgba64be',
		chromaFormat: '4:4:4', colour: {
			primaries: 'bt709', transfer: 'bt709', matrix: 'rgb', range: 'full',
		},
	}, { rate: { num: 10, den: 1 } });
	const imageSequence = Object.freeze({
		kind: 'video', sourceType: 'image-sequence', version: 1, id: 'video-source',
		name: 'Video', stem: 'frame_', extension: 'png', frameNumberWidth: 4,
		firstFrameNumber: 1, lastFrameNumber: 10, frameCount: 10,
		frameRate: Object.freeze({ num: 10, den: 1 }),
		inventory: Object.freeze({
			kind: 'image-sequence-inventory', version: 1, storageKey: inventoryStorageKey,
			sha256: inventorySha256, byteLength: 123, frameCount: 10,
			firstFrameNumber: 1, lastFrameNumber: 10,
		}),
		sourcePack: Object.freeze({
			kind: 'image-sequence-source-pack', storageKey: packStorageKey,
			sha256: packSha256, byteLength: 456,
		}),
		characteristics,
	});
	const options = framescaperV20Options();
	options.sources = (options.sources as Array<Record<string, unknown>>).map((source) => (
		source.kind === 'video' ? {
			...source, storageKey: packStorageKey, mimeType: 'image/png',
			contentSha256: packSha256, videoCodec: 'png', characteristics,
			imageSequence, proxyAttachment: null,
		} : source
	));
	const project = createFramescaperProjectV28(FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE, options);
	const delivery = Object.freeze({
		kind: 'image-sequence' as const, format: 'openexr' as const,
		frameRate: Object.freeze({ num: 60_000, den: 1_001 }), preserveAlpha: true as const,
	});
	const plan = createFramescaperProjectUnifiedExactRenderPlanV28(
		FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE, project,
		createFramescaperNativeRenderPlanAuthorityV28(project, delivery), delivery,
	);
	const envelope = createNativeMediaPlanEnvelopeV2(plan);
	const bodies = Object.freeze([Object.freeze({
		kind: 'image-sequence-inventory' as const,
		encoding: 'framescaper-image-sequence-inventory-v1', sourceId: inventoryStorageKey,
		storageKey: inventoryStorageKey, mimeType: 'application/json', byteLength: 123,
		sha256: inventorySha256,
	}), Object.freeze({
		kind: 'image-sequence-source-pack' as const,
		encoding: 'framescaper-image-sequence-source-pack-v1', sourceId: packStorageKey,
		storageKey: packStorageKey, mimeType: 'application/vnd.soundscaper.image-sequence-pack',
		byteLength: 456, sha256: packSha256,
	})]);
	const request = Object.freeze({
		taskKind: 'image-sequence-export' as const, planVersion: 14 as const,
		derivedInputStageId: 'aa'.repeat(20), planFingerprint: envelope.fingerprint,
		planPayload: canonicalizeNativeMediaPlan(plan), projectId: String(project.id),
		projectRevision: Number(project.revision),
		inputFingerprints: Object.freeze([{ sourceId: 'video-source', sha256: packSha256 }]),
		rootGrantId: ROOT.grantId, relativeDestination: 'renders/sequence-openexr',
		reservations: Object.freeze({ cpuCores: 2, processTreeRssBytes: 1,
			scratchBytes: 4_096, minimumFreeBytes: 0, hardwareBackend: null }),
		recoveryClass: 'verified-frame-checkpoint' as const,
	});
	const authorityWithBodies = (ownedBodies: readonly unknown[]) => (
		new FramescaperNativeSelectedV28ProjectAuthority({
			project: {
				projectState: () => ({ open: true, writable: true }),
				projectRecord: () => ({ projectId: String(project.id), projectRevision: Number(project.revision),
					projectSha256: 'ef'.repeat(32), bodies: ownedBodies }),
				readProjectBundle: async () => ({ project: { projectRevision: Number(project.revision),
					sha256: 'ef'.repeat(32) }, bodies: ownedBodies }),
				readBody: async () => new Uint8Array(), materializeBody: async () => ({}),
			},
			watch: { projectState: () => ({ open: true, writable: true }), watchProject: () => null,
				watchImportAlreadyPresent: async () => false },
			runtime: { available: () => true, executeV14: async () => ({}),
				executeProxyV14: async () => ({}) },
			renderInputs: { revalidate: async () => true, inspect: async () => ({
				byteLength: 1, scratchByteLength: 1, materialize: async () => [],
			}),
				settle: async () => undefined },
			platform: 'linux', probeRoot: async () => ({ exists: false, directory: false,
				symbolicLink: false, canonicalPath: '', volumeIdentity: '', directoryIdentity: '' }),
			publicationPortFor: () => ({}) as never, publicationFenceFor: () => ({}) as never,
		})
	);
	return Object.freeze({ bodies, plan, request, authorityWithBodies, authority: authorityWithBodies(bodies) });
}
