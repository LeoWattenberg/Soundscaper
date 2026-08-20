/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
	createCaptureRuntimeAvailability,
	type CaptureRuntimeAvailability,
} from '../framescaper-capture-domain.ts';
import type { FramescaperCaptureSessionManifestV1 } from '../framescaper-capture-session-manifest.ts';
import type {
	CapturePreviewLease,
	CaptureSourceEnumerateRequest,
	CaptureSourceOpenPreviewRequest,
	CaptureSourcePortV1,
	CaptureSourceProbeRequest,
} from '../platform/capture-source-port.ts';
import type { EncodedCaptureSpoolRepository } from '../storage/encoded-capture-spool-repository.ts';
import type { FramescaperCaptureSessionManifestRepository } from '../storage/framescaper-capture-session-manifest-repository.ts';
import type { RawPcmSpoolRepository } from '../storage/raw-pcm-spool-repository.ts';
import {
	createFramescaperBrowserRecorderFactory,
	type FramescaperBrowserRecorderFactoryOptions,
} from './framescaper-browser-recorder-factory.ts';
import {
	createBrowserFramescaperCapturePreviewSurface,
	createBrowserFramescaperCaptureLevelMonitor,
} from './framescaper-browser-capture-preview.ts';
import {
	createBrowserFramescaperCaptureSourcePort,
	selectFramescaperVideoMimeType,
	type BrowserCaptureSourcePortDependencies,
	type BrowserCaptureStream,
	type BrowserCaptureTrack,
} from './framescaper-browser-capture-source.ts';
import {
	createFramescaperCaptureCanonicalPublicationService,
	type FramescaperCaptureCanonicalStore,
	type FramescaperCaptureVideoProbeResult,
} from './framescaper-capture-canonical-publication.ts';
import {
	createFramescaperCaptureDurablePortBinding,
	type FramescaperCaptureDurablePortBinding,
} from './framescaper-capture-durable-port.ts';
import { createFramescaperCaptureDurableSessionCoordinator } from './framescaper-capture-durable-session.ts';
import { finalizeFramescaperCaptureDurability } from './framescaper-capture-durable-finalization.ts';
import { createFramescaperCaptureOriginGuard } from './framescaper-capture-origin-guard.ts';
import type { FramescaperCaptureProjectPublicationPort } from './framescaper-capture-project-publication-port.ts';
import type {
	FramescaperCaptureRetryableRecoveryRecord,
} from './framescaper-capture-publication-service.ts';
import type { FramescaperCapturePublicationSequence } from './framescaper-capture-publication-plan.ts';
import { createFramescaperCaptureSessionService } from './framescaper-capture-session-service.ts';
import { createFramescaperCaptureAssetStreams } from './framescaper-capture-stream-timing.ts';
import type {
	FramescaperCaptureDisplaySelectionPort,
	FramescaperCaptureDurablePort,
	FramescaperCaptureFinalizeRequest,
	FramescaperCaptureSessionActions,
	FramescaperCaptureSessionService,
	FramescaperCaptureSessionSnapshot,
} from './framescaper-capture-session-types.ts';
import {
	createFfmpegVideoTimingProbe,
	probeVideoTiming,
	type VideoTimingProbePort,
} from '../video-timing-probe.ts';

type EncodedCaptureRepositories = Pick<EncodedCaptureSpoolRepository,
	'create' | 'load' | 'append' | 'seal' | 'delete' | 'read' | 'releaseAdopted' | 'restoreAcknowledgedPrefix'>;
type RawPcmCaptureRepositories = Pick<RawPcmSpoolRepository,
	'create' | 'load' | 'append' | 'seal' | 'remove' | 'chunks' | 'restoreAcknowledgedPrefix'>;
type CaptureManifestRepositories = Pick<FramescaperCaptureSessionManifestRepository,
	'create' | 'load' | 'listProject' | 'replace' | 'remove'>;
export interface FramescaperCaptureAppStore extends FramescaperCaptureCanonicalStore {
	readonly encodedCaptureSpoolRepository?: EncodedCaptureRepositories;
	readonly rawPcmSpoolRepository?: RawPcmCaptureRepositories;
	readonly framescaperCaptureManifestRepository?: CaptureManifestRepositories;
}

export interface FramescaperCapturePublicationContext {
	readonly recordStartFrame: number;
	readonly projectSampleRate: number;
	readonly sequence: FramescaperCapturePublicationSequence;
	readonly trackInsertionIndex: number;
	readonly signal?: AbortSignal | null;
}

export interface FramescaperCaptureDesktopBridgeV1 {
	status(): PromiseLike<Readonly<{
		readonly version: 1;
		readonly available: boolean;
		readonly unavailableReason: string | null;
		readonly selectionMode: 'source-list' | 'system-picker' | 'unavailable';
		readonly systemAudio: 'windows-loopback' | 'unavailable';
	}>>;
	listSources(generation: number): PromiseLike<Readonly<{
		readonly generation: number;
		readonly sources: readonly Readonly<{ readonly token: string; readonly name: string; readonly kind: 'screen' | 'window' }>[];
	}>>;
	grant(request: Readonly<{
		readonly generation: number;
		readonly roles: readonly ('camera' | 'microphone' | 'display' | 'system-audio')[];
		readonly sourceToken: string | null;
	}>): PromiseLike<unknown>;
	teardown(generation: number): PromiseLike<boolean>;
}

export interface FramescaperCaptureAppCompositionOptions {
	readonly productId: string;
	readonly routeSchemaVersion: 18 | 19;
	readonly embedded: boolean;
	readonly store?: FramescaperCaptureAppStore | null;
	readonly mediaDevices?: BrowserCaptureSourcePortDependencies['mediaDevices'];
	readonly createStream?: BrowserCaptureSourcePortDependencies['createStream'];
	readonly MediaRecorder?: FramescaperBrowserRecorderFactoryOptions['MediaRecorder'];
	readonly MediaStreamTrackProcessor?: FramescaperBrowserRecorderFactoryOptions['MediaStreamTrackProcessor'];
	readonly recordingControllerFactory?: FramescaperBrowserRecorderFactoryOptions['recordingControllerFactory'];
	readonly getAudioContext: FramescaperBrowserRecorderFactoryOptions['getAudioContext'];
	readonly AudioWorkletNode?: unknown;
	readonly videoProbe?: CaptureVideoProbe | null;
	readonly helperTimingProbe?: VideoTimingProbePort | null;
	readonly ffmpeg?: Readonly<{ probeVideoTiming?: VideoTimingProbePort['probe'] }> | null;
	readonly desktopBridge?: FramescaperCaptureDesktopBridgeV1 | null;
	readonly projectPublication?: FramescaperCaptureProjectPublicationPort | null;
	readonly recoveryProjectIds?: () => PromiseLike<readonly string[]> | readonly string[];
	readonly prepareRecoveryOrigin?: (projectId: string) => PromiseLike<void> | void;
	captureOrigin(): ReturnType<Parameters<typeof createFramescaperCaptureSessionService>[0]['captureOrigin']>;
	capturePublicationContext(
		manifest: FramescaperCaptureSessionManifestV1,
	): PromiseLike<FramescaperCapturePublicationContext> | FramescaperCapturePublicationContext;
	readonly createId?: (prefix: string) => string;
	readonly now?: () => number;
	readonly waitCountdown?: (durationMs: number, signal: AbortSignal) => Promise<void>;
	readonly receiptTime?: () => number;
	readonly recordRetryableRecovery?: (
		record: FramescaperCaptureRetryableRecoveryRecord,
	) => PromiseLike<void> | void;
	readonly scheduleDerivatives?: Parameters<typeof createFramescaperCaptureCanonicalPublicationService>[0]['scheduleDerivatives'];
	readonly onWarning?: (error: unknown) => void;
	readonly onChange?: () => void;
}

export interface FramescaperCaptureAppComposition {
	readonly service: FramescaperCaptureSessionService;
	readonly snapshot: Readonly<FramescaperCaptureSessionSnapshot>;
	readonly actions: Readonly<FramescaperCaptureSessionActions>;
	initialize(): Promise<void>;
	dispose(): Promise<void>;
	originSnapshot(activeProjectId?: string | null): ReturnType<ReturnType<typeof createFramescaperCaptureOriginGuard>['snapshot']>;
	assertOriginEditAllowed(projectId: string): void;
	assertOriginCloseAllowed(projectId: string): void;
	assertOriginDeleteAllowed(projectId: string): void;
	assertOriginHandoffAllowed(projectId: string): void;
}

type CaptureVideoProbe = (
	body: Blob,
	context: Readonly<{
		readonly manifest: FramescaperCaptureSessionManifestV1;
		readonly stream: FramescaperCaptureSessionManifestV1['streams'][number];
		readonly signal: AbortSignal | null;
	}>,
) => PromiseLike<FramescaperCaptureVideoProbeResult> | FramescaperCaptureVideoProbeResult;

/** Compose one Framescaper-only capture runtime without touching a media source during construction. */
export function createFramescaperCaptureAppComposition(
	options: FramescaperCaptureAppCompositionOptions,
): Readonly<FramescaperCaptureAppComposition> {
	if (!options || typeof options !== 'object' || typeof options.getAudioContext !== 'function') {
		throw new TypeError('Framescaper capture app composition dependencies are invalid.');
	}
	const originGuard = createFramescaperCaptureOriginGuard();
	const gestures = new Set<number>();
	const desktop = options.desktopBridge ? createDesktopCaptureSelection(options.desktopBridge) : null;
	const browserSource = createBrowserFramescaperCaptureSourcePort({
		mediaDevices: options.mediaDevices,
		consumeUserAction: (generation) => gestures.delete(generation),
		...(options.createStream ? { createStream: options.createStream } : {}),
	});
	const sourcePort = desktop ? wrapDesktopCaptureSource(browserSource, desktop) : browserSource;
	const MediaRecorder = resolveMediaRecorder(options.MediaRecorder);
	const TrackProcessor = resolveTrackProcessor(options.MediaStreamTrackProcessor);
	const recorderFactory = createFramescaperBrowserRecorderFactory({
		MediaRecorder,
		MediaStreamTrackProcessor: TrackProcessor,
		getAudioContext: options.getAudioContext,
		...(options.recordingControllerFactory ? { recordingControllerFactory: options.recordingControllerFactory } : {}),
		...(options.receiptTime ? { receiptTime: options.receiptTime } : {}),
	});
	const durable = createDurableBinding(options.store, options.createId ?? defaultId);
	const videoProbe = options.videoProbe === undefined
		? createFramescaperCaptureVideoProbe(options)
		: options.videoProbe;
	const canonical = createCanonicalPublisher(options, durable, videoProbe);
	const service = createFramescaperCaptureSessionService<BrowserCaptureStream, BrowserCaptureTrack>({
		enabled: options.productId === 'framescaper',
		embedded: options.embedded && !desktop,
		sourcePort,
		...(desktop ? { displaySelection: desktop.port } : {}),
		durable: durable?.port ?? unavailableDurablePort(),
		originGuard,
		completeRuntimeProbe: (availability) => completeRuntimeProbe({
			availability, options, desktop, MediaRecorder, TrackProcessor,
			durable: Boolean(durable), canonical: Boolean(canonical), videoProbe: Boolean(videoProbe),
		}),
		...(options.recoveryProjectIds ? { recoveryProjectIds: options.recoveryProjectIds } : {}),
		...(options.prepareRecoveryOrigin ? { prepareRecoveryOrigin: options.prepareRecoveryOrigin } : {}),
		authorizeUserAction: (generation) => { gestures.add(generation); },
		captureOrigin: options.captureOrigin,
		createRecorder: recorderFactory,
		createPreviewSurface: createBrowserFramescaperCapturePreviewSurface,
		createLevelMonitor: createBrowserFramescaperCaptureLevelMonitor,
		finalize: (request) => finalizeCapture(options, durable, canonical, request),
		...(options.createId ? { createId: options.createId } : {}),
		...(options.now ? { now: options.now } : {}),
		...(options.waitCountdown ? { waitCountdown: options.waitCountdown } : {}),
		...(options.onChange ? { onChange: options.onChange } : {}),
	});
	let initializationFailure: unknown = null;
	let initializePromise: Promise<void> | null = null;
	let disposePromise: Promise<void> | null = null;
	const initialize = () => initializePromise ??= service.initialize().catch(async (error: unknown) => {
		initializationFailure = error;
		try { options.onWarning?.(error); } catch { /* Warning sinks cannot own editor readiness. */ }
		await service.dispose().catch((disposeError: unknown) => {
			try { options.onWarning?.(disposeError); } catch { /* Warning sinks cannot own editor readiness. */ }
		});
	});
	const captureSnapshot = () => initializationFailure === null ? service.snapshot : Object.freeze({
		...service.snapshot,
		availability: createCaptureRuntimeAvailability({
			status: 'unavailable', reason: 'runtime-error', detail: errorMessage(initializationFailure),
		}),
	});
	const appService: FramescaperCaptureSessionService = Object.freeze({
		get snapshot() { return captureSnapshot(); }, actions: service.actions, initialize,
		settled: () => service.settled(), dispose: () => disposeComposition(service, desktop),
	});
	const composition: FramescaperCaptureAppComposition = {
		service: appService,
		get snapshot() { return captureSnapshot(); },
		get actions() { return appService.actions; },
		initialize,
		dispose() {
			disposePromise ??= disposeComposition(service, desktop);
			return disposePromise;
		},
		originSnapshot: (projectId = null) => originGuard.snapshot(projectId),
		assertOriginEditAllowed: originGuard.assertEditAllowed,
		assertOriginCloseAllowed: originGuard.assertCloseAllowed,
		assertOriginDeleteAllowed: originGuard.assertDeleteAllowed,
		assertOriginHandoffAllowed: originGuard.assertHandoffAllowed,
	};
	return Object.freeze(composition);
}

/** Bind exact timing probes to the canonical capture video-asset contract. */
export function createFramescaperCaptureVideoProbe(options: Readonly<{
	readonly helperTimingProbe?: VideoTimingProbePort | null;
	readonly ffmpeg?: Readonly<{ probeVideoTiming?: VideoTimingProbePort['probe'] }> | null;
}>): CaptureVideoProbe | null {
	const probes = [options.helperTimingProbe ?? null, createFfmpegVideoTimingProbe(options.ffmpeg ?? {})]
		.filter((probe): probe is VideoTimingProbePort => Boolean(probe));
	if (!probes.length) return null;
	return async (body, context) => {
		const result = await probeVideoTiming(body, {
			probes,
			...(context.signal ? { signal: context.signal } : {}),
		});
		if (result.decision !== 'timing-asset') {
			throw new Error('Capture video did not expose an exact timing asset.');
		}
		const width = result.characteristics.codedWidth;
		const height = result.characteristics.codedHeight;
		if (!width || !height) throw new Error('Capture video probe did not report coded geometry.');
		return Object.freeze({
			backend: result.backend,
			nominalRate: result.nominalRate,
			timing: result.timing,
			width,
			height,
			characteristics: result.characteristics,
		});
	};
}

/** A retry of the same manifest produces the byte-identical publication command IDs. */
export function createFramescaperCapturePublicationIdFactory(sessionId: string): (prefix: string) => string {
	if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 256) {
		throw new TypeError('Capture publication requires a bounded session ID.');
	}
	let index = 0;
	return (prefix) => {
		if (typeof prefix !== 'string' || !prefix || prefix.length > 128) {
			throw new TypeError('Capture publication ID prefix is invalid.');
		}
		const digest = bytesToHex(sha256(new TextEncoder().encode(
			JSON.stringify([sessionId, prefix, index++]),
		)));
		const label = prefix.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '').slice(0, 48)
			|| 'capture';
		return `${label}-${digest.slice(0, 32)}`;
	};
}

interface DesktopCaptureSelection {
	readonly port: FramescaperCaptureDisplaySelectionPort;
	status(): Promise<Readonly<{ readonly available: boolean; readonly systemAudio: boolean }>>;
	grantedGeneration(): number | null;
	teardown(generation: number): Promise<void>;
	dispose(): Promise<void>;
}

function createDesktopCaptureSelection(bridge: FramescaperCaptureDesktopBridgeV1): DesktopCaptureSelection {
	let mode: 'source-list' | 'system-picker' = 'source-list';
	let systemAudio = false;
	let generation = 0;
	let inventoryGeneration: number | null = null;
	let currentGeneration: number | null = null;
	const port = Object.freeze({
		get mode() { return mode; },
		async listSources() {
			if (mode !== 'source-list') throw new Error('Desktop source listing is unavailable.');
			generation += 1;
			const listed = await bridge.listSources(generation);
			if (listed.generation !== generation) throw new Error('Desktop source inventory generation changed.');
			inventoryGeneration = generation;
			currentGeneration = generation;
			return listed.sources;
		},
		async authorize(request: Parameters<FramescaperCaptureDisplaySelectionPort['authorize']>[0]) {
			if (request.roles.includes('system-audio') && !systemAudio) {
				throw new Error('Desktop system audio is unavailable on this platform.');
			}
			const roles = systemAudio
				&& request.roles.includes('display')
				&& !request.roles.includes('system-audio')
				? Object.freeze([...request.roles, 'system-audio' as const])
				: request.roles;
			const usesInventory = mode === 'source-list' && request.roles.includes('display');
			const next = usesInventory ? inventoryGeneration : ++generation;
			if (!next) throw new Error('Choose a current desktop source before preview.');
			await bridge.grant({ ...request, roles, generation: next });
			inventoryGeneration = null;
			currentGeneration = next;
		},
	}) satisfies FramescaperCaptureDisplaySelectionPort;
	return Object.freeze({
		port,
		async status() {
			const value = await bridge.status();
			if (value.version !== 1 || !value.available
				|| (value.selectionMode !== 'source-list' && value.selectionMode !== 'system-picker')) {
				return Object.freeze({ available: false, systemAudio: false });
			}
			mode = value.selectionMode;
			systemAudio = value.systemAudio === 'windows-loopback';
			return Object.freeze({ available: true, systemAudio });
		},
		grantedGeneration: () => currentGeneration,
		async teardown(value: number) {
			await bridge.teardown(value);
			if (currentGeneration === value) currentGeneration = null;
		},
		async dispose() {
			if (currentGeneration !== null) await bridge.teardown(currentGeneration);
			currentGeneration = null;
			inventoryGeneration = null;
		},
	});
}

function wrapDesktopCaptureSource(
	source: CaptureSourcePortV1<BrowserCaptureStream, BrowserCaptureTrack>,
	desktop: DesktopCaptureSelection,
): CaptureSourcePortV1<BrowserCaptureStream, BrowserCaptureTrack> {
	return Object.freeze({
		probe: (request: CaptureSourceProbeRequest) => source.probe({ ...request, embedded: false }),
		enumerate: (request: CaptureSourceEnumerateRequest) => source.enumerate(request),
		async openPreview(request: CaptureSourceOpenPreviewRequest) {
			const generation = desktop.grantedGeneration();
			if (generation === null) throw new Error('Desktop capture preview lacks a current grant.');
			let lease: CapturePreviewLease<BrowserCaptureStream, BrowserCaptureTrack>;
			try { lease = await source.openPreview(request); }
			catch (error) { await desktop.teardown(generation).catch(() => undefined); throw error; }
			let disposed = false;
			return Object.freeze({
				sources: lease.sources,
				async dispose() {
					if (disposed) return;
					disposed = true;
					try { await lease.dispose(); } finally { await desktop.teardown(generation); }
				},
			});
		},
	});
}

function createDurableBinding(
	store: FramescaperCaptureAppStore | null | undefined,
	createId: (prefix: string) => string,
): FramescaperCaptureDurablePortBinding | null {
	if (!hasCaptureRepositories(store)) return null;
	return createFramescaperCaptureDurablePortBinding({
		coordinator: createFramescaperCaptureDurableSessionCoordinator({
			manifests: store.framescaperCaptureManifestRepository,
			encodedSpools: store.encodedCaptureSpoolRepository,
			rawPcmSpools: store.rawPcmSpoolRepository,
		}),
		createId,
	});
}

function createCanonicalPublisher(
	options: FramescaperCaptureAppCompositionOptions,
	durable: FramescaperCaptureDurablePortBinding | null,
	videoProbe: CaptureVideoProbe | null,
) {
	const store = options.store;
	if (!durable || !videoProbe || !hasCaptureRepositories(store)
		|| !hasCanonicalStore(store) || !options.projectPublication) return null;
	return createFramescaperCaptureCanonicalPublicationService({
		store,
		encodedSpools: store.encodedCaptureSpoolRepository,
		rawPcmSpools: store.rawPcmSpoolRepository,
		manifests: store.framescaperCaptureManifestRepository,
		probeVideo: videoProbe,
		assertProjectFence: options.projectPublication.assertProjectFence,
		commitAtomic: options.projectPublication.commitAtomic,
		recordRetryableRecovery: options.recordRetryableRecovery ?? ((record) => options.onWarning?.(record.error)),
		...(options.scheduleDerivatives ? { scheduleDerivatives: options.scheduleDerivatives } : {}),
		...(options.onWarning ? { onDerivativeWarning: options.onWarning } : {}),
		...(options.now ? { now: options.now } : {}),
	});
}

async function finalizeCapture(
	options: FramescaperCaptureAppCompositionOptions,
	durable: FramescaperCaptureDurablePortBinding | null,
	canonical: ReturnType<typeof createFramescaperCaptureCanonicalPublicationService> | null,
	request: FramescaperCaptureFinalizeRequest,
): Promise<void> {
	if (!durable || !canonical) throw new Error('Canonical Framescaper capture publication is unavailable.');
	const coordinator = durable.coordinatorSession(request.session);
	const manifest = coordinator.manifest;
	const context = await options.capturePublicationContext(manifest);
	await finalizeFramescaperCaptureDurability({
		state: manifest.state,
		publish: () => canonical.publish({
			manifest,
			recoveryProvenance: request.provenance,
			destination: manifest.origin.destination,
			...context,
			streams: createFramescaperCaptureAssetStreams(manifest, request.metrics, context.projectSampleRate),
			createId: createFramescaperCapturePublicationIdFactory(manifest.sessionId),
		}),
		retireCommitted: () => durable.retireCommitted(request.session),
		refreshRecovery: () => durable.refresh(request.session).then(() => undefined),
		...(options.onWarning ? { onCleanupWarning: options.onWarning } : {}),
	});
}

async function completeRuntimeProbe(input: Readonly<{
	readonly availability: CaptureRuntimeAvailability;
	readonly options: FramescaperCaptureAppCompositionOptions;
	readonly desktop: DesktopCaptureSelection | null;
	readonly MediaRecorder: FramescaperBrowserRecorderFactoryOptions['MediaRecorder'];
	readonly TrackProcessor: FramescaperBrowserRecorderFactoryOptions['MediaStreamTrackProcessor'];
	readonly durable: boolean;
	readonly canonical: boolean;
	readonly videoProbe: boolean;
}>): Promise<CaptureRuntimeAvailability> {
	if (input.options.productId !== 'framescaper') return unavailable('unsupported-platform');
	if (input.options.routeSchemaVersion !== (input.desktop ? 18 : 19)) return unavailable('unsupported-platform');
	if (input.options.embedded && !input.desktop) return unavailable('embedded-route');
	if (input.availability.status !== 'available') return input.availability;
	if (!input.availability.sourceRoles.includes('display')) return unavailable('display-capture-unavailable');
	if (selectFramescaperVideoMimeType(input.MediaRecorder) === null) return unavailable('video-encoder-unavailable');
	let desktopStatus: Awaited<ReturnType<DesktopCaptureSelection['status']>> | null = null;
	if (input.desktop) {
		desktopStatus = await input.desktop.status();
		if (!desktopStatus.available) return unavailable('unsupported-platform');
	}
	let context: Awaited<ReturnType<FramescaperCaptureAppCompositionOptions['getAudioContext']>>;
	try {
		context = await input.options.getAudioContext();
		if (!context || !Number.isFinite(context.sampleRate) || context.sampleRate <= 0) return unavailable('audio-packet-source-unavailable');
	} catch { return unavailable('audio-packet-source-unavailable'); }
	const worklet = typeof input.options.recordingControllerFactory === 'function' || (
		typeof (input.options.AudioWorkletNode ?? globalThis.AudioWorkletNode) === 'function'
		&& typeof context.audioWorklet?.addModule === 'function'
		&& typeof context.createMediaStreamSource === 'function'
	);
	if (typeof input.TrackProcessor !== 'function' && !worklet) return unavailable('audio-packet-source-unavailable');
	if (!input.durable) return unavailable('durable-storage-unavailable');
	if (!input.videoProbe) return unavailable('media-probe-unavailable');
	if (!input.canonical) return unavailable('durable-storage-unavailable');
	const sourceRoles = desktopStatus?.systemAudio === false ? input.availability.sourceRoles.filter((role) => role !== 'system-audio') : input.availability.sourceRoles;
	return createCaptureRuntimeAvailability({ status: 'available', sourceRoles });
}

function unavailable(reason: Parameters<typeof createCaptureRuntimeAvailability>[0] extends infer _Value
	? 'embedded-route' | 'unsupported-platform' | 'display-capture-unavailable' | 'video-encoder-unavailable'
		| 'audio-packet-source-unavailable' | 'durable-storage-unavailable' | 'media-probe-unavailable'
	: never): CaptureRuntimeAvailability {
	return createCaptureRuntimeAvailability({ status: 'unavailable', reason, detail: null });
}

function hasCaptureRepositories(
	store: FramescaperCaptureAppStore | null | undefined,
): store is FramescaperCaptureAppStore & Required<Pick<FramescaperCaptureAppStore,
	'encodedCaptureSpoolRepository' | 'rawPcmSpoolRepository' | 'framescaperCaptureManifestRepository'
>> {
	return Boolean(store
		&& methods(store.encodedCaptureSpoolRepository,
			['create', 'load', 'append', 'seal', 'delete', 'read', 'releaseAdopted', 'restoreAcknowledgedPrefix'])
		&& methods(store.rawPcmSpoolRepository,
			['create', 'load', 'append', 'seal', 'remove', 'chunks', 'restoreAcknowledgedPrefix'])
		&& methods(store.framescaperCaptureManifestRepository, ['create', 'load', 'listProject', 'replace', 'remove']));
}
function hasCanonicalStore(store: FramescaperCaptureAppStore): boolean {
	return methods(store, [
		'getSourceMetadata', 'beginSourceWrite', 'discardSourceIfCurrent',
		'getMediaAssetMetadata', 'beginMediaAssetWrite', 'loadMediaAsset',
	]);
}

function methods(value: unknown, names: readonly string[]): boolean {
	if (!value || typeof value !== 'object') return false;
	const record = value as Readonly<Record<string, unknown>>;
	return names.every((name) => typeof record[name] === 'function');
}

function resolveMediaRecorder(
	value: FramescaperCaptureAppCompositionOptions['MediaRecorder'],
): FramescaperBrowserRecorderFactoryOptions['MediaRecorder'] {
	return value === undefined
		? (typeof globalThis.MediaRecorder === 'function'
			? globalThis.MediaRecorder as unknown as FramescaperBrowserRecorderFactoryOptions['MediaRecorder']
			: null)
		: value;
}
function resolveTrackProcessor(
	value: FramescaperCaptureAppCompositionOptions['MediaStreamTrackProcessor'],
): FramescaperBrowserRecorderFactoryOptions['MediaStreamTrackProcessor'] {
	if (value !== undefined) return value;
	const runtime = globalThis as unknown as Readonly<{ MediaStreamTrackProcessor?: unknown }>;
	return typeof runtime.MediaStreamTrackProcessor === 'function'
		? runtime.MediaStreamTrackProcessor as NonNullable<typeof value>
		: null;
}
function unavailableDurablePort(): FramescaperCaptureDurablePort {
	const reject = async (): Promise<never> => { throw new Error('Durable Framescaper capture is unavailable.'); };
	return Object.freeze({
		prepare: reject,
		append: reject,
		recordPauseSpan: reject,
		seal: reject,
		discard: reject,
		findRecovery: async () => null,
	});
}

async function disposeComposition(
	service: FramescaperCaptureSessionService,
	desktop: DesktopCaptureSelection | null,
): Promise<void> {
	const results = [await settle(service.dispose()), await settle(desktop?.dispose() ?? Promise.resolve())];
	const failures = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
	if (failures.length) throw new AggregateError(failures, 'Framescaper capture composition did not dispose cleanly.');
}
function settle(operation: Promise<void>): Promise<PromiseSettledResult<void>> {
	return operation.then((value) => ({ status: 'fulfilled', value }),
		(reason: unknown) => ({ status: 'rejected', reason }));
}
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function defaultId(prefix: string): string { return `${prefix}-${globalThis.crypto.randomUUID()}`; }
