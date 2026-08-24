/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	projectDurableRootGrant, type DurableRootGrantProjectionV1,
} from '../src/common/editor/native-durable-root-grant.ts';
import type { NativeQueueRecordV3 } from '../src/common/editor/native-queue-record-v3.ts';
import type { NativeQueueReservationsV1, NativeQueueTaskKind } from '../src/common/editor/native-queue-record.ts';
import {
	NATIVE_MEDIA_CAPABILITY_IDS,
	type NativeMediaCapabilityRefV1,
	type NativeMediaCapabilitySnapshotV1,
} from '../src/common/editor/native-media-capability-snapshot.ts';
import type { FramescaperNativeServicesLease } from './native-services-database.ts';
import { framescaperClosedNativeCapabilityReportV1 } from './native-media-capability-report.ts';
import {
	FramescaperNativeServicesLifecycleV3,
	type FramescaperNativeExternalDisplayProjection,
} from './native-services-lifecycle-v3.ts';
import {
	framescaperNativeExternalDisplayRequest, framescaperNativeLifecycleIdRequest,
	framescaperNativeQueueEnqueueRequest,
	framescaperNativeWatchCreateRequest, framescaperNativeWatchEnabledRequest,
} from './native-services-lifecycle-contracts.ts';
import {
	assertFramescaperNativeOperationCapability, assertFramescaperNativeWritableProject,
} from './native-services-operation-authority.ts';
import type {
	FramescaperNativePublicationResult,
	NativeImageSequenceCheckpointResultV1,
} from './native-services-publication.ts';
import type { FramescaperNativeQueueRepository } from './native-services-queue-repository-v3.ts';
import type {
	FramescaperNativeRootGrant,
	FramescaperNativeRootRepository,
} from './native-services-root-repository.ts';
import type { FramescaperNativeWatchRepository } from './native-services-watch-repository.ts';
import {
	assertFramescaperNativeWatchTarget,
	framescaperNativeWatchProjection as watchProjection,
	type FramescaperNativeWatchProjectState,
	type FramescaperNativeWatchProjection,
} from './native-services-watch-controller-contract.ts';
import { assertFramescaperRegeneratedQueue } from './native-services-regenerated-queue.ts';
import {
	framescaperNativeQueueControlTransitionV3,
	type FramescaperNativeQueueRendererAction,
} from './native-services-carrier-recovery-v3.ts';
import {
	FRAMESCAPER_NATIVE_SERVICES_SNAPSHOT_VERSION,
	assertFramescaperNativeServicesSnapshot,
	framescaperNativeCommonRootGrant,
	framescaperNativePreferenceRequest,
	framescaperNativeQueueControlRequest,
	framescaperNativeQueueProjection,
	framescaperNativeQueueRemoveRequest,
	framescaperNativeQueueReorderRequest,
	framescaperNativeServicePreferences,
	type FramescaperNativeQueueProjection,
	type FramescaperNativeServicePreference,
	type FramescaperNativeServicePreferences,
	type FramescaperNativeServicesSnapshot,
} from './native-services-controller-contracts-v3.ts';

export { assertFramescaperNativeWatchProjection } from './native-services-watch-controller-contract.ts';
export type { FramescaperNativeWatchProjection } from './native-services-watch-controller-contract.ts';
export { FRAMESCAPER_NATIVE_QUEUE_RENDERER_ACTIONS } from './native-services-carrier-recovery-v3.ts';
export type { FramescaperNativeQueueRendererAction } from './native-services-carrier-recovery-v3.ts';

export * from './native-services-controller-contracts-v3.ts';
export interface FramescaperNativeServicesControllerV3Options {
	readonly queue: FramescaperNativeQueueRepository;
	readonly roots: FramescaperNativeRootRepository;
	readonly watch: FramescaperNativeWatchRepository;
	readonly lifecycle?: FramescaperNativeServicesLifecycleV3;
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
	readonly reserveQueue?: (
		request: ReturnType<typeof framescaperNativeQueueEnqueueRequest>,
	) => NativeQueueReservationsV1;
	readonly rootDisplayName?: (grant: FramescaperNativeRootGrant) => string;
	readonly onQueueControl?: (
		record: NativeQueueRecordV3,
		action: FramescaperNativeQueueRendererAction,
	) => Promise<void> | void;
	readonly projectState?: (projectId: string) => Readonly<FramescaperNativeWatchProjectState>;
}

export class FramescaperNativeServicesControllerV3 {
	readonly #queue: FramescaperNativeQueueRepository;
	readonly #roots: FramescaperNativeRootRepository;
	readonly #watch: FramescaperNativeWatchRepository;
	readonly #lifecycle: FramescaperNativeServicesLifecycleV3 | null;
	readonly #lease: () => FramescaperNativeServicesLease;
	readonly #now: () => number;
	readonly #runtimeAvailable: () => boolean;
	readonly #nativeMediaEnabled: () => boolean;
	readonly #preferences: () => FramescaperNativeServicePreferences;
	readonly #capabilities: () => NativeMediaCapabilitySnapshotV1;
	readonly #setPreference: FramescaperNativeServicesControllerV3Options['setPreference'];
	readonly #reserveQueue: NonNullable<FramescaperNativeServicesControllerV3Options['reserveQueue']>;
	readonly #rootDisplayName: (grant: FramescaperNativeRootGrant) => string;
	readonly #onQueueControl: FramescaperNativeServicesControllerV3Options['onQueueControl'];
	readonly #projectState: NonNullable<FramescaperNativeServicesControllerV3Options['projectState']>;
	readonly #operations = new Set<Promise<unknown>>();
	#closing = false;

	constructor(options: FramescaperNativeServicesControllerV3Options) {
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
		this.#reserveQueue = options.reserveQueue ?? ((request) => Object.freeze({
			...request.reservations, hardwareBackend: null,
		}));
		this.#rootDisplayName = options.rootDisplayName ?? (() => 'Authorized folder');
		this.#onQueueControl = options.onQueueControl;
		this.#projectState = options.projectState ?? (() => Object.freeze({ open: false, writable: false }));
	}

	snapshot(): FramescaperNativeServicesSnapshot {
		const snapshot = Object.freeze({
			snapshotVersion: FRAMESCAPER_NATIVE_SERVICES_SNAPSHOT_VERSION,
			runtimeAvailable: this.#runtimeAvailable() === true,
			nativeMediaEnabled: this.#nativeMediaEnabled() === true,
			queue: Object.freeze(this.#queue.list().map(framescaperNativeQueueProjection)),
			roots: Object.freeze(this.#roots.list().map((grant) => this.#rootProjection(grant))),
			watchRules: Object.freeze(this.#watch.list().map(watchProjection)),
		});
		assertFramescaperNativeServicesSnapshot(snapshot);
		return snapshot;
	}
	control(value: unknown): Promise<FramescaperNativeQueueProjection> {
		this.#assertOpen();
		const request = framescaperNativeQueueControlRequest(value);
		const record = this.#queue.read(request.jobId);
		if (record === null) throw new Error('The native queue job does not exist.');
		if (request.action === 'resume' || request.action === 'retry') {
			this.#authorizeQueue(record.taskKind, record.projectId);
		}
		const result = this.#queue.control(
			request.jobId, framescaperNativeQueueControlTransitionV3(record, request.action),
			this.#lease(), this.#now(),
		);
		return this.#track(Promise.resolve(this.#onQueueControl?.(result.record, request.action))
			.then(() => framescaperNativeQueueProjection(result.record)));
	}

	reorder(value: unknown): readonly FramescaperNativeQueueProjection[] {
		this.#assertOpen();
		const request = framescaperNativeQueueReorderRequest(value);
		const record = this.#queue.read(request.jobId);
		if (record === null) throw new Error('The native queue job does not exist.');
		this.#authorizeQueue(record.taskKind, record.projectId);
		return Object.freeze(this.#queue.reorder(request.jobId, request.index,
			this.#lease(), this.#now()).map(framescaperNativeQueueProjection));
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
		return framescaperNativeQueueProjection(this.#requireLifecycle().enqueue(Object.freeze({
			...request, reservations: this.#reserveQueue(request),
		})));
	}

	authorizeQueueEnqueue(value: unknown): void {
		const request = framescaperNativeQueueEnqueueRequest(value);
		this.#authorizeQueue(request.taskKind, request.projectId);
	}

	resumeRegeneratedQueue(value: unknown): Promise<FramescaperNativeQueueProjection | null> {
		this.#assertOpen();
		const request = framescaperNativeQueueEnqueueRequest(value);
		if (request.derivedInputStageId === null) return Promise.resolve(null);
		const current = this.#queue.read(request.derivedInputStageId);
		if (current === null) return Promise.resolve(null);
		this.#authorizeQueue(request.taskKind, request.projectId);
		const reservations = this.#reserveQueue(request);
		assertFramescaperRegeneratedQueue(current, request, reservations);
		const result = this.#queue.control(
			current.jobId, { kind: 'resume' }, this.#lease(), this.#now(),
		);
		return this.#track(Promise.resolve(this.#onQueueControl?.(result.record, 'resume'))
			.then(() => framescaperNativeQueueProjection(result.record)));
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

	reauthorizeQueueRoot(value: unknown): Promise<FramescaperNativeQueueProjection | null> {
		this.#assertOpen();
		const request = framescaperNativeLifecycleIdRequest(value, 'jobId');
		const record = this.#queue.read(request.jobId);
		if (record === null) throw new Error('The native queue job does not exist.');
		this.#authorizeQueue(record.taskKind, record.projectId);
		return this.#track(this.#requireLifecycle().reauthorizeQueueRoot(request).then(
			(result) => result === null ? null : framescaperNativeQueueProjection(result),
		));
	}

	revokeRoot(value: unknown): boolean {
		this.#assertOpen();
		return this.#requireLifecycle().revokeRoot(value);
	}

	createWatch(value: unknown): FramescaperNativeWatchProjection {
		this.#assertOpen();
		const request = framescaperNativeWatchCreateRequest(value);
		this.#authorizeWatchRule(request);
		return watchProjection(this.#requireLifecycle().createWatch(request));
	}

	setWatchEnabled(value: unknown): FramescaperNativeWatchProjection {
		this.#assertOpen();
		const request = framescaperNativeWatchEnabledRequest(value);
		if (request.enabled) {
			const rule = this.#watch.read(request.ruleId);
			if (rule === null) throw new Error('The native watch rule does not exist.');
			this.#authorizeWatchRule(rule);
		}
		return watchProjection(this.#requireLifecycle().setWatchEnabled(request));
	}

	removeWatch(value: unknown): boolean {
		this.#assertOpen();
		return this.#requireLifecycle().removeWatch(value);
	}

	reconcileWatch(): Promise<FramescaperNativeServicesSnapshot> {
		this.#assertOpen();
		for (const rule of this.#watch.list().filter(({ enabled }) => enabled)) {
			this.#authorizeWatchRule(rule);
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
		return projectDurableRootGrant(framescaperNativeCommonRootGrant(grant), this.#rootDisplayName(grant));
	}

	#requireLifecycle(): FramescaperNativeServicesLifecycleV3 {
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

	#authorizeWatchRule(rule: Readonly<{
		projectId: string; binId: string | null; generateProxies: boolean;
	}>): void {
		this.authorizeWatchProject(rule.projectId);
		assertFramescaperNativeWatchTarget(this.#projectState(rule.projectId), rule);
		if (rule.generateProxies) this.#authorizeCapability(
			NATIVE_MEDIA_CAPABILITY_IDS.proxyCodec, 'proxy generation',
		);
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
