/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	projectDurableRootGrant, type DurableRootGrantV1, type DurableRootGrantProjectionV1,
} from '../src/common/editor/native-durable-root-grant.ts';
import type { NativeQueueRecordV2, NativeQueueState, NativeQueueTaskKind } from '../src/common/editor/native-queue-record.ts';
import {
	NATIVE_MEDIA_CAPABILITY_IDS,
	type NativeMediaCapabilityRefV1,
	type NativeMediaCapabilitySnapshotV1,
} from '../src/common/editor/native-media-capability-snapshot.ts';
import type { FramescaperNativeServicesLease } from './native-services-database.ts';
import { framescaperClosedNativeCapabilityReportV1 } from './native-media-capability-report.ts';
import {
	FramescaperNativeServicesLifecycle,
	type FramescaperNativeExternalDisplayProjection,
} from './native-services-lifecycle.ts';
import {
	framescaperNativeExternalDisplayRequest, framescaperNativeQueueEnqueueRequest,
	framescaperNativeWatchCreateRequest, framescaperNativeWatchEnabledRequest,
} from './native-services-lifecycle-contracts.ts';
import {
	assertFramescaperNativeOperationCapability, assertFramescaperNativeWritableProject,
} from './native-services-operation-authority.ts';
import type {
	FramescaperNativePublicationResult,
	NativeImageSequenceCheckpointResultV1,
} from './native-services-publication.ts';
import type { FramescaperNativeQueueRepository } from './native-services-queue-repository.ts';
import type {
	FramescaperNativeRootGrant,
	FramescaperNativeRootRepository,
} from './native-services-root-repository.ts';
import type { FramescaperNativeWatchRepository } from './native-services-watch-repository.ts';
import {
	FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
	PROJECT_SCHEMA_VERSION,
	readProjectSchemaIdentity,
} from '../src/common/editor/project-schema-identity.ts';
import {
	assertFramescaperNativeWatchProjection,
	framescaperNativeWatchProjection as watchProjection,
	type FramescaperNativeWatchProjectState,
	type FramescaperNativeWatchProjection,
} from './native-services-watch-controller-contract.ts';

export { assertFramescaperNativeWatchProjection } from './native-services-watch-controller-contract.ts';
export type { FramescaperNativeWatchProjection } from './native-services-watch-controller-contract.ts';

export const FRAMESCAPER_NATIVE_SERVICES_SNAPSHOT_VERSION = 1;

export const FRAMESCAPER_NATIVE_QUEUE_RENDERER_ACTIONS = Object.freeze([
	'pause', 'resume', 'cancel', 'retry',
] as const);

export type FramescaperNativeQueueRendererAction =
	(typeof FRAMESCAPER_NATIVE_QUEUE_RENDERER_ACTIONS)[number];
export const FRAMESCAPER_NATIVE_SERVICE_PREFERENCES = Object.freeze([
	'native-media', 'hardware-decode', 'hardware-encode', 'ofx-consent',
] as const);

export type FramescaperNativeServicePreference =
	(typeof FRAMESCAPER_NATIVE_SERVICE_PREFERENCES)[number];
export interface FramescaperNativeServicePreferences {
	readonly nativeMediaEnabled: boolean;
	readonly hardwareDecodeEnabled: boolean;
	readonly hardwareEncodeEnabled: boolean;
	readonly ofxConsentEnabled: boolean;
}

export interface FramescaperNativeQueueProjection {
	readonly jobId: string;
	readonly schemaFamily: typeof FRAMESCAPER_PROJECT_SCHEMA_FAMILY;
	readonly schemaVersion: typeof PROJECT_SCHEMA_VERSION;
	readonly taskKind: NativeQueueTaskKind;
	readonly projectId: string;
	readonly relativeDestination: string;
	readonly state: NativeQueueState;
	readonly position: number;
	readonly progress: number | null;
	readonly attempt: number;
	readonly lastFailureCode: string | null;
}

export interface FramescaperNativeServicesSnapshot {
	readonly snapshotVersion: typeof FRAMESCAPER_NATIVE_SERVICES_SNAPSHOT_VERSION;
	readonly runtimeAvailable: boolean;
	readonly nativeMediaEnabled: boolean;
	readonly queue: readonly FramescaperNativeQueueProjection[];
	readonly roots: readonly DurableRootGrantProjectionV1[];
	readonly watchRules: readonly FramescaperNativeWatchProjection[];
}

export type FramescaperNativeQueueControlRequest = Readonly<{
	readonly jobId: string;
	readonly action: FramescaperNativeQueueRendererAction;
}>;

export type FramescaperNativeQueueRemoveRequest = Readonly<{ readonly jobId: string }>;
export type FramescaperNativeQueueReorderRequest = Readonly<{
	readonly jobId: string;
	readonly index: number;
}>;

export type FramescaperNativePreferenceRequest = Readonly<{
	readonly preference: FramescaperNativeServicePreference;
	readonly enabled: boolean;
}>;
export interface FramescaperNativeServicesControllerOptions {
	readonly queue: FramescaperNativeQueueRepository;
	readonly roots: FramescaperNativeRootRepository;
	readonly watch: FramescaperNativeWatchRepository;
	readonly lifecycle?: FramescaperNativeServicesLifecycle;
	readonly lease: () => FramescaperNativeServicesLease;
	readonly now?: () => number;
	readonly runtimeAvailable?: () => boolean;
	readonly nativeMediaEnabled?: () => boolean;
	readonly preferences?: () => FramescaperNativeServicePreferences;
	readonly capabilities?: () => NativeMediaCapabilitySnapshotV1;
	readonly setPreference?: (
		preference: FramescaperNativeServicePreference,
		enabled: boolean,
	) => Promise<boolean> | boolean;
	readonly rootDisplayName?: (grant: FramescaperNativeRootGrant) => string;
	readonly onQueueControl?: (
		record: NativeQueueRecordV2,
		action: FramescaperNativeQueueRendererAction,
	) => void;
	readonly projectState?: (projectId: string) => Readonly<FramescaperNativeWatchProjectState>;
}

export class FramescaperNativeServicesController {
	readonly #queue: FramescaperNativeQueueRepository;
	readonly #roots: FramescaperNativeRootRepository;
	readonly #watch: FramescaperNativeWatchRepository;
	readonly #lifecycle: FramescaperNativeServicesLifecycle | null;
	readonly #lease: () => FramescaperNativeServicesLease;
	readonly #now: () => number;
	readonly #runtimeAvailable: () => boolean;
	readonly #nativeMediaEnabled: () => boolean;
	readonly #preferences: () => FramescaperNativeServicePreferences;
	readonly #capabilities: () => NativeMediaCapabilitySnapshotV1;
	readonly #setPreference: FramescaperNativeServicesControllerOptions['setPreference'];
	readonly #rootDisplayName: (grant: FramescaperNativeRootGrant) => string;
	readonly #onQueueControl: FramescaperNativeServicesControllerOptions['onQueueControl'];
	readonly #projectState: NonNullable<FramescaperNativeServicesControllerOptions['projectState']>;
	readonly #operations = new Set<Promise<unknown>>();
	#closing = false;

	constructor(options: FramescaperNativeServicesControllerOptions) {
		this.#queue = options.queue;
		this.#roots = options.roots;
		this.#watch = options.watch;
		this.#lifecycle = options.lifecycle ?? null;
		this.#lease = options.lease;
		this.#now = options.now ?? (() => Date.now());
		this.#runtimeAvailable = options.runtimeAvailable ?? (() => false);
		this.#nativeMediaEnabled = options.nativeMediaEnabled ?? (() => false);
		this.#preferences = options.preferences ?? (() => Object.freeze({
			nativeMediaEnabled: false, hardwareDecodeEnabled: false,
			hardwareEncodeEnabled: false, ofxConsentEnabled: false,
		}));
		this.#capabilities = options.capabilities ?? (() => (
			framescaperClosedNativeCapabilityReportV1(this.preferences())
		));
		this.#setPreference = options.setPreference;
		this.#rootDisplayName = options.rootDisplayName ?? (() => 'Authorized folder');
		this.#onQueueControl = options.onQueueControl;
		this.#projectState = options.projectState ?? (() => Object.freeze({
			schemaFamily: 'framescaper' as const, schemaVersion: 1 as const,
			open: false, writable: false, binId: 'project-bin' as const,
		}));
	}

	snapshot(): FramescaperNativeServicesSnapshot {
		const snapshot = Object.freeze({
			snapshotVersion: FRAMESCAPER_NATIVE_SERVICES_SNAPSHOT_VERSION,
			runtimeAvailable: this.#runtimeAvailable() === true,
			nativeMediaEnabled: this.#nativeMediaEnabled() === true,
			queue: Object.freeze(this.#queue.list().map(queueProjection)),
			roots: Object.freeze(this.#roots.list().map((grant) => this.#rootProjection(grant))),
			watchRules: Object.freeze(this.#watch.list().map(watchProjection)),
		});
		assertFramescaperNativeServicesSnapshot(snapshot);
		return snapshot;
	}
	control(value: unknown): FramescaperNativeQueueProjection {
		this.#assertOpen();
		const request = framescaperNativeQueueControlRequest(value);
		if (request.action === 'resume' || request.action === 'retry') {
			const record = this.#queue.read(request.jobId);
			if (record === null) throw new Error('The native queue job does not exist.');
			this.#authorizeQueue(record.taskKind, record.projectId);
		}
		const result = this.#queue.control(
			request.jobId, { kind: request.action }, this.#lease(), this.#now(),
		);
		this.#onQueueControl?.(result.record, request.action);
		return queueProjection(result.record);
	}

	reorder(value: unknown): readonly FramescaperNativeQueueProjection[] {
		this.#assertOpen();
		const request = framescaperNativeQueueReorderRequest(value);
		const record = this.#queue.read(request.jobId);
		if (record === null) throw new Error('The native queue job does not exist.');
		this.#authorizeQueue(record.taskKind, record.projectId);
		return Object.freeze(this.#queue.reorder(request.jobId, request.index,
			this.#lease(), this.#now()).map(queueProjection));
	}
	remove(value: unknown): Promise<boolean> {
		this.#assertOpen();
		const request = framescaperNativeQueueRemoveRequest(value);
		return this.#track(this.#lifecycle === null
			? Promise.resolve(this.#queue.remove(request.jobId, this.#lease(), this.#now()))
			: this.#lifecycle.removeQueue(request.jobId));
	}

	enqueue(value: unknown): FramescaperNativeQueueProjection {
		this.#assertOpen();
		const request = framescaperNativeQueueEnqueueRequest(value);
		this.#authorizeQueue(request.taskKind, request.projectId);
		return queueProjection(this.#requireLifecycle().enqueue(request));
	}

	authorizeQueueEnqueue(value: unknown): void {
		const request = framescaperNativeQueueEnqueueRequest(value);
		this.#authorizeQueue(request.taskKind, request.projectId);
	}

	authorizeWatchProject(projectId: unknown): void {
		this.#authorizeCapability(NATIVE_MEDIA_CAPABILITY_IDS.watchFolders, 'watch folders');
		this.#requireWritableProject(projectId);
	}

	authorizeImageSequenceSelection(): void {
		this.#authorizeCapability(NATIVE_MEDIA_CAPABILITY_IDS.imageSequenceImport, 'image-sequence import');
	}

	selectRoot(): Promise<DurableRootGrantProjectionV1 | null> {
		this.#assertOpen();
		return this.#track((async () => {
			const grant = await this.#requireLifecycle().selectRoot();
			return grant === null ? null : this.#rootProjection(grant);
		})());
	}

	revalidateRoot(value: unknown): Promise<boolean> {
		this.#assertOpen();
		return this.#track(this.#requireLifecycle().revalidateRoot(value));
	}

	revokeRoot(value: unknown): boolean {
		this.#assertOpen();
		return this.#requireLifecycle().revokeRoot(value);
	}

	createWatch(value: unknown): FramescaperNativeWatchProjection {
		this.#assertOpen();
		const request = framescaperNativeWatchCreateRequest(value);
		this.authorizeWatchProject(request.projectId);
		if (request.generateProxies) {
			throw new Error('Framescaper watch-folder proxy generation is unavailable.');
		}
		if (request.binId !== null) {
			throw new Error('Framescaper watch-folder destination bins are unavailable.');
		}
		return watchProjection(this.#requireLifecycle().createWatch(request));
	}

	setWatchEnabled(value: unknown): FramescaperNativeWatchProjection {
		this.#assertOpen();
		const request = framescaperNativeWatchEnabledRequest(value);
		if (request.enabled) {
			const rule = this.#watch.read(request.ruleId);
			if (rule === null) throw new Error('The native watch rule does not exist.');
			this.authorizeWatchProject(rule.projectId);
		}
		return watchProjection(this.#requireLifecycle().setWatchEnabled(request));
	}

	removeWatch(value: unknown): boolean {
		this.#assertOpen();
		return this.#requireLifecycle().removeWatch(value);
	}

	reconcileWatch(): Promise<FramescaperNativeServicesSnapshot> {
		this.#assertOpen();
		this.#authorizeCapability(NATIVE_MEDIA_CAPABILITY_IDS.watchFolders, 'watch folders');
		for (const rule of this.#watch.list().filter(({ enabled }) => enabled)) {
			// A closed or read-only project leaves its ingests pending — the
			// reconciler's own contract — so one such rule must not fail the
			// manual reconcile that every other rule would still be served by.
			const state = this.#projectState(rule.projectId);
			if (!state.open || !state.writable) continue;
			this.authorizeWatchProject(rule.projectId);
		}
		return this.#track((async () => {
			await this.#requireLifecycle().reconcileWatch();
			return this.snapshot();
		})());
	}

	cleanupScratch(): Promise<readonly string[]> {
		this.#assertOpen();
		return this.#track(this.#requireLifecycle().cleanupScratch());
	}

	settleScratch(value: unknown): Promise<'released' | 'retained'> {
		this.#assertOpen();
		return this.#track(this.#requireLifecycle().settleScratch(value));
	}

	publish(value: unknown): Promise<FramescaperNativePublicationResult> {
		this.#authorizeCapability(NATIVE_MEDIA_CAPABILITY_IDS.renderQueue, 'persistent render queue');
		return this.#track(this.#requireLifecycle().publish(value));
	}

	checkpoint(value: unknown): Promise<NativeImageSequenceCheckpointResultV1> {
		this.#authorizeCapability(NATIVE_MEDIA_CAPABILITY_IDS.renderQueue, 'persistent render queue');
		return this.#track(this.#requireLifecycle().checkpoint(value));
	}

	externalDisplays(): FramescaperNativeExternalDisplayProjection {
		return this.#requireLifecycle().externalDisplays();
	}

	setExternalDisplay(value: unknown): Promise<FramescaperNativeExternalDisplayProjection> {
		this.#assertOpen();
		const request = framescaperNativeExternalDisplayRequest(value);
		if (request.displayId !== null) {
			this.#authorizeCapability(NATIVE_MEDIA_CAPABILITY_IDS.externalDisplay, 'external display');
		}
		return this.#track(this.#requireLifecycle().setExternalDisplay(request));
	}

	presentExternalDisplay(value: unknown): FramescaperNativeExternalDisplayProjection {
		this.#authorizeCapability(NATIVE_MEDIA_CAPABILITY_IDS.externalDisplay, 'external display');
		return this.#requireLifecycle().presentExternalDisplay(value);
	}

	beginShutdown(): void { this.#closing = true; }
	async drain(): Promise<void> {
		this.#closing = true;
		await Promise.allSettled([...this.#operations]);
	}

	preferences(): FramescaperNativeServicePreferences {
		return framescaperNativeServicePreferences(this.#preferences());
	}

	capabilities(): NativeMediaCapabilitySnapshotV1 {
		return this.#capabilities();
	}

	async setPreference(value: unknown): Promise<boolean> {
		const request = framescaperNativePreferenceRequest(value);
		if (!this.#setPreference) {
			throw new Error('This desktop build cannot change native-service preferences.');
		}
		const result = await this.#setPreference(request.preference, request.enabled);
		if (typeof result !== 'boolean') {
			throw new TypeError('A native-service preference update returned an invalid result.');
		}
		return result;
	}

	#rootProjection(grant: FramescaperNativeRootGrant): DurableRootGrantProjectionV1 {
		return projectDurableRootGrant(commonGrant(grant), this.#rootDisplayName(grant));
	}

	#requireLifecycle(): FramescaperNativeServicesLifecycle {
		if (this.#lifecycle === null) {
			throw new Error('This desktop build has no Framescaper native-services lifecycle.');
		}
		return this.#lifecycle;
	}

	#authorizeQueue(taskKind: NativeQueueTaskKind, projectId: unknown): void {
		this.#authorizeCapability(NATIVE_MEDIA_CAPABILITY_IDS.renderQueue, 'persistent render queue');
		if (taskKind === 'proxy-generation') {
			this.#authorizeCapability(NATIVE_MEDIA_CAPABILITY_IDS.proxyCodec, 'proxy generation');
		}
		this.#requireWritableProject(projectId);
	}

	#authorizeCapability(reference: NativeMediaCapabilityRefV1, label: string): void {
		this.#assertOpen();
		assertFramescaperNativeOperationCapability({
			runtimeAvailable: this.#runtimeAvailable(), nativeMediaEnabled: this.#nativeMediaEnabled(),
			snapshot: this.#capabilities(), reference, label,
		});
	}

	#requireWritableProject(projectId: unknown): void {
		assertFramescaperNativeWritableProject(projectId, this.#projectState);
	}

	#assertOpen(): void {
		if (this.#closing) throw new Error('Framescaper native services are shutting down.');
	}

	#track<Result>(operation: Promise<Result>): Promise<Result> {
		this.#assertOpen();
		this.#operations.add(operation);
		void operation.finally(() => { this.#operations.delete(operation); }).catch(() => undefined);
		return operation;
	}
}

export function framescaperNativeServicePreferences(
	value: unknown,
): FramescaperNativeServicePreferences {
	const preferences = closedRecord(value, [
		'nativeMediaEnabled', 'hardwareDecodeEnabled', 'hardwareEncodeEnabled', 'ofxConsentEnabled',
	], 'native-service preferences');
	for (const key of [
		'nativeMediaEnabled', 'hardwareDecodeEnabled', 'hardwareEncodeEnabled', 'ofxConsentEnabled',
	] as const) {
		if (typeof preferences[key] !== 'boolean') {
			throw new TypeError('A native-service preference must be boolean.');
		}
	}
	return Object.freeze(preferences as unknown as FramescaperNativeServicePreferences);
}

export function framescaperNativePreferenceRequest(
	value: unknown,
): FramescaperNativePreferenceRequest {
	const request = closedRecord(value, ['preference', 'enabled'], 'native-service preference request');
	if (typeof request.preference !== 'string'
		|| !(FRAMESCAPER_NATIVE_SERVICE_PREFERENCES as readonly string[]).includes(request.preference)) {
		throw new TypeError('A native-service preference request names an unsupported preference.');
	}
	if (typeof request.enabled !== 'boolean') {
		throw new TypeError('A native-service preference request requires a boolean value.');
	}
	return Object.freeze({
		preference: request.preference as FramescaperNativeServicePreference,
		enabled: request.enabled,
	});
}

export function framescaperNativeQueueControlRequest(value: unknown): FramescaperNativeQueueControlRequest {
	const request = closedRecord(value, ['jobId', 'action'], 'native queue control request');
	const action = request.action;
	if (typeof action !== 'string'
		|| !(FRAMESCAPER_NATIVE_QUEUE_RENDERER_ACTIONS as readonly string[]).includes(action)) {
		throw new TypeError('A native queue control request names an unsupported action.');
	}
	return Object.freeze({ jobId: jobId(request.jobId), action: action as FramescaperNativeQueueRendererAction });
}

export function framescaperNativeQueueRemoveRequest(value: unknown): FramescaperNativeQueueRemoveRequest {
	const request = closedRecord(value, ['jobId'], 'native queue remove request');
	return Object.freeze({ jobId: jobId(request.jobId) });
}

export function framescaperNativeQueueReorderRequest(value: unknown): FramescaperNativeQueueReorderRequest {
	const request = closedRecord(value, ['jobId', 'index'], 'native queue reorder request');
	if (!Number.isSafeInteger(request.index) || (request.index as number) < 0) {
		throw new RangeError('A native queue reorder request requires a non-negative index.');
	}
	return Object.freeze({ jobId: jobId(request.jobId), index: request.index as number });
}

export function assertFramescaperNativeServicesSnapshot(
	value: unknown,
): asserts value is FramescaperNativeServicesSnapshot {
	const snapshot = closedRecord(
		value,
		['snapshotVersion', 'runtimeAvailable', 'nativeMediaEnabled', 'queue', 'roots', 'watchRules'],
		'native services snapshot',
	);
	if (snapshot.snapshotVersion !== FRAMESCAPER_NATIVE_SERVICES_SNAPSHOT_VERSION
		|| typeof snapshot.runtimeAvailable !== 'boolean'
		|| typeof snapshot.nativeMediaEnabled !== 'boolean') {
		throw new TypeError('A native services snapshot has an invalid version or availability state.');
	}
	boundedArray(snapshot.queue, 100_000, 'native services queue').forEach(assertFramescaperNativeQueueProjection);
	boundedArray(snapshot.roots, 1_024, 'native services roots').forEach(assertFramescaperNativeRootProjection);
	boundedArray(snapshot.watchRules, 1_024, 'native services watch rules').forEach(assertFramescaperNativeWatchProjection);
}

function queueProjection(record: Readonly<{
	jobId: string; schemaFamily: typeof FRAMESCAPER_PROJECT_SCHEMA_FAMILY;
	schemaVersion: typeof PROJECT_SCHEMA_VERSION;
	taskKind: NativeQueueTaskKind; projectId: string; relativeDestination: string;
	state: NativeQueueState; position: number; progress: number | null; attempt: number;
	lastFailureCode: string | null;
}>): FramescaperNativeQueueProjection {
	return Object.freeze({
		jobId: record.jobId,
		schemaFamily: record.schemaFamily,
		schemaVersion: record.schemaVersion,
		taskKind: record.taskKind,
		projectId: record.projectId,
		relativeDestination: record.relativeDestination,
		state: record.state,
		position: record.position,
		progress: record.progress,
		attempt: record.attempt,
		lastFailureCode: record.lastFailureCode,
	});
}

function commonGrant(grant: FramescaperNativeRootGrant): DurableRootGrantV1 {
	return Object.freeze({
		grantId: grant.grantId,
		canonicalPath: grant.rootPath,
		volumeIdentity: grant.volumeIdentity,
		directoryIdentity: grant.directoryIdentity,
		authorizedAtMs: grant.authorizedAtMs,
		revokedAtMs: grant.revokedAtMs,
	});
}

export function assertFramescaperNativeQueueProjection(
	value: unknown,
): asserts value is FramescaperNativeQueueProjection {
	const identity = readProjectSchemaIdentity(value);
	if (identity.schemaFamily !== FRAMESCAPER_PROJECT_SCHEMA_FAMILY
		|| identity.schemaVersion !== PROJECT_SCHEMA_VERSION) {
		throw new RangeError('A native queue projection requires the current Framescaper schema.');
	}
	const row = closedRecord(value, [
		'jobId', 'schemaFamily', 'schemaVersion', 'taskKind', 'projectId', 'relativeDestination', 'state',
		'position', 'progress', 'attempt', 'lastFailureCode',
	], 'native queue projection');
	jobId(row.jobId);
	for (const key of ['taskKind', 'projectId', 'relativeDestination', 'state'] as const) boundedText(row[key], key);
	for (const key of ['position', 'attempt'] as const) nonNegative(row[key], key);
	if (row.progress !== null && (typeof row.progress !== 'number'
		|| !Number.isFinite(row.progress) || row.progress < 0 || row.progress > 1)) {
		throw new TypeError('A native queue projection progress value is invalid.');
	}
	if (row.lastFailureCode !== null) boundedText(row.lastFailureCode, 'last failure code');
}

export function assertFramescaperNativeRootProjection(value: unknown): void {
	const root = closedRecord(value, ['grantId', 'displayName', 'revoked'], 'native root projection');
	boundedText(root.grantId, 'grant id');
	boundedText(root.displayName, 'display name');
	if (typeof root.revoked !== 'boolean') throw new TypeError('A native root projection revoked flag is invalid.');
}

function closedRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	label: string,
): Readonly<Record<Field, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`A ${label} must be a plain record.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key as Field))) {
		throw new TypeError(`A ${label} has missing or unsupported fields.`);
	}
	return value as Readonly<Record<Field, unknown>>;
}

function boundedArray(value: unknown, maximum: number, label: string): readonly unknown[] {
	if (!Array.isArray(value) || value.length > maximum
		|| Reflect.ownKeys(value).length !== value.length + 1) {
		throw new TypeError(`A ${label} must be a bounded dense array.`);
	}
	return value;
}

function jobId(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{40}$/u.test(value)) {
		throw new TypeError('A native queue request requires an exact job id.');
	}
	return value;
}

function boundedText(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length === 0 || value.length > 4_096 || value.includes('\0')) {
		throw new TypeError(`A native services ${label} value is invalid.`);
	}
	return value;
}

function nonNegative(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		throw new RangeError(`A native services ${label} value is invalid.`);
	}
	return value as number;
}
