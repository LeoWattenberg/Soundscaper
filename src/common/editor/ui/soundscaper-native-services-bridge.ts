/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The renderer's whole view of the milestone-5A native tier.
 *
 * Everything the surfaces know arrives through the preload bridge, which
 * reports status and never mechanism, so this module holds no path, no library
 * name and no binary identity beyond the digests the quarantine is keyed by.
 * A build without the bridge resolves to nothing and the tier stays invisible
 * rather than advertising itself as a permanently grey menu.
 */

import { resolveAudioEditorDesktopBridge } from '../file-service.js';

import type { SoundscaperNativeServicesSnapshot } from './soundscaper-native-services-menu.ts';

export interface NativeAudioAvailability {
	readonly enabled: boolean;
	readonly quarantined: boolean;
	readonly payload: Readonly<{ status: string; reason: string | null; detail: string }>;
	readonly backends: readonly string[];
}

export interface NativeAudioInventory {
	readonly backend: string;
	readonly status: string;
	readonly detail: string;
	readonly devices: readonly Readonly<{ handle: string; label: string; direction: string }>[];
}

export type NativeAudioInventoryOutcome =
	| Readonly<{ status: 'described'; inventory: NativeAudioInventory }>
	| Readonly<{ status: 'failed'; code: string; message: string }>;

export interface NativePluginRootView {
	readonly rootId: string;
	readonly origin: string;
	readonly name: string;
	readonly admitted: boolean;
}

export interface NativePluginFormatConsentView {
	readonly format: string;
	readonly supported: boolean;
	readonly granted: boolean;
	readonly roots: readonly NativePluginRootView[];
}

export interface NativePluginConsentView {
	readonly scanningEnabled: boolean;
	readonly formats: readonly NativePluginFormatConsentView[];
}

export interface NativePluginQuarantineRecord {
	readonly digest: string;
	readonly scope: string;
	readonly kind: string;
	readonly quarantinedAt: number;
}

export interface NativePluginQuarantineSnapshot {
	readonly loaded: boolean;
	readonly degraded: boolean;
	readonly records: readonly NativePluginQuarantineRecord[];
	readonly pendingFaults: number;
}

export interface NativePluginAvailability {
	readonly enabled: boolean;
	readonly quarantined: boolean;
	readonly payload: Readonly<{ status: string; reason: string | null }>;
	readonly formats: readonly Readonly<{ format: string; consented: boolean }>[];
	readonly consent: NativePluginConsentView;
	readonly quarantine: NativePluginQuarantineSnapshot;
}

export interface NativePluginScanEntry {
	readonly stableId: string;
	readonly name: string;
	readonly vendor: string;
	readonly version: string;
	readonly classification: string;
	readonly signature: string;
	readonly compatibility: string;
}

export type NativePluginScanOutcome =
	| Readonly<{
		status: 'described';
		scan: Readonly<{
			format: string;
			status: string;
			detail: string;
			entries: readonly NativePluginScanEntry[];
		}>;
	}>
	| Readonly<{ status: 'failed'; code: string; message: string }>;

export interface NativePluginInstallationView {
	readonly installationId: string;
	readonly version: string;
	readonly reviewed: boolean;
	readonly selected: boolean;
	readonly quarantined: boolean;
}

export interface NativePluginEntryView {
	readonly entryId: string;
	readonly format: string;
	readonly name: string;
	readonly vendor: string;
	readonly eligible: boolean;
	readonly ineligibleReason: string | null;
	readonly installations: readonly NativePluginInstallationView[];
}

export interface NativePluginRegistryView {
	readonly entries: readonly NativePluginEntryView[];
}

export type NativePluginConsentAction = 'grant' | 'revoke' | 'add-standard-root' | 'add-custom-root';

/** The quarantine's only exit, named by the clearance the store accepts. */
export type NativePluginQuarantineClearance = 'rescan' | 're-enable';

export interface SoundscaperNativeServicesBridge {
	nativeAudioHelperAvailability(): Promise<NativeAudioAvailability>;
	setNativeAudioHelperEnabled(enabled: boolean): Promise<boolean>;
	describeNativeAudioBackend(request: Readonly<{ backend: string }>): Promise<NativeAudioInventoryOutcome>;
	nativePluginAvailability(): Promise<NativePluginAvailability>;
	setNativePluginConsent(request: Readonly<{
		format: string; action: NativePluginConsentAction; rootId?: string;
	}>): Promise<unknown>;
	scanNativePlugins(request: Readonly<{ format: string; rootId: string }>): Promise<NativePluginScanOutcome>;
	listNativePlugins(): Promise<NativePluginRegistryView>;
	clearNativePluginQuarantine?(request: Readonly<{
		digest: string; clearance: NativePluginQuarantineClearance;
	}>): Promise<unknown>;
}

const REQUIRED_BRIDGE_METHODS: readonly (keyof SoundscaperNativeServicesBridge)[] = Object.freeze([
	'nativeAudioHelperAvailability',
	'setNativeAudioHelperEnabled',
	'describeNativeAudioBackend',
	'nativePluginAvailability',
	'setNativePluginConsent',
	'scanNativePlugins',
	'listNativePlugins',
]);

/**
 * A bridge that is missing any of the tier's calls is not a partial tier, it is
 * an older desktop shell; refusing it wholesale keeps a surface from opening
 * onto a method that is not there.
 */
export function resolveSoundscaperNativeServicesBridge(
	scope: unknown = globalThis,
): SoundscaperNativeServicesBridge | null {
	const bridge = resolveAudioEditorDesktopBridge(scope as typeof globalThis) as Record<string, unknown> | null;
	if (!bridge) return null;
	return REQUIRED_BRIDGE_METHODS.every((method) => typeof bridge[method] === 'function')
		? bridge as unknown as SoundscaperNativeServicesBridge
		: null;
}

/**
 * Native audio and native effects are two switches over one payload, so the
 * menu's single snapshot reads each from the answer that owns it: the audio
 * tier reports whether it is on, and a format counts as enabled only when
 * discovery is on *and* the user consented to that format.
 */
export function resolveSoundscaperNativeServicesSnapshot(
	audio: NativeAudioAvailability,
	plugins: NativePluginAvailability | null,
): SoundscaperNativeServicesSnapshot {
	return Object.freeze({
		enabled: audio.enabled === true,
		quarantined: audio.quarantined === true || plugins?.quarantined === true,
		payloadAvailable: audio.payload?.status === 'available',
		payloadDetail: typeof audio.payload?.detail === 'string' ? audio.payload.detail : '',
		usableAudioBackends: Object.freeze((audio.backends ?? []).filter((backend) => typeof backend === 'string')),
		enabledPluginFormats: Object.freeze(plugins?.enabled === true
			? (plugins.formats ?? []).filter((entry) => entry.consented === true).map((entry) => entry.format)
			: []),
	});
}

/**
 * How long an answer is trusted before the tier is asked again. Both switches
 * live in the desktop Tools menu, so they change without the renderer being
 * told; a menu that never re-read them would go stale the moment a user turned
 * the tier on and would look exactly like a broken feature.
 */
export const SOUNDSCAPER_NATIVE_SERVICES_REFRESH_INTERVAL_MS = 5_000;

export interface SoundscaperNativeServicesStore {
	getSnapshot(): SoundscaperNativeServicesSnapshot | null;
	subscribe(listener: () => void): () => void;
	refresh(): Promise<SoundscaperNativeServicesSnapshot | null>;
	/** Re-probes when the last answer is older than the refresh interval. */
	refreshIfStale(now?: number): void;
}

export function createSoundscaperNativeServicesStore(
	bridge: SoundscaperNativeServicesBridge,
	clock: () => number = () => Date.now(),
): SoundscaperNativeServicesStore {
	let snapshot: SoundscaperNativeServicesSnapshot | null = null;
	let probedAt = Number.NEGATIVE_INFINITY;
	let inFlight: Promise<SoundscaperNativeServicesSnapshot | null> | null = null;
	let requestedGeneration = 0;
	let publishedGeneration = 0;
	const listeners = new Set<() => void>();
	const refresh = async (): Promise<SoundscaperNativeServicesSnapshot | null> => {
		const generation = ++requestedGeneration;
		const [audio, plugins] = await Promise.all([
			bridge.nativeAudioHelperAvailability(),
			// A plug-in answer that fails leaves the audio tier legible rather
			// than hiding both halves behind one failure.
			bridge.nativePluginAvailability().catch(() => null),
		]);
		const next = resolveSoundscaperNativeServicesSnapshot(audio, plugins);
		if (generation < publishedGeneration) return snapshot;
		publishedGeneration = generation;
		probedAt = clock();
		// Identity is kept while nothing changed, so a menu rebuilt every render
		// keeps comparing equal instead of churning on an unchanging tier.
		if (snapshot === null || !sameSnapshot(snapshot, next)) {
			snapshot = next;
			for (const listener of listeners) listener();
		}
		return snapshot;
	};
	return Object.freeze({
		getSnapshot: () => snapshot,
		subscribe: (listener: () => void) => {
			listeners.add(listener);
			return () => { listeners.delete(listener); };
		},
		refresh,
		refreshIfStale: (now: number = clock()) => {
			if (inFlight !== null || now - probedAt < SOUNDSCAPER_NATIVE_SERVICES_REFRESH_INTERVAL_MS) return;
			inFlight = refresh().catch(() => null).finally(() => { inFlight = null; });
		},
	});
}

const STORES = new WeakMap<SoundscaperNativeServicesBridge, SoundscaperNativeServicesStore>();

/** One store per bridge, probing as soon as the first surface asks for it. */
export function soundscaperNativeServicesStoreFor(
	bridge: SoundscaperNativeServicesBridge,
): SoundscaperNativeServicesStore {
	const existing = STORES.get(bridge);
	if (existing) return existing;
	const store = createSoundscaperNativeServicesStore(bridge);
	STORES.set(bridge, store);
	store.refreshIfStale();
	return store;
}

function sameSnapshot(
	current: SoundscaperNativeServicesSnapshot,
	next: SoundscaperNativeServicesSnapshot,
): boolean {
	return current.enabled === next.enabled
		&& current.quarantined === next.quarantined
		&& current.payloadAvailable === next.payloadAvailable
		&& current.payloadDetail === next.payloadDetail
		&& sameList(current.usableAudioBackends, next.usableAudioBackends)
		&& sameList(current.enabledPluginFormats, next.enabledPluginFormats);
}

function sameList(current: readonly string[], next: readonly string[]): boolean {
	return current.length === next.length && current.every((value, index) => value === next[index]);
}
