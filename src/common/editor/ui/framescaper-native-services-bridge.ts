/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The renderer's pathless view of Framescaper native services.
 *
 * The required bridge is the small V1 main/preload contract. Newer controls
 * are optional and remain fail-closed until main exposes their authenticated
 * ports. No path, executable name, plug-in binary, or scratch identity crosses
 * this boundary.
 */

import {
	assertNativeMediaRelativeDestination,
} from '../native-media-atomic-publication.ts';
import {
	assertNativeMediaCapabilitySnapshotV1,
	type NativeMediaCapabilitySnapshotV1,
} from '../native-media-capability-snapshot.ts';
import {
	NATIVE_QUEUE_STATES,
	NATIVE_QUEUE_TASK_KINDS,
	type NativeQueueState,
	type NativeQueueTaskKind,
} from '../native-queue-record.ts';
import type { ExternalDisplayDescriptorV1 } from '../native-external-display.ts';
import type { FramescaperNativeImageSequenceBridge } from './framescaper-native-image-sequence-bridge.ts';
import type { FramescaperNativeOpenFxBridge } from './framescaper-native-openfx-bridge.ts';
import {
	FRAMESCAPER_NATIVE_SERVICES_LIFECYCLE_METHODS,
	createFramescaperNativeServicesLifecycleStore,
	type FramescaperNativeRootProjection,
	type FramescaperNativeServicesLifecycleBridge,
	type FramescaperNativeServicesLifecycleStore,
	type FramescaperNativeWatchProjection,
} from './framescaper-native-services-lifecycle-bridge.ts';

export type {
	FramescaperNativeQueueEnqueueRendererRequest,
	FramescaperNativeRootProjection,
	FramescaperNativeWatchCreateRendererRequest,
	FramescaperNativeWatchProjection,
} from './framescaper-native-services-lifecycle-bridge.ts';

export const FRAMESCAPER_NATIVE_SERVICES_RENDERER_REFRESH_INTERVAL_MS = 5_000;
export const FRAMESCAPER_NATIVE_SERVICE_PREFERENCES = Object.freeze([
	'native-media',
	'hardware-decode',
	'hardware-encode',
	'ofx-consent',
] as const);

export type FramescaperNativeServicePreference =
	(typeof FRAMESCAPER_NATIVE_SERVICE_PREFERENCES)[number];

export interface FramescaperNativeServicePreferences {
	readonly nativeMediaEnabled: boolean;
	readonly hardwareDecodeEnabled: boolean;
	readonly hardwareEncodeEnabled: boolean;
	readonly ofxConsentEnabled: boolean;
}

export const DEFAULT_FRAMESCAPER_NATIVE_SERVICE_PREFERENCES:
	FramescaperNativeServicePreferences = Object.freeze({
		nativeMediaEnabled: false,
		hardwareDecodeEnabled: false,
		hardwareEncodeEnabled: false,
		ofxConsentEnabled: false,
	});

export interface FramescaperNativeQueueProjection {
	readonly jobId: string;
	readonly taskKind: NativeQueueTaskKind;
	readonly projectId: string;
	readonly relativeDestination: string;
	readonly state: NativeQueueState;
	readonly position: number;
	readonly progress: number | null;
	readonly attempt: number;
	readonly lastFailureCode: string | null;
}

export interface FramescaperNativeServicesProjection {
	readonly snapshotVersion: 1;
	readonly runtimeAvailable: boolean;
	readonly nativeMediaEnabled: boolean;
	readonly queue: readonly FramescaperNativeQueueProjection[];
	readonly roots: readonly FramescaperNativeRootProjection[];
	readonly watchRules: readonly FramescaperNativeWatchProjection[];
}

export type FramescaperNativeQueueRendererAction = 'pause' | 'resume' | 'cancel' | 'retry';

export interface FramescaperNativeServicesExternalDisplayProjection {
	readonly displays: readonly ExternalDisplayDescriptorV1[];
	readonly activeDisplayId: string | null;
}

export interface FramescaperNativeWatchImportClaim {
	readonly claimId: string;
	readonly projectId: string;
	readonly projectRevision: number;
	readonly importMode: 'link' | 'copy';
	readonly locatorId: string;
	readonly locatorRevision: string;
	readonly name: string;
	readonly size: number;
	readonly mimeType: string;
	readonly lastModified: number;
	readonly contentSha256: string;
}

export interface FramescaperNativeServicesBridge
	extends FramescaperNativeServicesLifecycleBridge, FramescaperNativeImageSequenceBridge, FramescaperNativeOpenFxBridge {
	snapshot(): Promise<FramescaperNativeServicesProjection>;
	control(request: Readonly<{
		readonly jobId: string;
		readonly action: FramescaperNativeQueueRendererAction;
	}>): Promise<FramescaperNativeQueueProjection>;
	reorder(request: Readonly<{
		readonly jobId: string;
		readonly index: number;
	}>): Promise<readonly FramescaperNativeQueueProjection[]>;
	remove(request: Readonly<{ readonly jobId: string }>): Promise<boolean>;
	/** Optional authenticated extensions. Absence means unavailable, never on. */
	capabilities?(): Promise<NativeMediaCapabilitySnapshotV1>;
	preferences?(): Promise<FramescaperNativeServicePreferences>;
	setPreference?(request: Readonly<{
		readonly preference: FramescaperNativeServicePreference;
		readonly enabled: boolean;
	}>): Promise<boolean>;
	externalDisplays?(): Promise<FramescaperNativeServicesExternalDisplayProjection>;
	setExternalDisplay?(request: Readonly<{
		readonly displayId: string | null;
	}>): Promise<FramescaperNativeServicesExternalDisplayProjection>;
	presentExternalDisplay?(request: Readonly<{
		readonly sequence: number;
		readonly evaluationFingerprint: string;
		readonly width: number;
		readonly height: number;
		readonly dynamicRange: 'sdr' | 'hdr';
		readonly rgbaSha256: string;
		readonly rgba: Uint8Array;
	}>): Promise<FramescaperNativeServicesExternalDisplayProjection>;
	claimWatchImport?(request: Readonly<{
		readonly projectId: string;
		readonly projectRevision: number;
	}>): Promise<FramescaperNativeWatchImportClaim | null>;
	completeWatchImport?(request: Readonly<{
		readonly claimId: string;
		readonly projectId: string;
		readonly expectedProjectRevision: number;
		readonly committedProjectRevision: number;
		readonly success: boolean;
	}>): Promise<boolean>;
}

export interface FramescaperNativeServicesRendererSnapshot {
	readonly services: FramescaperNativeServicesProjection;
	readonly capabilitySnapshot: NativeMediaCapabilitySnapshotV1 | null;
	readonly preferences: FramescaperNativeServicePreferences;
	readonly controllablePreferences: readonly FramescaperNativeServicePreference[];
	readonly externalDisplays: readonly ExternalDisplayDescriptorV1[];
	readonly activeExternalDisplayId: string | null;
}

export interface FramescaperNativeServicesStore
	extends FramescaperNativeServicesLifecycleStore<FramescaperNativeServicesRendererSnapshot> {
	getSnapshot(): FramescaperNativeServicesRendererSnapshot | null;
	subscribe(listener: () => void): () => void;
	refresh(): Promise<FramescaperNativeServicesRendererSnapshot>;
	refreshIfStale(now?: number): void;
	control(request: Readonly<{
		readonly jobId: string;
		readonly action: FramescaperNativeQueueRendererAction;
	}>): Promise<FramescaperNativeServicesRendererSnapshot>;
	reorder(request: Readonly<{
		readonly jobId: string;
		readonly index: number;
	}>): Promise<FramescaperNativeServicesRendererSnapshot>;
	remove(request: Readonly<{ readonly jobId: string }>): Promise<FramescaperNativeServicesRendererSnapshot>;
	setPreference(request: Readonly<{
		readonly preference: FramescaperNativeServicePreference;
		readonly enabled: boolean;
	}>): Promise<FramescaperNativeServicesRendererSnapshot>;
	setExternalDisplay(displayId: string | null): Promise<FramescaperNativeServicesRendererSnapshot>;
}

const REQUIRED_METHODS = Object.freeze(['snapshot', 'control', 'reorder', 'remove'] as const);
const OPTIONAL_METHODS = Object.freeze([
	'capabilities', 'preferences', 'setPreference', 'externalDisplays', 'setExternalDisplay',
	'presentExternalDisplay', 'abandonRenderInputs',
		'claimWatchImport', 'completeWatchImport',
		'selectImageSequence', 'readImageSequenceFile', 'releaseImageSequence',
		'scanOpenFxPlugin', 'listOpenFxPlugins', 'controlOpenFxPlugin',
	...FRAMESCAPER_NATIVE_SERVICES_LIFECYCLE_METHODS,
] as const);

export function resolveFramescaperNativeServicesBridge(
	scope: unknown = globalThis,
): FramescaperNativeServicesBridge | null {
	const root = recordOrNull(scope);
	const windowValue = recordOrNull(root?.window);
	const desktop = recordOrNull(windowValue?.framescaperDesktop)
		?? recordOrNull(root?.framescaperDesktop);
	const v1 = recordOrNull(desktop?.v1);
	const bridge = recordOrNull(v1?.nativeServices);
	if (!bridge) return null;
	if (REQUIRED_METHODS.some((method) => typeof bridge[method] !== 'function')) return null;
	if (OPTIONAL_METHODS.some((method) => (
		bridge[method] !== undefined && typeof bridge[method] !== 'function'
	))) return null;
	return bridge as unknown as FramescaperNativeServicesBridge;
}

export function createFramescaperNativeServicesStore(
	bridge: FramescaperNativeServicesBridge,
	clock: () => number = () => Date.now(),
): FramescaperNativeServicesStore {
	let snapshot: FramescaperNativeServicesRendererSnapshot | null = null;
	let refreshedAt = Number.NEGATIVE_INFINITY;
	let inFlight: Promise<FramescaperNativeServicesRendererSnapshot> | null = null;
	const listeners = new Set<() => void>();
	const refresh = async (): Promise<FramescaperNativeServicesRendererSnapshot> => {
		const [servicesValue, capabilityValue, preferencesValue, displaysValue] = await Promise.all([
			bridge.snapshot(),
			bridge.capabilities?.().catch(() => null) ?? Promise.resolve(null),
			bridge.preferences?.().catch(() => null) ?? Promise.resolve(null),
			bridge.externalDisplays?.().catch(() => null) ?? Promise.resolve(null),
		]);
		const services = normalizeServicesSnapshot(servicesValue);
		const capabilitySnapshot = normalizeCapabilitySnapshot(capabilityValue);
		const preferences = preferencesValue === null
			? Object.freeze({
				...DEFAULT_FRAMESCAPER_NATIVE_SERVICE_PREFERENCES,
				nativeMediaEnabled: services.nativeMediaEnabled,
			})
			: normalizePreferences(preferencesValue);
		const displays = normalizeExternalDisplays(displaysValue);
		const next: FramescaperNativeServicesRendererSnapshot = Object.freeze({
			services,
			capabilitySnapshot,
			preferences,
			controllablePreferences: bridge.setPreference
				? FRAMESCAPER_NATIVE_SERVICE_PREFERENCES
				: Object.freeze([]),
			externalDisplays: displays.displays,
			activeExternalDisplayId: displays.activeDisplayId,
		});
		snapshot = next;
		refreshedAt = clock();
		for (const listener of listeners) listener();
		return next;
	};
	const refreshAfter = async (operation: () => Promise<unknown>) => {
		await operation();
		return refresh();
	};
	const lifecycle = createFramescaperNativeServicesLifecycleStore(bridge, refreshAfter);
	return Object.freeze({
		...lifecycle,
		getSnapshot: () => snapshot,
		subscribe: (listener: () => void) => {
			listeners.add(listener);
			return () => { listeners.delete(listener); };
		},
		refresh,
		refreshIfStale: (now: number = clock()) => {
			if (inFlight !== null
				|| now - refreshedAt < FRAMESCAPER_NATIVE_SERVICES_RENDERER_REFRESH_INTERVAL_MS) return;
			inFlight = refresh().finally(() => { inFlight = null; });
			void inFlight.catch(() => null);
		},
		control: (value: Readonly<{
			jobId: string; action: FramescaperNativeQueueRendererAction;
		}>) => {
			const request = controlRequest(value);
			return refreshAfter(async () => {
				normalizeQueueProjection(await bridge.control(request));
			});
		},
		reorder: (value: Readonly<{ jobId: string; index: number }>) => {
			const request = reorderRequest(value);
			return refreshAfter(async () => {
				const queue = await bridge.reorder(request);
				if (!Array.isArray(queue) || queue.length > 100_000) {
					throw new TypeError('Framescaper native queue reorder returned an invalid queue.');
				}
				queue.forEach(normalizeQueueProjection);
			});
		},
		remove: (value: Readonly<{ jobId: string }>) => {
			const request = removeRequest(value);
			return refreshAfter(async () => {
				if (await bridge.remove(request) !== true) {
					throw new Error('The Framescaper native queue row was not removed.');
				}
			});
		},
		setPreference: (value: Readonly<{
			preference: FramescaperNativeServicePreference; enabled: boolean;
		}>) => {
			const request = preferenceRequest(value);
			const setter = bridge.setPreference;
			if (!setter) {
				return Promise.reject(new Error(
					'This desktop build cannot change Framescaper native-service preferences.',
				));
			}
			return refreshAfter(async () => {
				if (typeof await setter.call(bridge, request) !== 'boolean') {
					throw new TypeError('The Framescaper native-service preference acknowledgement is invalid.');
				}
			});
		},
		setExternalDisplay: (displayId: string | null) => {
			const setter = bridge.setExternalDisplay;
			if (!setter) {
				return Promise.reject(new Error('This desktop build cannot open an external display.'));
			}
			const request = Object.freeze({ displayId: optionalDisplayId(displayId) });
			return refreshAfter(async () => {
				normalizeExternalDisplays(await setter.call(bridge, request));
			});
		},
	});
}

const STORES = new WeakMap<FramescaperNativeServicesBridge, FramescaperNativeServicesStore>();

export function framescaperNativeServicesStoreFor(
	bridge: FramescaperNativeServicesBridge,
): FramescaperNativeServicesStore {
	const existing = STORES.get(bridge);
	if (existing) return existing;
	const store = createFramescaperNativeServicesStore(bridge);
	STORES.set(bridge, store);
	store.refreshIfStale();
	return store;
}

function normalizeServicesSnapshot(value: unknown): FramescaperNativeServicesProjection {
	const row = closedRecord(value, [
		'snapshotVersion', 'runtimeAvailable', 'nativeMediaEnabled', 'queue', 'roots', 'watchRules',
	], 'Framescaper native-services snapshot');
	if (row.snapshotVersion !== 1 || typeof row.runtimeAvailable !== 'boolean'
		|| typeof row.nativeMediaEnabled !== 'boolean') {
		throw new TypeError('A Framescaper native-services snapshot has invalid availability state.');
	}
	return Object.freeze({
		snapshotVersion: 1,
		runtimeAvailable: row.runtimeAvailable,
		nativeMediaEnabled: row.nativeMediaEnabled,
		queue: boundedArray(row.queue, 100_000, 'queue').map(normalizeQueueProjection),
		roots: boundedArray(row.roots, 1_024, 'roots').map(normalizeRootProjection),
		watchRules: boundedArray(row.watchRules, 1_024, 'watch rules').map(normalizeWatchProjection),
	});
}

function normalizeQueueProjection(value: unknown): FramescaperNativeQueueProjection {
	const row = closedRecord(value, [
		'jobId', 'taskKind', 'projectId', 'relativeDestination', 'state', 'position',
		'progress', 'attempt', 'lastFailureCode',
	], 'Framescaper native queue row');
	const jobId = exactJobId(row.jobId);
	const taskKind = member(row.taskKind, NATIVE_QUEUE_TASK_KINDS, 'queue task kind');
	const state = member(row.state, NATIVE_QUEUE_STATES, 'queue state');
	const projectId = boundedText(row.projectId, 'project id');
	assertNativeMediaRelativeDestination(row.relativeDestination);
	const position = nonNegativeInteger(row.position, 'position');
	const attempt = nonNegativeInteger(row.attempt, 'attempt');
	if (row.progress !== null && (typeof row.progress !== 'number'
		|| !Number.isFinite(row.progress) || row.progress < 0 || row.progress > 1)) {
		throw new TypeError('A Framescaper native queue progress value is invalid.');
	}
	const failure = row.lastFailureCode === null ? null : boundedText(row.lastFailureCode, 'failure code');
	return Object.freeze({
		jobId, taskKind, projectId,
		relativeDestination: row.relativeDestination as string,
		state, position, progress: row.progress as number | null,
		attempt, lastFailureCode: failure,
	});
}

function normalizeRootProjection(value: unknown): FramescaperNativeRootProjection {
	const row = closedRecord(value, ['grantId', 'displayName', 'revoked'], 'Framescaper native root');
	if (typeof row.revoked !== 'boolean') throw new TypeError('A Framescaper native root has invalid state.');
	return Object.freeze({
		grantId: exactOpaqueId(row.grantId, 'root grant id'),
		displayName: boundedText(row.displayName, 'root display name'),
		revoked: row.revoked,
	});
}

function normalizeWatchProjection(value: unknown): FramescaperNativeWatchProjection {
	const row = closedRecord(value, [
		'ruleId', 'grantId', 'projectId', 'extensions', 'importMode', 'generateProxies', 'enabled',
	], 'Framescaper native watch rule');
	if ((row.importMode !== 'link' && row.importMode !== 'copy')
		|| typeof row.generateProxies !== 'boolean' || typeof row.enabled !== 'boolean') {
		throw new TypeError('A Framescaper native watch rule has invalid state.');
	}
	return Object.freeze({
		ruleId: exactOpaqueId(row.ruleId, 'watch rule id'),
		grantId: exactOpaqueId(row.grantId, 'watch grant id'),
		projectId: stableIdentifier(row.projectId, 'watch project id'),
		extensions: boundedArray(row.extensions, 32, 'watch extensions')
			.map((item) => stableExtension(item)),
		importMode: row.importMode,
		generateProxies: row.generateProxies,
		enabled: row.enabled,
	});
}

function normalizeCapabilitySnapshot(value: unknown): NativeMediaCapabilitySnapshotV1 | null {
	if (value === null) return null;
	const clone = structuredClone(value);
	assertNativeMediaCapabilitySnapshotV1(clone);
	return clone;
}

function normalizePreferences(value: unknown): FramescaperNativeServicePreferences {
	const row = closedRecord(value, [
		'nativeMediaEnabled', 'hardwareDecodeEnabled', 'hardwareEncodeEnabled', 'ofxConsentEnabled',
	], 'Framescaper native-service preferences');
	for (const key of [
		'nativeMediaEnabled', 'hardwareDecodeEnabled', 'hardwareEncodeEnabled', 'ofxConsentEnabled',
	] as const) {
		if (typeof row[key] !== 'boolean') {
			throw new TypeError('A Framescaper native-service preference must be boolean.');
		}
	}
	return Object.freeze(row as unknown as FramescaperNativeServicePreferences);
}

function normalizeExternalDisplays(
	value: unknown,
): FramescaperNativeServicesExternalDisplayProjection {
	if (value === null || value === undefined) {
		return Object.freeze({ displays: Object.freeze([]), activeDisplayId: null });
	}
	const row = closedRecord(value, ['displays', 'activeDisplayId'], 'Framescaper external displays');
	const displays = boundedArray(row.displays, 32, 'external displays').map(normalizeDisplay);
	const activeDisplayId = optionalDisplayId(row.activeDisplayId);
	if (activeDisplayId !== null && !displays.some((display) => display.displayId === activeDisplayId)) {
		throw new TypeError('The active Framescaper external display is not in its own projection.');
	}
	return Object.freeze({ displays: Object.freeze(displays), activeDisplayId });
}

function normalizeDisplay(value: unknown): ExternalDisplayDescriptorV1 {
	const row = closedRecord(value, [
		'displayId', 'label', 'primary', 'width', 'height', 'hdrCapable', 'colorManaged',
	], 'Framescaper external display');
	const primary = booleanValue(row.primary, 'display primary');
	const hdrCapable = booleanValue(row.hdrCapable, 'display HDR capability');
	const colorManaged = booleanValue(row.colorManaged, 'display colour management');
	return Object.freeze({
		displayId: boundedText(row.displayId, 'display id', 128),
		label: boundedText(row.label, 'display label', 256),
		primary,
		width: positiveInteger(row.width, 'display width'),
		height: positiveInteger(row.height, 'display height'),
		hdrCapable,
		colorManaged,
	});
}

function controlRequest(value: unknown): Readonly<{
	jobId: string; action: FramescaperNativeQueueRendererAction;
}> {
	const row = closedRecord(value, ['jobId', 'action'], 'Framescaper queue control request');
	const actions: readonly FramescaperNativeQueueRendererAction[] = ['pause', 'resume', 'cancel', 'retry'];
	return Object.freeze({
		jobId: exactJobId(row.jobId),
		action: member(row.action, actions, 'queue action'),
	});
}

function reorderRequest(value: unknown): Readonly<{ jobId: string; index: number }> {
	const row = closedRecord(value, ['jobId', 'index'], 'Framescaper queue reorder request');
	return Object.freeze({
		jobId: exactJobId(row.jobId),
		index: nonNegativeInteger(row.index, 'queue index'),
	});
}

function removeRequest(value: unknown): Readonly<{ jobId: string }> {
	const row = closedRecord(value, ['jobId'], 'Framescaper queue removal request');
	return Object.freeze({ jobId: exactJobId(row.jobId) });
}

function preferenceRequest(value: unknown): Readonly<{
	preference: FramescaperNativeServicePreference; enabled: boolean;
}> {
	const row = closedRecord(value, ['preference', 'enabled'], 'Framescaper preference request');
	if (typeof row.enabled !== 'boolean') throw new TypeError('A Framescaper preference value must be boolean.');
	return Object.freeze({
		preference: member(row.preference, FRAMESCAPER_NATIVE_SERVICE_PREFERENCES, 'preference'),
		enabled: row.enabled,
	});
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
}

function closedRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	label: string,
): Readonly<Record<Field, unknown>> {
	const row = recordOrNull(value);
	if (!row || (Object.getPrototypeOf(row) !== Object.prototype && Object.getPrototypeOf(row) !== null)) {
		throw new TypeError(`${label} must be a plain record.`);
	}
	const keys = Reflect.ownKeys(row);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key as Field))) {
		throw new TypeError(`${label} has missing or unsupported fields.`);
	}
	return row as Readonly<Record<Field, unknown>>;
}

function boundedArray(value: unknown, maximum: number, label: string): readonly unknown[] {
	if (!Array.isArray(value) || value.length > maximum
		|| Reflect.ownKeys(value).length !== value.length + 1) {
		throw new TypeError(`A Framescaper native ${label} value must be a bounded dense array.`);
	}
	return value;
}

function member<const Value extends string>(
	value: unknown,
	values: readonly Value[],
	label: string,
): Value {
	if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) {
		throw new TypeError(`A Framescaper native ${label} value is invalid.`);
	}
	return value as Value;
}

function exactJobId(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{40}$/u.test(value)) {
		throw new TypeError('A Framescaper native queue request requires an exact job id.');
	}
	return value;
}

function exactOpaqueId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{16,64}$/u.test(value)) {
		throw new TypeError(`A Framescaper native ${label} is invalid.`);
	}
	return value;
}

function stableIdentifier(value: unknown, label: string): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) {
		throw new TypeError(`A Framescaper native ${label} is invalid.`);
	}
	return value;
}

function stableExtension(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9]{0,15}$/u.test(value)) {
		throw new TypeError('A Framescaper native watch extension is invalid.');
	}
	return value;
}

function optionalDisplayId(value: unknown): string | null {
	return value === null ? null : boundedText(value, 'display id', 128);
}

function boundedText(value: unknown, label: string, maximum = 4_096): string {
	if (typeof value !== 'string' || value.length === 0 || value.length > maximum || value.includes('\0')) {
		throw new TypeError(`A Framescaper native ${label} value is invalid.`);
	}
	return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		throw new RangeError(`A Framescaper native ${label} value is invalid.`);
	}
	return value as number;
}

function positiveInteger(value: unknown, label: string): number {
	const number = nonNegativeInteger(value, label);
	if (number === 0) throw new RangeError(`A Framescaper native ${label} value must be positive.`);
	return number;
}

function booleanValue(value: unknown, label: string): boolean {
	if (typeof value !== 'boolean') throw new TypeError(`A Framescaper native ${label} value is invalid.`);
	return value;
}
