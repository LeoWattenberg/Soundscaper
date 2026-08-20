/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { prepareLinkedSplitCommand } from '../src/common/editor/commands/clip-link-runtime.js';
import {
	createFramescaperCaptureCanonicalPublicationService,
	type FramescaperCaptureCanonicalStore,
} from '../src/common/editor/controller/framescaper-capture-canonical-publication.ts';
import {
	createFramescaperCaptureExactPresentationRange,
} from '../src/common/editor/controller/framescaper-capture-exact-presentation-range.ts';
import {
	createFramescaperCaptureDurableSessionCoordinator,
	type FramescaperCaptureDurableSession,
} from '../src/common/editor/controller/framescaper-capture-durable-session.ts';
import type { AudioEditorProjectCurrent } from '../src/common/editor/project-current.ts';
import { createProjectStore, type AudioEditorProjectStore } from '../src/common/editor/storage.js';
import {
	DESKTOP_SHARED_AUDIO_ENCODING,
	DESKTOP_SHARED_VIDEO_ENCODING,
	DESKTOP_SHARED_VIDEO_TIMING_ENCODING,
	prepareDesktopSharedProjectMediaHandoff,
	type DesktopSharedManagedSourceDescriptor,
	type DesktopSharedSourceTransferBridge,
} from '../src/common/editor/storage/desktop-shared-project-media-transfer.ts';
import type {
	LinkedVideoOriginalPort,
} from '../src/common/editor/storage/linked-video-original-resolver.ts';
import { createVideoExportPlan } from '../src/common/editor/video-export.js';
import { createFramescaperPlaybackProjectServiceV19 } from '../src/framescaper/editor-project-playback-v19.ts';
import { FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v19.ts';
import { createFramescaperProjectStoreV19 } from '../src/framescaper/editor-project-store-v19.ts';
import {
	applyFramescaperProjectCommandV19,
	type FramescaperProjectCommandV19,
} from '../src/framescaper/editor-project-v19-commands.ts';
import {
	createFramescaperProjectV19,
	validateFramescaperProjectV19,
	type FramescaperProjectV19,
} from '../src/framescaper/editor-project-v19.ts';
import { createFramescaperScapeNativeRuntimeV19 } from '../src/framescaper/editor-scape-native-v19.ts';
import { createFramescaperVideoExportStrategyV19 } from '../src/framescaper/video-export-strategy-v19.ts';

const PROFILE = FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE;
const PROJECT_ID = 'capture-ordinary-exit-project';
const SESSION_ID = 'capture-ordinary-exit-session';
const CAMERA_SOURCE_ID = 'capture-camera-source';
const MICROPHONE_SOURCE_ID = 'capture-microphone-source';
const ORIGINAL_LOCATOR_ID = 'locator_capture_original_0001';
const ORIGINAL_LOCATOR_REVISION = 'revision_capture_original_01';
const RELINKED_LOCATOR_ID = 'locator_capture_relinked_0001';
const RELINKED_LOCATOR_REVISION = 'revision_capture_relinked_01';
const VIDEO_BYTES = Uint8Array.of(0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4);
const VIDEO_TIMING = Object.freeze({
	timescale: 1_000,
	presentationTicks: Object.freeze([0n, 500n]),
	finalFrameDurationTicks: 500n,
});

test('capture-published assets traverse ordinary relink, edit, Scape, handoff, and delivery paths', async (context) => {
	const fixture = await publishCapture(context);
	const published = fixture.project;
	assert.equal(validateFramescaperProjectV19(PROFILE, published), true);
	assert.equal(published.schemaVersion, 19, 'capture provenance must not bump the project schema');
	assert.deepEqual(captureProvenance(source(published, CAMERA_SOURCE_ID)), {
		role: 'camera', streamId: 'camera-stream', recoveryProvenance: 'live',
	});
	assert.deepEqual(captureProvenance(source(published, MICROPHONE_SOURCE_ID)), {
		role: 'microphone', streamId: 'microphone-stream', recoveryProvenance: 'live',
	});

	const retainedVideo = await requiredMedia(fixture.store, CAMERA_SOURCE_ID);
	fixture.locators.set(ORIGINAL_LOCATOR_ID, snapshot(retainedVideo, ORIGINAL_LOCATOR_REVISION));
	fixture.locators.set(RELINKED_LOCATOR_ID, snapshot(retainedVideo, RELINKED_LOCATOR_REVISION));
	const originalBinding = await fixture.store.bindLinkedVideoOriginal(
		PROJECT_ID,
		videoSource(published),
		ORIGINAL_LOCATOR_ID,
		{
			expectedLocatorRevision: ORIGINAL_LOCATOR_REVISION,
			expectedSnapshot: retainedVideo,
		},
	);
	const rebound = await fixture.store.relinkLinkedVideoOriginal(
		PROJECT_ID,
		videoSource(published),
		RELINKED_LOCATOR_ID,
		{
			expectedBindingToken: originalBinding.bindingToken,
			expectedLocatorRevision: RELINKED_LOCATOR_REVISION,
			expectedSnapshot: retainedVideo,
		},
	);
	assert.equal(rebound.locatorId, RELINKED_LOCATOR_ID);
	assert.equal(rebound.sha256, videoSource(published).contentSha256);

	const cameraEntry = fixture.publication.plan.entries.find(({ role }) => role === 'camera');
	assert.ok(cameraEntry?.timelineClipId);
	const splitIds = ['camera-right', 'microphone-right', 'capture-right-av-link'];
	const splitCommand = prepareLinkedSplitCommand(
		published,
		cameraEntry.timelineClipId,
		24_000,
		() => requiredShift(splitIds),
	);
	const edited = applyFramescaperProjectCommandV19(
		PROFILE,
		published,
		splitCommand as unknown as FramescaperProjectCommandV19,
		{ now: '2026-08-20T12:02:00.000Z' },
	);
	assert.equal(validateFramescaperProjectV19(PROFILE, edited), true);
	assert.equal(edited.clips.length, 4, 'the ordinary linked split creates two aligned A/V pairs');
	assert.deepEqual(edited.sources, published.sources, 'an occurrence edit does not rewrite capture assets');
	assert.equal(edited.clips.find(({ id }) => id === 'camera-right')?.avLinkId, 'capture-right-av-link');
	assert.equal(edited.clips.find(({ id }) => id === 'microphone-right')?.avLinkId, 'capture-right-av-link');

	const runtime = createFramescaperScapeNativeRuntimeV19(PROFILE);
	const exported = await runtime.exportScapeProject(edited, fixture.store);
	assert.ok(exported.blob);
	const inspection = await runtime.inspectScapeProject(
		exported.blob,
		null,
		{ signal: new AbortController().signal },
		{ retain: () => undefined },
	);
	assert.equal(inspection.schemaVersion, 19);
	assert.equal(inspection.readOnly, false);

	const recipient = createFramescaperProjectStoreV19(PROFILE, {
		indexedDB: null,
		preferOpfs: false,
	});
	context.after(async () => { await recipient.close(); });
	const imported = await runtime.importScapeProject(exported.blob, recipient, { collision: 'copy' });
	assert.equal(imported.readOnly, false);
	assert.equal(validateFramescaperProjectV19(PROFILE, imported.project), true);
	const reopenedValue = await recipient.loadProject(edited.id);
	assert.ok(reopenedValue);
	const reopened = reopenedValue as FramescaperProjectV19;
	assert.equal(validateFramescaperProjectV19(PROFILE, reopened), true);
	assert.deepEqual(reopened.clips, edited.clips);
	assert.deepEqual(
		captureProvenance(source(reopened, CAMERA_SOURCE_ID)),
		captureProvenance(source(edited, CAMERA_SOURCE_ID)),
	);
	assert.deepEqual(
		new Uint8Array(await (await requiredMedia(recipient, CAMERA_SOURCE_ID)).arrayBuffer()),
		VIDEO_BYTES,
	);
	assert.ok(await recipient.getSourceMetadata(MICROPHONE_SOURCE_ID));
	const timingStorageKey = timingAssetStorageKey(videoSource(reopened));
	assert.ok(await recipient.getMediaAssetMetadata(timingStorageKey));

	const playback = createFramescaperPlaybackProjectServiceV19(PROFILE, { timingStore: recipient });
	const delivery = playback.projectForVideoRenderedFallbackDelivery?.(reopened);
	assert.ok(delivery);
	assert.deepEqual(delivery.requiredAudioSourceIds, []);
	assert.deepEqual(delivery.requiredVideoSourceIds, []);
	const deliveryProject = delivery.project as unknown as AudioEditorProjectCurrent;
	assert.equal(deliveryProject.schemaVersion, 17);
	assert.deepEqual(
		captureProvenance(source(deliveryProject, CAMERA_SOURCE_ID)),
		captureProvenance(source(reopened, CAMERA_SOURCE_ID)),
		'the ordinary runtime projection preserves bounded source provenance',
	);

	const handoff = handoffTransport(deliveryProject);
	const descriptors = await prepareDesktopSharedProjectMediaHandoff(
		deliveryProject,
		handoff.bridge,
		recipient,
	);
	assert.deepEqual(descriptors.map(({ kind }) => kind), ['video', 'video-timing', 'audio']);
	assert.deepEqual(new Set(descriptors.map(({ sourceId }) => sourceId)), new Set([
		CAMERA_SOURCE_ID, MICROPHONE_SOURCE_ID,
	]));
	assert.equal(handoff.aborts.length, 0);

	const strategy = createFramescaperVideoExportStrategyV19(PROFILE);
	const exportProject = strategy.createExportProject({ canonicalProject: reopened, delivery });
	assert.equal(strategy.createPlan({
		canonicalProject: reopened,
		exportProject,
		format: 'webm',
		range: 'project',
		includeAudio: true,
		canvas: undefined,
	}), null, 'capture uses the maintained ordinary V17 delivery planner');
	const deliveryPlan = createVideoExportPlan(exportProject, {
		format: 'webm',
		range: 'project',
		includeAudio: true,
	});
	const deliveryInputs = deliveryPlan.inputs as readonly Readonly<{
		kind: string;
		sourceId?: string;
	}>[];
	assert.deepEqual(
		deliveryInputs.filter(({ kind }) => kind === 'video-source').map(({ sourceId }) => sourceId),
		[CAMERA_SOURCE_ID],
	);
	assert.equal(deliveryInputs.at(-1)?.kind, 'staged-audio-mix');
});

interface CaptureExitFixture {
	readonly locators: Map<string, Readonly<{ blob: Blob; locatorRevision: string }>>;
	readonly project: FramescaperProjectV19;
	readonly publication: Awaited<ReturnType<ReturnType<
		typeof createFramescaperCaptureCanonicalPublicationService
	>['publish']>>;
	readonly store: AudioEditorProjectStore;
}

async function publishCapture(context: TestContext): Promise<CaptureExitFixture> {
	const locators = new Map<string, Readonly<{ blob: Blob; locatorRevision: string }>>();
	const linkedVideoOriginalPort: LinkedVideoOriginalPort = {
		load(locatorId, { expectedRevision }) {
			const candidate = locators.get(locatorId) ?? null;
			return expectedRevision !== null && candidate?.locatorRevision !== expectedRevision
				? null
				: candidate;
		},
		release: () => true,
	};
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `capture-ordinary-exit-${Date.now()}-${Math.random()}`,
		linkedVideoOriginalPort,
	});
	context.after(async () => { await store.close(); });
	let project = createFramescaperProjectV19(PROFILE, {
		id: PROJECT_ID,
		title: 'Capture ordinary exit',
		now: '2026-08-20T12:00:00.000Z',
		sampleRate: 48_000,
		sequences: [{ id: 'main-sequence', rate: { num: 30, den: 1 } }],
		primarySequenceId: 'main-sequence',
	});
	const coordinator = createFramescaperCaptureDurableSessionCoordinator({
		encodedSpools: store.encodedCaptureSpoolRepository,
		rawPcmSpools: store.rawPcmSpoolRepository,
		manifests: store.framescaperCaptureManifestRepository,
		now: () => 100,
	});
	const session = await coordinator.create({
		sessionId: SESSION_ID,
		generation: 1,
		projectFence: { projectId: PROJECT_ID, baseRevision: project.revision, baseSha256: 'ab'.repeat(32) },
		origin: { sequenceId: 'main-sequence', playheadMicroseconds: 0, destination: 'both' },
		monotonicOriginMicroseconds: 0,
		streams: [{
			kind: 'encoded-media', role: 'camera', required: true,
			streamId: 'camera-stream', spoolId: 'camera-spool', sourceId: CAMERA_SOURCE_ID,
			mimeType: 'video/webm',
		}, {
			kind: 'raw-pcm', role: 'microphone', required: true,
			streamId: 'microphone-stream', spoolId: 'microphone-spool', sourceId: MICROPHONE_SOURCE_ID,
			sampleRate: 8_000, channelCount: 2, chunkFrames: 8_000,
		}],
	});
	await populateSession(session);
	await session.seal();
	const service = createFramescaperCaptureCanonicalPublicationService({
		store: captureStore(store),
		manifests: store.framescaperCaptureManifestRepository,
		encodedSpools: store.encodedCaptureSpoolRepository,
		rawPcmSpools: store.rawPcmSpoolRepository,
		probeVideo: () => ({
			backend: 'ordinary-exit-test-probe', nominalRate: { num: 2, den: 1 },
			timing: VIDEO_TIMING, width: 640, height: 480,
		}),
		assertProjectFence: () => undefined,
		commitAtomic(command) {
			project = applyFramescaperProjectCommandV19(
				PROFILE, project, command, { now: '2026-08-20T12:01:00.000Z' },
			);
			return { status: 'committed', value: project.revision };
		},
		recordRetryableRecovery: () => undefined,
		now: () => 101,
	});
	let id = 0;
	const publication = await service.publish({
		manifest: session.manifest,
		recoveryProvenance: 'live',
		destination: 'both',
		recordStartFrame: 0,
		projectSampleRate: 48_000,
		sequence: { id: 'main-sequence', rate: { num: 30, den: 1 } },
		trackInsertionIndex: 0,
		streams: session.manifest.streams.map(({ streamId, role, timing }) => ({
			streamId, role,
			exactPresentationRange: createFramescaperCaptureExactPresentationRange(
				timing.firstPresentationMicroseconds!, timing.lastPresentationEndMicroseconds!,
			),
			startOffsetFrames: 0,
			presentationEndOffsetFrames: 48_000,
			metrics: {
				confidence: 'exact', droppedUnits: 0,
				maximumAbsoluteDriftMicroseconds: 0, finalDriftMicroseconds: 0,
			},
			terminationReason: null,
		})),
		createId: (prefix) => `${prefix}-${String(++id)}`,
	});
	return Object.freeze({ locators, project, publication, store });
}

async function populateSession(session: FramescaperCaptureDurableSession): Promise<void> {
	for (const [sequence, bytes] of [VIDEO_BYTES.slice(0, 4), VIDEO_BYTES.slice(4)].entries()) {
		await session.append({
			kind: 'encoded-video', sessionId: SESSION_ID, streamId: 'camera-stream', role: 'camera',
			sequence, presentationTimeUs: sequence * 500_000, durationUs: 500_000,
			receiptTimeMs: sequence, droppedBefore: { value: 0, confidence: 'exact' },
			byteLength: bytes.byteLength, bytes, mimeType: 'video/webm', keyFrame: sequence === 0,
		});
	}
	const samples = new Float32Array(16_000);
	samples[0] = 0.25;
	samples[1] = -0.25;
	await session.append({
		kind: 'pcm-audio', sessionId: SESSION_ID, streamId: 'microphone-stream', role: 'microphone',
		sequence: 0, presentationTimeUs: 0, durationUs: 1_000_000, receiptTimeMs: 0,
		droppedBefore: { value: 0, confidence: 'exact' }, frameCount: 8_000,
		sampleRate: 8_000, channelCount: 2, samples,
	});
}

function captureStore(store: AudioEditorProjectStore): FramescaperCaptureCanonicalStore {
	return {
		getSourceMetadata: store.getSourceMetadata.bind(store),
		beginSourceWrite: store.beginSourceWrite.bind(store),
		discardSourceIfCurrent: store.discardSourceIfCurrent.bind(store),
		getMediaAssetMetadata: store.getMediaAssetMetadata.bind(store),
		beginMediaAssetWrite: store.beginMediaAssetWrite.bind(store),
		async loadMediaAsset(sourceId, options) {
			const loaded = await store.loadMediaAsset(sourceId, options);
			return loaded === null ? null : loaded instanceof Blob
				? loaded
				: new Blob([await loaded.arrayBuffer()], { type: loaded.type });
		},
	};
}

function handoffTransport(project: AudioEditorProjectCurrent): Readonly<{
	aborts: string[];
	bridge: DesktopSharedSourceTransferBridge;
}> {
	type Declaration = Parameters<DesktopSharedSourceTransferBridge['beginSharedSourceWrite']>[0];
	const sessions = new Map<string, Readonly<{ declaration: Declaration; chunks: Uint8Array[] }>>();
	const aborts: string[] = [];
	let nextWrite = 0;
	const bridge: DesktopSharedSourceTransferBridge = {
		async beginSharedSourceWrite(declaration) {
			const writeId = `capture-handoff-${String(++nextWrite)}`;
			sessions.set(writeId, { declaration, chunks: [] });
			return { status: 'ready' as const, chunkSize: 3, writeId };
		},
		async writeSharedSourceChunk({ bytes, offset, writeId }) {
			const session = requiredSession(sessions, writeId);
			assert.equal(offset, session.chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
			session.chunks.push(bytes.slice());
			return { nextOffset: offset + bytes.byteLength };
		},
		async finishSharedSourceWrite({ sha256, writeId }) {
			const session = requiredSession(sessions, writeId);
			assert.equal(sha256, session.declaration.sha256);
			return handoffDescriptor(project, session.declaration, sha256);
		},
		async abortSharedSourceWrite(writeId) { aborts.push(writeId); return true; },
		async readSharedSourceChunk() { throw new Error('sender-only handoff must not read'); },
	};
	return Object.freeze({ aborts, bridge: Object.freeze(bridge) });
}

function handoffDescriptor(
	project: AudioEditorProjectCurrent,
	declaration: Parameters<DesktopSharedSourceTransferBridge['beginSharedSourceWrite']>[0],
	sha256: string,
): DesktopSharedManagedSourceDescriptor {
	const source = project.sources.find(({ id }) => id === declaration.sourceId);
	if (!source) throw new Error(`Missing handoff source ${declaration.sourceId}`);
	const sourceId = requiredString(source.id, 'handoff source ID');
	const storageKey = requiredString(source.storageKey, 'handoff source storage key');
	if (declaration.encoding === DESKTOP_SHARED_AUDIO_ENCODING) return Object.freeze({
		bindingId: `m${sha256}`, byteLength: declaration.byteLength,
		encoding: declaration.encoding, kind: 'audio', sha256,
		sourceId, storageKey,
	});
	if (declaration.encoding === DESKTOP_SHARED_VIDEO_ENCODING) return Object.freeze({
		bindingId: `v${sha256}`, byteLength: declaration.byteLength,
		encoding: declaration.encoding, kind: 'video', sha256,
		sourceId, storageKey,
	});
	assert.equal(declaration.encoding, DESKTOP_SHARED_VIDEO_TIMING_ENCODING);
	return Object.freeze({
		bindingId: `t${sha256}`, byteLength: declaration.byteLength,
		encoding: DESKTOP_SHARED_VIDEO_TIMING_ENCODING, kind: 'video-timing', sha256,
		sourceId, storageKey: timingAssetStorageKey(source),
	});
}

function requiredSession<Value>(sessions: ReadonlyMap<string, Value>, writeId: string): Value {
	const session = sessions.get(writeId);
	if (!session) throw new Error(`Missing handoff session ${writeId}`);
	return session;
}

function source(
	project: Readonly<{ readonly sources: readonly Readonly<Record<string, unknown>>[] }>,
	id: string,
): Readonly<Record<string, unknown>> {
	const value = project.sources.find((candidate) => candidate.id === id);
	if (!value) throw new Error(`Missing source ${id}`);
	return value;
}

function videoSource(project: FramescaperProjectV19) {
	const value = source(project, CAMERA_SOURCE_ID);
	if (value.kind !== 'video') throw new TypeError('Expected the captured camera video source.');
	return value as typeof value & Readonly<{
		kind: 'video'; contentSha256: string; timingAsset: Readonly<Record<string, unknown>>;
	}>;
}

function captureProvenance(value: Readonly<Record<string, unknown>>): Readonly<{
	role: unknown;
	streamId: unknown;
	recoveryProvenance: unknown;
}> {
	const extensions = value.opaqueExtensions as Readonly<Record<string, unknown>>;
	const capture = extensions.framescaperCaptureV1 as Readonly<Record<string, unknown>>;
	return Object.freeze({
		role: capture.role,
		streamId: capture.streamId,
		recoveryProvenance: capture.recoveryProvenance,
	});
}

function timingAssetStorageKey(value: Readonly<Record<string, unknown>>): string {
	const timingAsset = value.timingAsset as Readonly<Record<string, unknown>>;
	if (typeof timingAsset.storageKey !== 'string') throw new TypeError('Missing video timing storage key.');
	return timingAsset.storageKey;
}

async function requiredMedia(store: AudioEditorProjectStore, storageKey: string): Promise<Blob> {
	const body = await store.loadMediaAsset(storageKey);
	if (!body) throw new Error(`Missing media ${storageKey}`);
	return body instanceof Blob ? body : new Blob([await body.arrayBuffer()], { type: body.type });
}

function snapshot(blob: Blob, locatorRevision: string) {
	return Object.freeze({ blob, locatorRevision });
}

function requiredShift(values: string[]): string {
	const value = values.shift();
	if (!value) throw new Error('Missing deterministic split identity.');
	return value;
}

function requiredString(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value) throw new TypeError(`${name} is missing.`);
	return value;
}
