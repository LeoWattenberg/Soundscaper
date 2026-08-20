/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperCaptureCanonicalPublicationService,
	type FramescaperCaptureCanonicalPublicationOptions,
	type FramescaperCaptureCanonicalPublicationRequest,
	type FramescaperCaptureCanonicalStore,
} from '../src/common/editor/controller/framescaper-capture-canonical-publication.ts';
import { createFramescaperCaptureExactPresentationRange } from '../src/common/editor/controller/framescaper-capture-exact-presentation-range.ts';
import {
	createFramescaperCaptureDurableSessionCoordinator,
	type FramescaperCaptureDurableSession,
} from '../src/common/editor/controller/framescaper-capture-durable-session.ts';
import { FramescaperCapturePublicationCasError } from '../src/common/editor/controller/framescaper-capture-publication-service.ts';
import {
	normalizeFramescaperCaptureSessionManifest,
	type FramescaperCaptureSessionManifestV1,
} from '../src/common/editor/framescaper-capture-session-manifest.ts';
import { digestMediaContent } from '../src/common/editor/storage/media-content-digest.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import { createVideoTimingAssetPublication } from '../src/common/editor/video-timing-asset.ts';
import { applyFramescaperProjectCommandV20 } from '../src/framescaper/editor-project-v20-commands.ts';
import { FRAMESCAPER_V20_PROJECT_MODEL_PROFILE } from '../src/framescaper/editor-project-v20-profile.ts';
import {
	createFramescaperProjectV20,
	type FramescaperProjectV20,
} from '../src/framescaper/editor-project-v20.ts';

const PROJECT_SHA256 = 'cd'.repeat(32);
const VIDEO_BYTES = Uint8Array.of(1, 2, 3, 4, 5, 6);
const VIDEO_TIMING = Object.freeze({
	timescale: 1_000,
	presentationTicks: Object.freeze([0n, 500n]),
	finalFrameDurationTicks: 500n,
});

test('canonical capture publication copies sealed PCM and video into ordinary V20 assets before one commit', async () => {
	const fixture = await captureFixture();
	const calls: string[] = [];
	const warnings: unknown[] = [];
	const service = fixture.service({
		assertProjectFence: () => { calls.push('fence'); },
		commitAtomic: (command) => {
			calls.push('commit');
			fixture.project = applyFramescaperProjectCommandV20(
				FRAMESCAPER_V20_PROJECT_MODEL_PROFILE,
				fixture.project,
				command,
				{ now: '2026-08-20T12:00:00.000Z' },
			);
			return { status: 'committed', value: fixture.project.revision };
		},
		scheduleDerivatives: ({ sourceIds }) => {
			calls.push(`derivatives:${sourceIds.join(',')}`);
			throw new Error('poster unavailable');
		},
		onDerivativeWarning: (error) => { warnings.push(error); },
	});

	const result = await service.publish(publicationRequest(fixture.manifest));

	assert.deepEqual(calls.slice(0, 3), ['fence', 'fence', 'commit']);
	assert.equal(result.commitValue, fixture.project.revision);
	assert.equal(result.manifest.state, 'committed');
	assert.equal((await fixture.store.framescaperCaptureManifestRepository.load(
		'capture-project', 'capture-session',
	))?.state, 'committed');
	assert.deepEqual(await fixture.coordinator.recoveryInventory('capture-project'), [],
		'a committed capture is no longer offered by startup recovery');
	assert.equal(fixture.project.schemaVersion, 20);
	assert.equal(fixture.project.sources.length, 2);
	assert.equal(fixture.project.tracks.length, 2);
	assert.equal(fixture.project.clips.length, 2);
	assert.equal(fixture.project.projectBin.clips.length, 2);
	assert.equal(fixture.project.revision, fixture.initialRevision + 1);
	assert.ok([
		...fixture.project.sources,
		...fixture.project.tracks,
		...fixture.project.clips,
		...fixture.project.projectBin.clips,
	].every((leaf) => !Object.hasOwn(leaf, 'schemaVersion')),
	'capture publication emits schema-neutral project leaves');

	const camera = fixture.project.sources.find(({ id }) => id === 'camera-source');
	const microphone = fixture.project.sources.find(({ id }) => id === 'microphone-source');
	assert.ok(camera);
	assert.ok(microphone);
	assert.equal(camera.kind, 'video');
	assert.equal(camera.sampleFrameCount, 48_000);
	assert.equal(camera.sourceFrameCount, 2);
	assert.deepEqual(camera.frameRate, { num: 2, den: 1 });
	assert.equal(camera.width, 640);
	assert.equal(camera.height, 480);
	const timingDecision = camera.timingDecision as Readonly<Record<string, unknown>>;
	assert.equal(timingDecision.mode, 'exact');
	assert.equal(timingDecision.backend, 'test-exact-probe');
	assert.equal(microphone.kind, 'audio');
	assert.equal(microphone.sampleRate, 8_000);
	assert.equal(microphone.frameCount, 8_000);
	assert.equal(result.plan.entries[0]?.avLinkId, result.plan.entries[1]?.avLinkId);

	const audioMetadata = await fixture.store.getSourceMetadata('microphone-source');
	const videoMetadata = await fixture.store.getMediaAssetMetadata('camera-source');
	assert.equal(capturePublicationMetadata(audioMetadata).streamId, 'microphone-stream');
	assert.equal(capturePublicationMetadata(videoMetadata).streamId, 'camera-stream');
	assert.equal(videoMetadata?.size, VIDEO_BYTES.byteLength);
	const loadedVideo = await fixture.store.loadMediaAsset('camera-source');
	assert.ok(loadedVideo);
	assert.deepEqual(new Uint8Array(await loadedVideo.arrayBuffer()), VIDEO_BYTES);
	const timing = camera.timingAsset as Readonly<{ readonly storageKey: string }>;
	assert.ok(await fixture.store.getMediaAssetMetadata(timing.storageKey));

	await Promise.resolve();
	await Promise.resolve();
	assert.equal(calls.at(-1), 'derivatives:camera-source,microphone-source');
	assert.equal(warnings.length, 1, 'derivative failures warn without reversing the canonical commit');
	assert.equal(await fixture.store.rawPcmSpoolRepository.load('capture-project', 'microphone-spool'), null);
	assert.equal(await fixture.store.encodedCaptureSpoolRepository.load('capture-project', 'camera-spool'), null);
});

test('known project CAS refusal rolls back only newly owned canonical bodies and timing assets', async () => {
	const fixture = await captureFixture({ roles: ['camera'] });
	const service = fixture.service({
		commitAtomic: () => ({ status: 'cas-mismatch' }),
	});
	const contentSha256 = await digestMediaContent(new Blob([VIDEO_BYTES], { type: 'video/webm' }));
	const timingReference = createVideoTimingAssetPublication(contentSha256, VIDEO_TIMING).reference;

	await assert.rejects(
		service.publish(publicationRequest(fixture.manifest)),
		FramescaperCapturePublicationCasError,
	);

	assert.equal(await fixture.store.getMediaAssetMetadata('camera-source'), null);
	assert.equal(await fixture.store.getMediaAssetMetadata(timingReference.storageKey), null);
	const spool = await fixture.store.encodedCaptureSpoolRepository.load('capture-project', 'camera-spool');
	assert.equal(spool?.state, 'sealed', 'sealed recovery evidence is never consumed by rollback');
	assert.equal((await fixture.store.framescaperCaptureManifestRepository.load(
		'capture-project', 'capture-session',
	))?.state, 'finalizing');
});

test('retry reuses exact retained video and timing publications after an indeterminate commit', async () => {
	const fixture = await captureFixture({ roles: ['camera'] });
	const recoveries: string[][] = [];
	let commitAttempts = 0;
	let bodyWrites = 0;
	const storePort = captureStorePort(fixture.store);
	const service = fixture.service({
		store: {
			...storePort,
			beginMediaAssetWrite: (...arguments_: Parameters<typeof storePort.beginMediaAssetWrite>) => {
				if (arguments_[0] === 'camera-source') bodyWrites += 1;
				return storePort.beginMediaAssetWrite(...arguments_);
			},
		},
		assertProjectFence: (_fence, context) => {
			if (context.phase === 'before-assets'
				&& fixture.project.revision === fixture.initialRevision + 1) {
				return { status: 'reconcile-only' };
			}
			if (context.phase === 'before-commit' && context.publicationMode === 'reconcile-only') {
				assert.equal(fixture.project.sources.some(({ id }) => id === 'camera-source'), true);
			}
			return { status: 'base-current' };
		},
		commitAtomic: (command) => {
			commitAttempts += 1;
			if (commitAttempts === 1) {
				fixture.project = applyFramescaperProjectCommandV20(
					FRAMESCAPER_V20_PROJECT_MODEL_PROFILE,
					fixture.project,
					command,
					{ now: '2026-08-20T12:01:00.000Z' },
				);
				throw new Error('commit acknowledgement lost');
			}
			assert.equal(fixture.project.revision, fixture.initialRevision + 1);
			return { status: 'committed' };
		},
		recordRetryableRecovery: ({ sourceIds }) => { recoveries.push([...sourceIds]); },
	});

	await assert.rejects(service.publish(publicationRequest(fixture.manifest)), /must be retried/iu);
	assert.ok(await fixture.store.getMediaAssetMetadata('camera-source'));
	assert.equal((await fixture.store.framescaperCaptureManifestRepository.load(
		'capture-project', 'capture-session',
	))?.state, 'finalizing');
	assert.equal((await fixture.coordinator.recoveryInventory('capture-project')).length, 1,
		'a failed commit remains visible to startup recovery');
	await service.publish(publicationRequest(fixture.manifest));

	assert.equal(bodyWrites, 1, 'target reconciliation borrows the exact prior publication without writes');
	assert.deepEqual(recoveries, [['camera-source']]);
	assert.equal(fixture.project.sources.filter(({ id }) => id === 'camera-source').length, 1);
	assert.equal(fixture.project.revision, fixture.initialRevision + 1);
	assert.equal((await fixture.store.framescaperCaptureManifestRepository.load(
		'capture-project', 'capture-session',
	))?.state, 'committed');
});

test('a published manifest whose final settlement failed can retry through committed', async () => {
	const fixture = await captureFixture({ roles: ['camera'] });
	const repository = fixture.store.framescaperCaptureManifestRepository;
	const storePort = captureStorePort(fixture.store);
	let rejectSettlement = true;
	let projectCommitted = false;
	let bodyWrites = 0;
	const service = fixture.service({
		store: {
			...storePort,
			beginMediaAssetWrite: (...arguments_: Parameters<typeof storePort.beginMediaAssetWrite>) => {
				if (arguments_[0] === 'camera-source') bodyWrites += 1;
				return storePort.beginMediaAssetWrite(...arguments_);
			},
		},
		manifests: {
			load: repository.load.bind(repository),
			async replace(expected, next) {
				const normalizedNext = normalizeFramescaperCaptureSessionManifest(next);
				if (normalizedNext.state === 'committed' && rejectSettlement) {
					rejectSettlement = false;
					throw new Error('manifest commit acknowledgement lost');
				}
				return repository.replace(expected, normalizedNext);
			},
		},
		assertProjectFence: (_fence, context) => (
			context.phase === 'before-assets' && projectCommitted
				? { status: 'reconcile-only' }
				: { status: 'base-current' }
		),
		commitAtomic: (command) => {
			if (!projectCommitted) {
				fixture.project = applyFramescaperProjectCommandV20(
					FRAMESCAPER_V20_PROJECT_MODEL_PROFILE,
					fixture.project,
					command,
					{ now: '2026-08-20T12:02:00.000Z' },
				);
				projectCommitted = true;
			}
			return { status: 'committed' };
		},
	});

	await assert.rejects(service.publish(publicationRequest(fixture.manifest)), /must be retried/iu);
	assert.equal((await repository.load('capture-project', 'capture-session'))?.state, 'published');
	assert.equal((await fixture.coordinator.recoveryInventory('capture-project')).length, 1);
	const result = await service.publish(publicationRequest(fixture.manifest));

	assert.equal(result.manifest.state, 'committed');
	assert.equal(bodyWrites, 1, 'published settlement retry never rewrites the retained body');
	assert.equal(fixture.project.revision, fixture.initialRevision + 1);
	assert.deepEqual(await fixture.coordinator.recoveryInventory('capture-project'), []);
});

test('foreign immutable ownership and unsealed manifests are refused before project mutation', async () => {
	const fixture = await captureFixture({ roles: ['microphone'] });
	const writer = await fixture.store.beginSourceWrite('microphone-source', {
		name: 'Foreign', sampleRate: 8_000, channelCount: 1, chunkFrames: 1,
	});
	await writer.write([Float32Array.of(0)]);
	await writer.commit();
	let commits = 0;
	const service = fixture.service({ commitAtomic: () => { commits += 1; return { status: 'committed' }; } });

	await assert.rejects(service.publish(publicationRequest(fixture.manifest)), /owned by different content/iu);
	assert.equal(commits, 0);
	assert.equal((await fixture.store.getSourceMetadata('microphone-source'))?.name, 'Foreign');

	const spoolFixture = await captureFixture({ roles: ['microphone'] });
	const rawSpools = spoolFixture.store.rawPcmSpoolRepository;
	const ownedSpool = await rawSpools.load('capture-project', 'microphone-spool');
	assert.ok(ownedSpool);
	await assert.rejects(spoolFixture.service({
		rawPcmSpools: {
			load: async () => Object.freeze({ ...ownedSpool, data: Object.freeze({ sessionId: 'foreign' }) }),
			chunks: rawSpools.chunks.bind(rawSpools),
		},
	}).publish(publicationRequest(spoolFixture.manifest)), /spool ownership changed/iu);
	assert.equal(await spoolFixture.store.getSourceMetadata('microphone-source'), null);

	const activeFixture = await captureFixture({ roles: ['camera'], seal: false });
	await assert.rejects(
		activeFixture.service().publish(publicationRequest(activeFixture.manifest)),
		/sealed.*manifest|manifest.*sealed/iu,
	);
	assert.equal(await activeFixture.store.getMediaAssetMetadata('camera-source'), null);
});

test('import-as-is validates an unknown acknowledged prefix before persisting intent and commit', async () => {
	const fixture = await captureFixture({ roles: ['microphone'] });
	const events: string[] = [];
	const repository = fixture.store.framescaperCaptureManifestRepository;
	const storePort = captureStorePort(fixture.store);
	const service = fixture.service({
		store: {
			...storePort,
			beginSourceWrite(...arguments_: Parameters<typeof storePort.beginSourceWrite>) {
				events.push('asset');
				return storePort.beginSourceWrite(...arguments_);
			},
		},
		manifests: {
			load: repository.load.bind(repository),
			async replace(expected, next) {
				const before = manifestRecord(expected);
				const after = manifestRecord(next);
				events.push(`${String(before.state)}->${String(after.state)}:${String(after.recoveryDecision)}`);
				return repository.replace(expected, next);
			},
		},
		assertProjectFence: () => { events.push('fence'); },
		commitAtomic: () => { events.push('commit'); return { status: 'committed' }; },
	});

	const result = await service.publish({
		...publicationRequest(fixture.manifest),
		recoveryProvenance: 'import-as-is',
	});

	assert.deepEqual(events, [
		'fence', 'asset',
		'sealed->finalizing:import-as-is', 'fence', 'commit',
		'finalizing->published:import-as-is',
		'published->committed:import-as-is',
	]);
	assert.equal(result.manifest.state, 'committed');
	assert.equal(result.manifest.recoveryDecision, 'import-as-is');
	assert.ok(result.manifest.streams.every(({ playability }) => playability === 'playable'));
});

type CaptureRole = 'camera' | 'microphone';

interface CaptureFixture {
	readonly store: ReturnType<typeof createProjectStore>;
	readonly coordinator: ReturnType<typeof createFramescaperCaptureDurableSessionCoordinator>;
	readonly manifest: FramescaperCaptureSessionManifestV1;
	project: FramescaperProjectV20;
	readonly initialRevision: number;
	service(overrides?: Partial<FramescaperCaptureCanonicalPublicationOptions>): ReturnType<
		typeof createFramescaperCaptureCanonicalPublicationService
	>;
}

async function captureFixture(
	options: Readonly<{
		roles?: readonly CaptureRole[];
		seal?: boolean;
		playable?: boolean;
	}> = {},
): Promise<CaptureFixture> {
	const roles = options.roles ?? ['camera', 'microphone'];
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `capture-publication-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
	});
	let project = createFramescaperProjectV20(FRAMESCAPER_V20_PROJECT_MODEL_PROFILE, {
		id: 'capture-project',
		title: 'Capture publication',
		now: '2026-08-20T11:59:00.000Z',
		sampleRate: 48_000,
		sequences: [{ id: 'main-sequence', rate: { num: 30, den: 1 } }],
		primarySequenceId: 'main-sequence',
	});
	const initialRevision = project.revision;
	const coordinator = createFramescaperCaptureDurableSessionCoordinator({
		encodedSpools: store.encodedCaptureSpoolRepository,
		rawPcmSpools: store.rawPcmSpoolRepository,
		manifests: store.framescaperCaptureManifestRepository,
		now: () => 100,
	});
	const session = await coordinator.create({
		sessionId: 'capture-session',
		generation: 1,
		projectFence: {
			projectId: project.id,
			baseRevision: project.revision,
			baseSha256: PROJECT_SHA256,
		},
		origin: {
			sequenceId: 'main-sequence',
			playheadMicroseconds: 0,
			destination: 'both',
		},
		monotonicOriginMicroseconds: 0,
		streams: roles.map((role) => role === 'camera' ? {
			kind: 'encoded-media' as const,
			role,
			required: true,
			streamId: 'camera-stream',
			spoolId: 'camera-spool',
			sourceId: 'camera-source',
			mimeType: 'video/webm',
		} : {
			kind: 'raw-pcm' as const,
			role,
			required: true,
			streamId: 'microphone-stream',
			spoolId: 'microphone-spool',
			sourceId: 'microphone-source',
			sampleRate: 8_000,
			channelCount: 2,
			chunkFrames: 8_000,
		}),
	});
	await populateSession(session, roles);
	if (options.seal !== false) {
		await session.seal();
		if (options.playable) {
			for (const stream of session.manifest.streams) {
				await session.setPlayability(stream.streamId, 'playable');
			}
		}
	}
	const fixture: CaptureFixture = {
		store,
		coordinator,
		get manifest() { return session.manifest; },
		project,
		initialRevision,
		service(overrides = {}) {
			return createFramescaperCaptureCanonicalPublicationService({
				store: captureStorePort(store),
				manifests: store.framescaperCaptureManifestRepository,
				encodedSpools: store.encodedCaptureSpoolRepository,
				rawPcmSpools: store.rawPcmSpoolRepository,
				probeVideo: async (body) => {
					assert.ok(await store.getMediaAssetMetadata('camera-source'),
						'the probe consumes the already-retained ordinary media asset');
					assert.equal(body.type, 'video/webm');
					assert.deepEqual(new Uint8Array(await body.arrayBuffer()), VIDEO_BYTES);
					return {
						backend: 'test-exact-probe',
						nominalRate: { num: 2, den: 1 },
						timing: VIDEO_TIMING,
						width: 640,
						height: 480,
					};
				},
				assertProjectFence: () => undefined,
				commitAtomic: () => ({ status: 'committed' }),
				recordRetryableRecovery: () => undefined,
				now: () => 101,
				...overrides,
			});
		},
	};
	Object.defineProperty(fixture, 'project', {
		get: () => project,
		set: (value: FramescaperProjectV20) => { project = value; },
		enumerable: true,
	});
	return fixture;
}

async function populateSession(
	session: FramescaperCaptureDurableSession,
	roles: readonly CaptureRole[],
): Promise<void> {
	if (roles.includes('camera')) {
		for (const [sequence, bytes] of [VIDEO_BYTES.slice(0, 3), VIDEO_BYTES.slice(3)].entries()) {
			await session.append({
				kind: 'encoded-video',
				sessionId: 'capture-session',
				streamId: 'camera-stream',
				role: 'camera',
				sequence,
				presentationTimeUs: sequence * 500_000,
				durationUs: 500_000,
				receiptTimeMs: sequence,
				droppedBefore: { value: 0, confidence: 'exact' },
				byteLength: bytes.byteLength,
				bytes,
				mimeType: 'video/webm',
				keyFrame: sequence === 0,
			});
		}
	}
	if (roles.includes('microphone')) {
		const samples = new Float32Array(8_000 * 2);
		samples[0] = 0.25;
		samples[1] = -0.25;
		await session.append({
			kind: 'pcm-audio',
			sessionId: 'capture-session',
			streamId: 'microphone-stream',
			role: 'microphone',
			sequence: 0,
			presentationTimeUs: 0,
			durationUs: 1_000_000,
			receiptTimeMs: 0,
			droppedBefore: { value: 0, confidence: 'exact' },
			frameCount: 8_000,
			sampleRate: 8_000,
			channelCount: 2,
			samples,
		});
	}
}

function publicationRequest(
	manifest: FramescaperCaptureSessionManifestV1,
): FramescaperCaptureCanonicalPublicationRequest {
	let id = 0;
	return {
		manifest,
		recoveryProvenance: 'live',
		destination: 'both',
		recordStartFrame: 0,
		projectSampleRate: 48_000,
		sequence: { id: 'main-sequence', rate: { num: 30, den: 1 } },
		trackInsertionIndex: 0,
		streams: manifest.streams.map(({ streamId, role, timing }) => ({
			streamId,
			role,
			exactPresentationRange: createFramescaperCaptureExactPresentationRange(
				timing.firstPresentationMicroseconds!,
				timing.lastPresentationEndMicroseconds!,
			),
			startOffsetFrames: Math.round(timing.firstPresentationMicroseconds! * 48_000 / 1_000_000),
			presentationEndOffsetFrames: Math.round(
				timing.lastPresentationEndMicroseconds! * 48_000 / 1_000_000,
			),
			metrics: {
				confidence: 'exact',
				droppedUnits: 0,
				maximumAbsoluteDriftMicroseconds: 0,
				finalDriftMicroseconds: 0,
			},
			terminationReason: null,
		})),
		createId: (prefix) => `${prefix}-${String(++id)}`,
	};
}

function captureStorePort(
	store: ReturnType<typeof createProjectStore>,
): FramescaperCaptureCanonicalStore {
	return {
		getSourceMetadata: store.getSourceMetadata.bind(store),
		beginSourceWrite: store.beginSourceWrite.bind(store),
		discardSourceIfCurrent: store.discardSourceIfCurrent.bind(store),
		getMediaAssetMetadata: store.getMediaAssetMetadata.bind(store),
		beginMediaAssetWrite: store.beginMediaAssetWrite.bind(store),
		async loadMediaAsset(sourceId, options) {
			const loaded = await store.loadMediaAsset(sourceId, options);
			if (!loaded) return null;
			return loaded instanceof Blob
				? loaded
				: new Blob([await loaded.arrayBuffer()], { type: loaded.type });
		},
	};
}

function capturePublicationMetadata(value: unknown): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
	const metadata = (value as Readonly<Record<string, unknown>>).framescaperCapturePublicationV1;
	return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
		? metadata as Readonly<Record<string, unknown>>
		: {};
}

function manifestRecord(value: unknown): Readonly<Record<string, unknown>> {
	return value && typeof value === 'object' && !Array.isArray(value)
		? value as Readonly<Record<string, unknown>>
		: {};
}
