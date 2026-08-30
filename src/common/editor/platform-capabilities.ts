/* SPDX-License-Identifier: AGPL-3.0-only */

export type PlatformRuntime = 'web' | 'electron';
export type PlatformTierStatus = 'unavailable' | 'partial' | 'available';
export type PlatformStorageBackend = 'indexeddb' | 'memory';

/**
 * Narrow global surface used for feature detection. Tests and alternate hosts
 * can inject this surface without changing process globals.
 */
export interface PlatformCapabilityScope {
	readonly indexedDB?: unknown;
	readonly navigator?: unknown;
	readonly document?: unknown;
	readonly URL?: unknown;
	readonly Blob?: unknown;
	readonly Worker?: unknown;
	readonly WebAssembly?: unknown;
	readonly AudioContext?: unknown;
	readonly webkitAudioContext?: unknown;
	readonly OfflineAudioContext?: unknown;
	readonly webkitOfflineAudioContext?: unknown;
	readonly AudioWorkletNode?: unknown;
	readonly HTMLMediaElement?: unknown;
	readonly CanvasRenderingContext2D?: unknown;
	readonly WebGL2RenderingContext?: unknown;
	readonly MediaSource?: unknown;
	readonly AudioDecoder?: unknown;
	readonly VideoDecoder?: unknown;
	readonly AudioEncoder?: unknown;
	readonly VideoEncoder?: unknown;
	readonly FileSystemFileHandle?: unknown;
	readonly showOpenFilePicker?: unknown;
	readonly showSaveFilePicker?: unknown;
	readonly showDirectoryPicker?: unknown;
	readonly scapeDesktop?: unknown;
	readonly soundscaperDesktop?: unknown;
	readonly framescaperDesktop?: unknown;
	readonly window?: unknown;
}

export interface PlatformProjectStoreProbe {
	readonly ready: boolean;
	readonly backend: PlatformStorageBackend;
	readonly opfsSourceStorageReady?: boolean;
}

/** Adapter values are affirmative evidence supplied by initialized owners. */
export interface PlatformAdapterProbe {
	readonly projectStore?: PlatformProjectStoreProbe;
	readonly audioEngineReady?: boolean;
	readonly videoFrameExtractionReady?: boolean;
	readonly ffmpegReady?: boolean;
	readonly webCodecsReady?: boolean;
}

const FRAMESCAPER_DESKTOP_BRIDGE_ENABLED = typeof __SCAPE_PRODUCT__ === 'undefined'
	|| __SCAPE_PRODUCT__ === 'framescaper';

export interface PlatformCapabilityProbe {
	readonly scope?: PlatformCapabilityScope;
	readonly adapters?: PlatformAdapterProbe;
}

export interface PlatformCapabilities {
	readonly schemaVersion: 1;
	readonly runtime: PlatformRuntime;
	readonly apis: {
		readonly storage: {
			readonly indexedDb: boolean;
			readonly storageEstimate: boolean;
			readonly persistentStorage: boolean;
			readonly opfs: boolean;
			readonly opfsSyncAccess: boolean;
		};
		readonly fileSystem: {
			readonly browserDownload: boolean;
			readonly openFilePicker: boolean;
			readonly saveFilePicker: boolean;
			readonly directoryPicker: boolean;
		};
		readonly media: {
			readonly browserMediaElements: boolean;
			readonly canvas2d: boolean;
			readonly webGl2: boolean;
			readonly mediaSource: boolean;
			readonly webCodecsAudioDecode: boolean;
			readonly webCodecsVideoDecode: boolean;
			readonly webCodecsAudioEncode: boolean;
			readonly webCodecsVideoEncode: boolean;
		};
		readonly audio: {
			readonly audioContext: boolean;
			readonly offlineAudioContext: boolean;
			readonly audioWorklet: boolean;
			readonly outputDeviceSelection: boolean;
		};
		readonly execution: {
			readonly dedicatedWorker: boolean;
			readonly webAssembly: boolean;
		};
	};
	readonly adapters: {
		readonly storage: {
			readonly projectStoreReady: boolean;
			readonly backend: PlatformStorageBackend | null;
			readonly opfsSourceStorageReady: boolean;
		};
		readonly media: {
			readonly videoFrameExtractionReady: boolean;
			readonly ffmpegReady: boolean;
			readonly webCodecsReady: boolean;
		};
		readonly audio: {
			readonly engineReady: boolean;
		};
		readonly desktop: {
			readonly bridgeDetected: boolean;
			readonly bridgeReady: boolean;
			readonly environmentReady: boolean;
			readonly scopedFileReadsReady: boolean;
			readonly atomicChunkedWritesReady: boolean;
			readonly lifecycleReady: boolean;
		};
	};
	readonly tiers: {
		readonly webCore: PlatformTierStatus;
		readonly webEnhanced: PlatformTierStatus;
		readonly electronEnhanced: PlatformTierStatus;
		readonly electronOnly: PlatformTierStatus;
	};
}

/**
 * Build an immutable snapshot from the current runtime and affirmative adapter
 * probes. Support is never inferred from browser or Electron user-agent text.
 */
export function createPlatformCapabilitiesSnapshot(
	probe: PlatformCapabilityProbe = {},
): PlatformCapabilities {
	const scope = probe.scope ?? globalThis as unknown as PlatformCapabilityScope;
	const storageManager = property(scope.navigator, 'storage');
	const audioContext = scope.AudioContext ?? scope.webkitAudioContext;
	const offlineAudioContext = scope.OfflineAudioContext ?? scope.webkitOfflineAudioContext;
	const mediaElementPrototype = property(scope.HTMLMediaElement, 'prototype');
	const audioContextPrototype = property(audioContext, 'prototype');
	const desktopBridge = resolveDesktopBridge(scope);

	const browserDownload = isFunction(scope.Blob)
		&& hasMethod(scope.document, 'createElement')
		&& hasMethod(scope.URL, 'createObjectURL');
	const browserMediaElements = browserDownload && isFunction(scope.HTMLMediaElement);
	const canvas2d = isFunction(scope.CanvasRenderingContext2D);
	const audioContextAvailable = isFunction(audioContext);
	const offlineAudioContextAvailable = isFunction(offlineAudioContext);
	const webCodecs = {
		audioDecode: isFunction(scope.AudioDecoder),
		videoDecode: isFunction(scope.VideoDecoder),
		audioEncode: isFunction(scope.AudioEncoder),
		videoEncode: isFunction(scope.VideoEncoder),
	};

	const apis: PlatformCapabilities['apis'] = {
		storage: {
			indexedDb: hasMethod(scope.indexedDB, 'open'),
			storageEstimate: hasMethod(storageManager, 'estimate'),
			persistentStorage: hasMethod(storageManager, 'persist')
				&& hasMethod(storageManager, 'persisted'),
			opfs: hasMethod(storageManager, 'getDirectory'),
			opfsSyncAccess: hasMethod(storageManager, 'getDirectory')
				&& hasMethod(property(scope.FileSystemFileHandle, 'prototype'), 'createSyncAccessHandle'),
		},
		fileSystem: {
			browserDownload,
			openFilePicker: isFunction(scope.showOpenFilePicker),
			saveFilePicker: isFunction(scope.showSaveFilePicker),
			directoryPicker: isFunction(scope.showDirectoryPicker),
		},
		media: {
			browserMediaElements,
			canvas2d,
			webGl2: isFunction(scope.WebGL2RenderingContext),
			mediaSource: isFunction(scope.MediaSource),
			webCodecsAudioDecode: webCodecs.audioDecode,
			webCodecsVideoDecode: webCodecs.videoDecode,
			webCodecsAudioEncode: webCodecs.audioEncode,
			webCodecsVideoEncode: webCodecs.videoEncode,
		},
		audio: {
			audioContext: audioContextAvailable,
			offlineAudioContext: offlineAudioContextAvailable,
			audioWorklet: audioContextAvailable && isFunction(scope.AudioWorkletNode),
			outputDeviceSelection: hasMethod(audioContextPrototype, 'setSinkId')
				|| hasMethod(mediaElementPrototype, 'setSinkId'),
		},
		execution: {
			dedicatedWorker: isFunction(scope.Worker),
			webAssembly: hasMethod(scope.WebAssembly, 'instantiate'),
		},
	};

	const adapterProbe = probe.adapters ?? {};
	const requestedStore = normalizeProjectStoreProbe(adapterProbe.projectStore);
	const projectStoreReady = requestedStore !== null
		&& (requestedStore.backend === 'memory' || apis.storage.indexedDb);
	const backend = projectStoreReady ? requestedStore.backend : null;
	const opfsSourceStorageReady = projectStoreReady
		&& Boolean(requestedStore.opfsSourceStorageReady)
		&& apis.storage.opfs;
	const videoFrameExtractionReady = adapterProbe.videoFrameExtractionReady === true
		&& apis.media.browserMediaElements
		&& apis.media.canvas2d;
	const ffmpegReady = adapterProbe.ffmpegReady === true
		&& apis.execution.dedicatedWorker
		&& apis.execution.webAssembly;
	const webCodecsReady = adapterProbe.webCodecsReady === true
		&& Object.values(webCodecs).every(Boolean);
	const audioEngineReady = adapterProbe.audioEngineReady === true
		&& apis.audio.audioContext;

	const desktop = detectDesktopAdapter(desktopBridge);
	const adapters: PlatformCapabilities['adapters'] = {
		storage: {
			projectStoreReady,
			backend,
			opfsSourceStorageReady,
		},
		media: {
			videoFrameExtractionReady,
			ffmpegReady,
			webCodecsReady,
		},
		audio: { engineReady: audioEngineReady },
		desktop,
	};

	const coreApis = [
		apis.storage.indexedDb,
		apis.fileSystem.browserDownload,
		apis.media.browserMediaElements,
		apis.media.canvas2d,
		apis.media.webGl2,
		apis.audio.audioContext,
		apis.audio.offlineAudioContext,
		apis.audio.audioWorklet,
		apis.execution.dedicatedWorker,
		apis.execution.webAssembly,
	];
	const coreAdapters = [
		adapters.storage.projectStoreReady,
		adapters.media.videoFrameExtractionReady,
		adapters.media.ffmpegReady,
		adapters.audio.engineReady,
	];
	const enhancedApis = [
		apis.storage.opfs,
		apis.storage.opfsSyncAccess,
		apis.fileSystem.openFilePicker,
		apis.fileSystem.saveFilePicker,
		apis.fileSystem.directoryPicker,
		apis.media.webCodecsAudioDecode,
		apis.media.webCodecsVideoDecode,
		apis.media.webCodecsAudioEncode,
		apis.media.webCodecsVideoEncode,
	];
	const enhancedAdapters = [
		adapters.storage.opfsSourceStorageReady,
		adapters.media.webCodecsReady,
	];
	const tiers: PlatformCapabilities['tiers'] = {
		webCore: supportStatus([...coreApis, ...coreAdapters]),
		webEnhanced: supportStatus([...enhancedApis, ...enhancedAdapters]),
		electronEnhanced: desktop.bridgeReady
			? 'available'
			: desktop.bridgeDetected ? 'partial' : 'unavailable',
		electronOnly: 'unavailable',
	};

	return deepFreeze({
		schemaVersion: 1,
		runtime: desktop.bridgeDetected ? 'electron' : 'web',
		apis,
		adapters,
		tiers,
	});
}

type UnknownRecord = Readonly<Record<string, unknown>>;

function asRecord(value: unknown): UnknownRecord | null {
	if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return null;
	return value as UnknownRecord;
}

function property(value: unknown, key: string): unknown {
	return asRecord(value)?.[key];
}

function isFunction(value: unknown): boolean {
	return typeof value === 'function';
}

function hasMethod(value: unknown, key: string): boolean {
	return isFunction(property(value, key));
}

function resolveDesktopBridge(scope: PlatformCapabilityScope): UnknownRecord | null {
	const windowScope = asRecord(scope.window);
	const candidates = [
		scope.scapeDesktop,
		scope.soundscaperDesktop,
		windowScope?.scapeDesktop,
		windowScope?.soundscaperDesktop,
		...(FRAMESCAPER_DESKTOP_BRIDGE_ENABLED ? [
			scope.framescaperDesktop,
			windowScope?.framescaperDesktop,
		] : []),
	];
	for (const candidate of candidates) {
		const bridge = asRecord(property(candidate, 'v1'));
		if (bridge?.version === 1) return bridge;
	}
	return null;
}

function detectDesktopAdapter(
	bridge: UnknownRecord | null,
): PlatformCapabilities['adapters']['desktop'] {
	const bridgeDetected = bridge !== null;
	const environmentReady = hasMethod(bridge, 'getEnvironment');
	const scopedFileReadsReady = hasMethods(bridge, ['chooseFiles', 'releaseRead']);
	const atomicChunkedWritesReady = hasMethods(bridge, [
		'chooseSaveTarget',
		'beginWrite',
		'writeChunk',
		'finishWrite',
		'abortWrite',
	]);
	const lifecycleReady = hasMethods(bridge, [
		'signalReady',
		'onCloseRequested',
		'respondToClose',
	]);
	return {
		bridgeDetected,
		bridgeReady: bridgeDetected
			&& environmentReady
			&& scopedFileReadsReady
			&& atomicChunkedWritesReady
			&& lifecycleReady,
		environmentReady,
		scopedFileReadsReady,
		atomicChunkedWritesReady,
		lifecycleReady,
	};
}

function hasMethods(value: unknown, methods: readonly string[]): boolean {
	return methods.every((method) => hasMethod(value, method));
}

function normalizeProjectStoreProbe(
	probe: PlatformProjectStoreProbe | undefined,
): PlatformProjectStoreProbe | null {
	if (probe?.ready !== true) return null;
	if (probe.backend !== 'indexeddb' && probe.backend !== 'memory') return null;
	return probe;
}

function supportStatus(evidence: readonly boolean[]): PlatformTierStatus {
	const supported = evidence.filter(Boolean).length;
	if (supported === 0) return 'unavailable';
	return supported === evidence.length ? 'available' : 'partial';
}

function deepFreeze<Value>(value: Value, seen = new WeakSet<object>()): Value {
	if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return value;
	const object = value as object;
	if (seen.has(object)) return value;
	seen.add(object);
	for (const child of Object.values(object)) deepFreeze(child, seen);
	return Object.freeze(value);
}
