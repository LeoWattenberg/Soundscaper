/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
	createCaptureRuntimeAvailability,
	type CaptureRuntimeAvailability,
} from '../framescaper-capture-domain.ts';
import type { FramescaperCaptureSessionManifestV1 } from '../framescaper-capture-session-manifest.ts';
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
import {
	createFramescaperCaptureDeviceAdapter,
	type FramescaperCaptureDesktopBridgeV1,
	type FramescaperCaptureDesktopSelection,
} from './framescaper-capture-device-adapter.ts';
import { createFramescaperCaptureOriginGuard } from './framescaper-capture-origin-guard.ts';
import { completeFramescaperCaptureRuntimeProbe } from './framescaper-capture-runtime-probe.ts';
import type { FramescaperCaptureProjectPublicationPort } from './framescaper-capture-project-publication-port.ts';
import type {
	FramescaperCaptureRetryableRecoveryRecord,
} from './framescaper-capture-publication-service.ts';
import type { FramescaperCapturePublicationSequence } from './framescaper-capture-publication-plan.ts';
import { createFramescaperCaptureSessionService } from './framescaper-capture-session-service.ts';
import { createFramescaperCaptureSetupDefaults } from './framescaper-capture-setup-defaults.ts';
import type { FramescaperCaptureStartAdmissionPort } from './framescaper-capture-start-admission.ts';
import { createFramescaperCaptureSourceAdapterRouter } from './framescaper-capture-source-adapter-router.ts';
import { createFramescaperCaptureAssetStreams } from './framescaper-capture-stream-timing.ts';
import type {
	FramescaperCaptureDurablePort,
	FramescaperCaptureFinalizeRequest,
	FramescaperCaptureSessionActions,
	FramescaperCaptureSessionService,
	FramescaperCaptureSessionSnapshot,
} from './framescaper-capture-session-types.ts';
import { createFramescaperWebVcrCaptureAdapter } from './framescaper-web-vcr-capture-adapter.ts';
import { createFramescaperWebVcrController } from './framescaper-web-vcr-controller.ts';
import type {
	FramescaperWebVcrActions,
	FramescaperWebVcrBridgeV1,
	FramescaperWebVcrController,
	FramescaperWebVcrUiSnapshot,
} from './framescaper-web-vcr-controller-types.ts';
import {
	createWebVcrCroppedVideoTrack,
	type WebVcrVideoFrameCropRuntime,
} from './web-vcr-video-frame-crop.ts';
import {
	createFfmpegVideoTimingProbe,
	probeVideoTiming,
	type VideoTimingProbePort,
} from '../video-timing-probe.ts';

type EncodedCaptureRepositories = Pick<EncodedCaptureSpoolRepository,
	'create' | 'load' | 'append' | 'reconcileAppend' | 'seal' | 'delete' | 'read'
	| 'releaseAdopted' | 'restoreAcknowledgedPrefix'>;
type RawPcmCaptureRepositories = Pick<RawPcmSpoolRepository,
	'create' | 'createFramescaper' | 'load' | 'append' | 'reconcileAppend' | 'seal'
	| 'remove' | 'releaseReservation' | 'chunks' | 'restoreAcknowledgedPrefix'>;
type CaptureManifestRepositories = Pick<FramescaperCaptureSessionManifestRepository,
	'create' | 'load' | 'listProject' | 'replace' | 'remove' | 'createCreation'
	| 'loadCreation' | 'listProjectCreations' | 'listCreations' | 'publishCreation'
	| 'replaceCreation' | 'removeCreation'>;
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
export type { FramescaperCaptureDesktopBridgeV1 } from './framescaper-capture-device-adapter.ts';

export interface FramescaperCaptureAppCompositionOptions {
	readonly productId: string;
	readonly routeSchemaVersion: 18 | 19 | 20;
	readonly embedded: boolean;
	readonly store?: FramescaperCaptureAppStore | null;
	readonly mediaDevices?: BrowserCaptureSourcePortDependencies['mediaDevices'];
	readonly createStream?: BrowserCaptureSourcePortDependencies['createStream'];
	readonly MediaRecorder?: FramescaperBrowserRecorderFactoryOptions['MediaRecorder'];
	readonly MediaStreamTrackProcessor?: FramescaperBrowserRecorderFactoryOptions['MediaStreamTrackProcessor'];
	readonly MediaStreamTrackGenerator?: WebVcrVideoFrameCropRuntime['MediaStreamTrackGenerator'] | null;
	readonly VideoFrame?: WebVcrVideoFrameCropRuntime['VideoFrame'] | null;
	readonly recordingControllerFactory?: FramescaperBrowserRecorderFactoryOptions['recordingControllerFactory'];
	readonly getAudioContext: FramescaperBrowserRecorderFactoryOptions['getAudioContext'];
	readonly AudioWorkletNode?: unknown;
	readonly videoProbe?: CaptureVideoProbe | null;
	readonly helperTimingProbe?: VideoTimingProbePort | null;
	readonly ffmpeg?: Readonly<{ probeVideoTiming?: VideoTimingProbePort['probe'] }> | null;
	readonly desktopBridge?: FramescaperCaptureDesktopBridgeV1 | null;
	readonly webVcrBridge?: FramescaperWebVcrBridgeV1 | null;
	readonly webVcrEnabled?: boolean;
	readonly showWebVcrPanel?: () => void;
	readonly hideWebVcrPanel?: () => void;
	readonly projectPublication?: FramescaperCaptureProjectPublicationPort | null;
	readonly recoveryProjectIds?: () => PromiseLike<readonly string[]> | readonly string[];
	readonly captureSpoolLockAvailable?: () => boolean;
	readonly prepareRecoveryOrigin?: (projectId: string) => PromiseLike<void> | void;
	readonly startAdmission?: Pick<FramescaperCaptureStartAdmissionPort, 'begin'> | null;
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
	readonly webVcrSnapshot: Readonly<FramescaperWebVcrUiSnapshot>;
	readonly webVcrActions: Readonly<FramescaperWebVcrActions>;
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

const UNAVAILABLE_START_ADMISSION = Object.freeze({
	begin(): never { throw new Error('Web VCR app capture start admission is unavailable.'); },
});
/** Compose one Framescaper-only capture runtime without touching a media source during construction. */
export function createFramescaperCaptureAppComposition(
	options: FramescaperCaptureAppCompositionOptions,
): Readonly<FramescaperCaptureAppComposition> {
	if (!options || typeof options !== 'object' || typeof options.getAudioContext !== 'function') {
		throw new TypeError('Framescaper capture app composition dependencies are invalid.');
	}
	if (options.webVcrEnabled === true && !options.startAdmission) {
		throw new TypeError('Enabled Web VCR requires exact app capture start admission.');
	}
	const originGuard = createFramescaperCaptureOriginGuard();
	const gestures = new Set<number>();
	const createStream = resolveCaptureStream(options.createStream);
	const browserSource = createBrowserFramescaperCaptureSourcePort({
		mediaDevices: options.mediaDevices,
		consumeUserAction: (generation) => gestures.delete(generation),
		createStream,
	});
	const setupDefaults = createFramescaperCaptureSetupDefaults(options.onChange);
	const MediaRecorder = resolveMediaRecorder(options.MediaRecorder);
	const TrackProcessor = resolveTrackProcessor(options.MediaStreamTrackProcessor);
	const recorderFactory = createFramescaperBrowserRecorderFactory({
		MediaRecorder,
		MediaStreamTrackProcessor: TrackProcessor,
		getAudioContext: options.getAudioContext,
		...(options.recordingControllerFactory ? { recordingControllerFactory: options.recordingControllerFactory } : {}),
		...(options.receiptTime ? { receiptTime: options.receiptTime } : {}),
	});
	const devices = createFramescaperCaptureDeviceAdapter({
		sourcePort: browserSource,
		desktopBridge: options.desktopBridge,
		createRecorder: recorderFactory,
	});
	const desktop = devices.desktop;
	let webVcr: Readonly<FramescaperWebVcrController> | null = null;
	const webAuthority = Object.freeze({
		prepareCapture: () => requiredWebVcr(webVcr).captureAuthority.prepareCapture(),
		captureSurface: () => requiredWebVcr(webVcr).captureAuthority.captureSurface(),
		attachMonitor: (value: Parameters<FramescaperWebVcrController['captureAuthority']['attachMonitor']>[0]) => requiredWebVcr(webVcr).captureAuthority.attachMonitor(value),
		reportDimensions: (value: Parameters<FramescaperWebVcrController['captureAuthority']['reportDimensions']>[0]) => requiredWebVcr(webVcr).captureAuthority.reportDimensions(value),
		reportFailure: (error: unknown) => requiredWebVcr(webVcr).captureAuthority.reportFailure(error),
	});
	const cropRuntime = resolveWebVcrCropRuntime(options, TrackProcessor);
	const webAdapter = options.webVcrBridge && cropRuntime ? createFramescaperWebVcrCaptureAdapter({
		sourcePort: browserSource,
		baseRecorder: recorderFactory,
		createStream,
		getAudioContext: options.getAudioContext as unknown as Parameters<typeof createFramescaperWebVcrCaptureAdapter>[0]['getAudioContext'],
		openCrop: ({ source, crop, onError }) => createWebVcrCroppedVideoTrack({
			source, crop, onError, runtime: cropRuntime,
		}),
		authority: webAuthority,
	}) : null;
	const router = createFramescaperCaptureSourceAdapterRouter([
		devices.adapter,
		...(webAdapter ? [webAdapter.adapter] : []),
	]);
	const durable = createDurableBinding(options.store, options.createId ?? defaultId);
	const videoProbe = options.videoProbe === undefined
		? createFramescaperCaptureVideoProbe(options)
		: options.videoProbe;
	const canonical = createCanonicalPublisher(options, durable, videoProbe);
	let deviceAvailability: CaptureRuntimeAvailability | null = null;
	const service = createFramescaperCaptureSessionService<BrowserCaptureStream, BrowserCaptureTrack>({
		enabled: options.productId === 'framescaper',
		embedded: options.embedded && !desktop,
		sourcePort: router.sourcePort,
		...(desktop || webAdapter ? { displaySelection: router.displaySelection } : {}),
		durable: durable?.port ?? unavailableDurablePort(),
		originGuard,
		setupDefaults,
		completeRuntimeProbe: async (availability) => deviceAvailability = await completeFramescaperCaptureRuntimeProbe({
			availability, productId: options.productId, routeSchemaVersion: options.routeSchemaVersion,
			embedded: options.embedded, desktop, MediaRecorder, TrackProcessor, getAudioContext: options.getAudioContext,
			...(options.recordingControllerFactory ? { recordingControllerFactory: options.recordingControllerFactory } : {}),
			...(options.AudioWorkletNode !== undefined ? { AudioWorkletNode: options.AudioWorkletNode } : {}),
			...(options.captureSpoolLockAvailable ? { captureSpoolLockAvailable: options.captureSpoolLockAvailable } : {}),
			durable: Boolean(durable), canonical: Boolean(canonical), videoProbe: Boolean(videoProbe),
		}),
		...(options.recoveryProjectIds ? { recoveryProjectIds: options.recoveryProjectIds } : {}),
		...(options.prepareRecoveryOrigin ? { prepareRecoveryOrigin: options.prepareRecoveryOrigin } : {}),
		authorizeUserAction: (generation) => { gestures.add(generation); },
		captureOrigin: options.captureOrigin,
		createRecorder: router.createRecorder,
		createSourceIdentity: router.sourceIdentity,
		createPreviewSurface: createBrowserFramescaperCapturePreviewSurface,
		createLevelMonitor: createBrowserFramescaperCaptureLevelMonitor,
		finalize: (request) => finalizeCapture(options, durable, canonical, request),
		...(options.createId ? { createId: options.createId } : {}),
		...(options.now ? { now: options.now } : {}),
		...(options.waitCountdown ? { waitCountdown: options.waitCountdown } : {}),
		onChange: () => { webVcr?.synchronizeCapture(); options.onChange?.(); },
	});
	webVcr = createFramescaperWebVcrController({
		enabled: options.webVcrEnabled === true,
		bridge: options.webVcrBridge,
		cropRuntimeAvailable: Boolean(webAdapter),
		getCapture: () => service,
		startAdmission: options.startAdmission ?? UNAVAILABLE_START_ADMISSION,
		adapter: Object.freeze({
			select(id: 'devices' | 'web-vcr') {
				router.select(id);
				const base = deviceAvailability ?? service.snapshot.availability;
				service.setRuntimeAvailability(withWebVcrPageAudio(
					base, id === 'web-vcr' && webVcr?.snapshot.capability.status === 'available',
				));
			},
			freezeCrop: (value: Parameters<NonNullable<typeof webAdapter>['freezeCrop']>[0]) => {
				if (!webAdapter) throw new Error('Web VCR crop adapter is unavailable.');
				webAdapter.freezeCrop(value);
			},
			setMonitorMuted: (value: boolean) => webAdapter?.setMonitorMuted(value),
		}),
		showPanel: options.showWebVcrPanel,
		hidePanel: options.hideWebVcrPanel,
		onChange: options.onChange,
		onWarning: options.onWarning,
	});
	let initializationFailure: unknown = null;
	let initializePromise: Promise<void> | null = null;
	let disposePromise: Promise<void> | null = null;
	const initialize = () => initializePromise ??= Promise.resolve().then(async () => {
		await service.initialize();
		await webVcr!.initialize();
	}).catch(async (error: unknown) => {
		initializationFailure = error;
		try { options.onWarning?.(error); } catch { /* Warning sinks cannot own editor readiness. */ }
		await disposeComposition(service, desktop, webVcr).catch((disposeError: unknown) => {
			try { options.onWarning?.(disposeError); } catch { /* Warning sinks cannot own editor readiness. */ }
		});
	});
	const captureSnapshot = () => initializationFailure === null ? service.snapshot : Object.freeze({
		...service.snapshot,
		availability: createCaptureRuntimeAvailability({
			status: 'unavailable', reason: 'runtime-error', detail: errorMessage(initializationFailure),
		}),
	});
	const dispose = () => disposePromise ??= disposeComposition(service, desktop, webVcr);
	const actions: Readonly<FramescaperCaptureSessionActions> = Object.freeze({
		...service.actions,
		sealForShutdown: () => webVcr!.sealForShutdown(),
	});
	const appService: FramescaperCaptureSessionService = Object.freeze({
		get snapshot() { return captureSnapshot(); }, actions, initialize,
		setRuntimeAvailability: service.setRuntimeAvailability,
		settled: () => service.settled(), dispose,
	});
	const composition: FramescaperCaptureAppComposition = {
		service: appService,
		get snapshot() { return captureSnapshot(); },
		get actions() { return appService.actions; },
		get webVcrSnapshot() { return webVcr!.snapshot; },
		get webVcrActions() { return webVcr!.actions; },
		initialize,
		dispose,
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

function withWebVcrPageAudio(
	base: CaptureRuntimeAvailability,
	enabled: boolean,
): CaptureRuntimeAvailability {
	if (!enabled || base.status !== 'available' || base.sourceRoles.includes('system-audio')) return base;
	return createCaptureRuntimeAvailability({
		status: 'available', sourceRoles: [...base.sourceRoles, 'system-audio'],
	});
}

function hasCaptureRepositories(
	store: FramescaperCaptureAppStore | null | undefined,
): store is FramescaperCaptureAppStore & Required<Pick<FramescaperCaptureAppStore,
	'encodedCaptureSpoolRepository' | 'rawPcmSpoolRepository' | 'framescaperCaptureManifestRepository'
>> {
	return Boolean(store
		&& methods(store.encodedCaptureSpoolRepository,
			['create', 'load', 'append', 'reconcileAppend', 'seal', 'delete', 'read',
				'releaseAdopted', 'restoreAcknowledgedPrefix'])
		&& methods(store.rawPcmSpoolRepository,
			['create', 'createFramescaper', 'load', 'append', 'reconcileAppend', 'seal',
				'remove', 'releaseReservation', 'chunks', 'restoreAcknowledgedPrefix'])
		&& methods(store.framescaperCaptureManifestRepository,
			['create', 'load', 'listProject', 'replace', 'remove', 'createCreation',
				'loadCreation', 'listProjectCreations', 'listCreations', 'publishCreation',
				'replaceCreation', 'removeCreation']));
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
function resolveCaptureStream(
	value: FramescaperCaptureAppCompositionOptions['createStream'],
): NonNullable<BrowserCaptureSourcePortDependencies['createStream']> {
	if (value) return value;
	return (tracks) => {
		if (typeof globalThis.MediaStream !== 'function') {
			throw new Error('MediaStream construction is unavailable in this runtime.');
		}
		return new globalThis.MediaStream([...tracks] as unknown as MediaStreamTrack[]) as unknown as BrowserCaptureStream;
	};
}
function resolveWebVcrCropRuntime(
	options: FramescaperCaptureAppCompositionOptions,
	processor: FramescaperBrowserRecorderFactoryOptions['MediaStreamTrackProcessor'],
): WebVcrVideoFrameCropRuntime | null {
	const runtime = globalThis as unknown as Readonly<{
		MediaStreamTrackGenerator?: unknown;
		VideoFrame?: unknown;
	}>;
	const generator = options.MediaStreamTrackGenerator === undefined
		? runtime.MediaStreamTrackGenerator
		: options.MediaStreamTrackGenerator;
	const frame = options.VideoFrame === undefined ? runtime.VideoFrame : options.VideoFrame;
	if (typeof processor !== 'function' || typeof generator !== 'function' || typeof frame !== 'function') return null;
	return Object.freeze({
		MediaStreamTrackProcessor: processor as unknown as WebVcrVideoFrameCropRuntime['MediaStreamTrackProcessor'],
		MediaStreamTrackGenerator: generator as WebVcrVideoFrameCropRuntime['MediaStreamTrackGenerator'],
		VideoFrame: frame as WebVcrVideoFrameCropRuntime['VideoFrame'],
	});
}
function requiredWebVcr(
	value: Readonly<FramescaperWebVcrController> | null,
): Readonly<FramescaperWebVcrController> {
	if (!value) throw new Error('Web VCR controller is not ready.');
	return value;
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
	desktop: FramescaperCaptureDesktopSelection | null,
	webVcr: Readonly<FramescaperWebVcrController> | null,
): Promise<void> {
	const results = [
		await settle(service.dispose()),
		await settle(desktop?.dispose() ?? Promise.resolve()),
		await settle(webVcr?.dispose() ?? Promise.resolve()),
	];
	const failures = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
	if (failures.length) throw new AggregateError(failures, 'Framescaper capture composition did not dispose cleanly.');
}
function settle(operation: Promise<void>): Promise<PromiseSettledResult<void>> {
	return operation.then((value) => ({ status: 'fulfilled', value }),
		(reason: unknown) => ({ status: 'rejected', reason }));
}
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function defaultId(prefix: string): string { return `${prefix}-${globalThis.crypto.randomUUID()}`; }
