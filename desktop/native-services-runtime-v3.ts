/* SPDX-License-Identifier: AGPL-3.0-only */

import { basename } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { NativeQueueRecordV3 } from '../src/common/editor/native-queue-record-v3.ts';
import {
	NATIVE_MEDIA_CAPABILITY_IDS,
	isNativeMediaCapabilityUsable,
	nativeMediaCapabilityEntry,
	type NativeMediaCapabilitySnapshotV1,
} from '../src/common/editor/native-media-capability-snapshot.ts';
import type { NativeQueueRevalidationV1 } from '../src/common/editor/native-queue-state-machine.ts';
import {
	FramescaperNativeServicesControllerV3,
	type FramescaperNativeServicesControllerV3Options,
	type FramescaperNativeServicePreference,
	type FramescaperNativeServicePreferences,
} from './native-services-controller-v3.ts';
import {
	FramescaperNativeServicesLifecycleV3,
	type FramescaperNativeExternalDisplayPort,
} from './native-services-lifecycle-v3.ts';
import type { FramescaperNativePublicationPort, NativeImageSequenceCheckpointFrameV1 } from './native-services-publication.ts';
import type { FramescaperNativeCheckpointStore } from './native-services-checkpoint-recovery.ts';
import {
	initializeFramescaperNativeServicesDatabaseV3,
} from './native-services-database-v3.ts';
import {
	FramescaperNativeServicesLeaseCoordinator,
} from './native-services-lease-coordinator.ts';
import {
	FramescaperNativeMediaQueueDispatcherV3,
	type FramescaperNativeMediaQueueDispatcherV3Options,
} from './native-media-queue-dispatcher-v3.ts';
import type {
	FramescaperNativeQueueCapacityProviderV3,
} from './native-queue-capacity-provider-v3.ts';
import {
	FramescaperNativeQueueRepository,
	nativeQueueRecordNeedsRecoveryRevalidation,
	type FramescaperNativeQueueRecovery,
} from './native-services-queue-repository-v3.ts';
import {
	FramescaperNativeRootRepository,
	type FramescaperNativeRootGrant,
	type FramescaperNativeRootProbe,
	type FramescaperNativeRootSelection,
} from './native-services-root-repository.ts';
import {
	FramescaperNativeScratchRepository,
	type FramescaperNativeScratchCleanupPort,
} from './native-services-scratch-repository.ts';
import {
	FramescaperNativeWatchReconciler,
	FramescaperNativeWatchRepository,
	type FramescaperNativeWatchEntry,
	type FramescaperNativeWatchProbeResult,
	type FramescaperNativeWatchProjectState,
	type FramescaperNativeWatchReconcilerOptions,
} from './native-services-watch-repository.ts';
import {
	FramescaperNativeWatchCoordinator,
	type FramescaperNativeWatchFactory,
} from './native-services-watch-coordinator.ts';
import type { WatchRuleV1 } from '../src/common/editor/native-watch-rule.ts';
import { FramescaperNativePublicationFenceServiceV3 } from './native-services-publication-fence-v3.ts';
import { nativeQueueRecordRequiresRendererCarrier } from './native-services-carrier-recovery-v3.ts';

export interface FramescaperNativeServicesRuntimeV3Options {
	readonly databasePath: string;
	readonly leaseId: string;
	readonly instanceId: string;
	readonly processId: number;
	readonly runtimeAvailable: () => boolean;
	readonly nativeMediaEnabled: () => boolean;
	readonly preferences?: () => FramescaperNativeServicePreferences;
	readonly capabilities?: () => NativeMediaCapabilitySnapshotV1;
	readonly setPreference?: (
		preference: FramescaperNativeServicePreference,
		enabled: boolean,
	) => Promise<boolean> | boolean;
	readonly reserveQueue?: FramescaperNativeServicesControllerV3Options['reserveQueue'];
	readonly now?: () => number;
	readonly schedule?: (callback: () => void, delayMs: number) => unknown;
	readonly cancelSchedule?: (handle: unknown) => void;
	readonly onFenced?: (error: unknown) => void;
	readonly onWatchError?: (error: unknown) => void;
	readonly revalidate?: FramescaperNativeQueueRevalidator;
	readonly onRecovery?: (rows: readonly FramescaperNativeQueueRecovery[]) => void;
	readonly dispatchRecovered?: (
		records: readonly NativeQueueRecordV3[],
	) => Promise<void> | void;
	readonly mintOpaqueId?: () => string;
	readonly mintJobId?: () => string;
	readonly selectRoot?: () => Promise<FramescaperNativeRootSelection | null>;
	readonly probeRoot?: FramescaperNativeRootProbe;
	readonly watchFactory?: FramescaperNativeWatchFactory;
	readonly watchScan?: (
		rule: WatchRuleV1,
		root: FramescaperNativeRootGrant,
	) => Promise<readonly FramescaperNativeWatchEntry[]>;
	readonly watchProbe?: (
		entry: FramescaperNativeWatchEntry,
	) => Promise<FramescaperNativeWatchProbeResult>;
	readonly watchProjectState?: (projectId: string) => FramescaperNativeWatchProjectState;
	readonly watchImportFile?: FramescaperNativeWatchReconcilerOptions['importFile'];
	readonly watchImportRecorded?: FramescaperNativeWatchReconcilerOptions['importRecorded'];
	readonly scratchCleanup?: FramescaperNativeScratchCleanupPort;
	readonly publicationPortFor?: (grant: FramescaperNativeRootGrant) => FramescaperNativePublicationPort;
	readonly removeRenderInputs?: (record: NativeQueueRecordV3) => Promise<void>;
	readonly checkpointInspectFor?: (
		grant: FramescaperNativeRootGrant,
	) => (frame: NativeImageSequenceCheckpointFrameV1) => Promise<Readonly<{
		byteLength: number;
		sha256: string;
		symbolicLink: boolean;
	}> | null>;
	readonly checkpointStore?: FramescaperNativeCheckpointStore;
	readonly externalDisplay?: FramescaperNativeExternalDisplayPort;
	readonly nativeQueueExecution?: Pick<FramescaperNativeMediaQueueDispatcherV3Options,
		'pool' | 'prepare' | 'onError'> & Readonly<{
		readonly capacity: FramescaperNativeQueueCapacityProviderV3;
	}>;
}

export type FramescaperNativeQueueRevalidator = (
	context: Readonly<{
		record: NativeQueueRecordV3;
		readonly rootAuthorized: boolean;
		readonly root: FramescaperNativeRootGrant | null;
	}>,
) => NativeQueueRevalidationV1 | Promise<NativeQueueRevalidationV1>;

export interface FramescaperNativeServicesRuntimeV3 {
	readonly databaseVersion: number;
	readonly controller: FramescaperNativeServicesControllerV3;
	readonly queue: FramescaperNativeQueueRepository;
	readonly roots: FramescaperNativeRootRepository;
	readonly watch: FramescaperNativeWatchRepository;
	readonly scratch: FramescaperNativeScratchRepository;
	readonly lease: FramescaperNativeServicesLeaseCoordinator;
	readonly lifecycle: FramescaperNativeServicesLifecycleV3;
	readonly watchCoordinator: FramescaperNativeWatchCoordinator;
	readonly queueDispatcher: FramescaperNativeMediaQueueDispatcherV3 | null;
	readonly publicationFence: FramescaperNativePublicationFenceServiceV3 | null;
	readonly ready: Promise<void>;
	close(): Promise<boolean>;
}

/** Compose the process-lifetime repositories; no renderer ever receives the database or a path. */
export function startFramescaperNativeServicesRuntimeV3(
	options: FramescaperNativeServicesRuntimeV3Options,
): FramescaperNativeServicesRuntimeV3 {
	const database = new DatabaseSync(options.databasePath);
	let lease: FramescaperNativeServicesLeaseCoordinator | null = null;
	try {
		const databaseVersion = initializeFramescaperNativeServicesDatabaseV3(database);
		const queue = new FramescaperNativeQueueRepository(database);
		const roots = new FramescaperNativeRootRepository(database);
		const watch = new FramescaperNativeWatchRepository(database);
		const scratch = new FramescaperNativeScratchRepository(database);
		lease = new FramescaperNativeServicesLeaseCoordinator({
			database,
			leaseId: options.leaseId,
			instanceId: options.instanceId,
			processId: options.processId,
			...(options.now ? { now: options.now } : {}),
			...(options.schedule ? { schedule: options.schedule } : {}),
			...(options.cancelSchedule ? { cancelSchedule: options.cancelSchedule } : {}),
			...(options.onFenced ? { onFenced: options.onFenced } : {}),
		});
		lease.start();
		const now = options.now ?? (() => Date.now());
		const publicationFence = options.probeRoot
			? new FramescaperNativePublicationFenceServiceV3({
				queue, roots, lease: () => lease!.lease(), now, probeRoot: options.probeRoot,
				authorized: (record) => queueOperationUsable(options, record),
			})
			: null;
		const revalidate = options.revalidate ?? failClosedRevalidation;
		const hasWatchReconciler = options.watchScan !== undefined
			&& options.watchProbe !== undefined
			&& options.watchProjectState !== undefined
			&& options.watchImportFile !== undefined;
		const watchReconciler = hasWatchReconciler
			? new FramescaperNativeWatchReconciler({
				repository: watch,
				roots,
				scan: options.watchScan!,
				probe: options.watchProbe!,
				projectState: options.watchProjectState!,
				lease: () => lease!.lease(),
				importFile: options.watchImportFile!,
				...(options.watchImportRecorded ? { importRecorded: options.watchImportRecorded } : {}),
			})
			: null;
		const watchCoordinator = new FramescaperNativeWatchCoordinator({
			repository: watch,
			roots,
			reconcile: async () => {
				if (watchReconciler !== null) void await watchReconciler.reconcile(now());
			},
			...(options.watchFactory ? { watch: options.watchFactory } : {}),
			...(options.schedule ? { schedule: options.schedule } : {}),
			...(options.cancelSchedule ? { cancelSchedule: options.cancelSchedule } : {}),
			...(options.onWatchError ? { onError: options.onWatchError } : {}),
		});
		const queueExecution = options.nativeQueueExecution;
		const queueDispatcher = queueExecution
			? new FramescaperNativeMediaQueueDispatcherV3({
				queue, roots, lease: () => lease!.lease(), now,
				available: options.runtimeAvailable,
				nativeMediaEnabled: options.nativeMediaEnabled,
				capacity: () => queueExecution.capacity({ queue: queue.list(), scratch: scratch.list() }),
				pool: queueExecution.pool,
				prepare: queueExecution.prepare,
				...(options.removeRenderInputs ? { removeInactiveCarrier: options.removeRenderInputs } : {}),
				...(queueExecution.onError ? { onError: queueExecution.onError } : {}),
			})
			: null;
		const updatePreference = options.setPreference;
		const setPreference = updatePreference
			? async (preference: FramescaperNativeServicePreference, enabled: boolean): Promise<boolean> => {
				const nativeMediaWasEnabled = options.nativeMediaEnabled();
				const result = await updatePreference(preference, enabled);
				if (preference === 'native-media' && enabled && result === true
					&& !nativeMediaWasEnabled && options.nativeMediaEnabled() && queueDispatcher !== null) {
					const queued = Object.freeze(queue.list().filter((record) => record.state === 'queued'));
					if (queued.length > 0) {
						void queueDispatcher.dispatch(queued).catch(
							(error: unknown) => options.onWatchError?.(error),
						);
					}
				}
				return result;
			}
			: undefined;
		const lifecycle = new FramescaperNativeServicesLifecycleV3({
			queue,
			roots,
			watch,
			scratch,
			lease: () => lease!.lease(),
			now,
			watchCoordinator,
			...(options.mintOpaqueId ? { mintOpaqueId: options.mintOpaqueId } : {}),
			...(options.mintJobId ? { mintJobId: options.mintJobId } : {}),
			...(options.selectRoot ? { selectRoot: options.selectRoot } : {}),
			...(options.probeRoot ? { probeRoot: options.probeRoot } : {}),
			reauthorizeQueue: async (record, root) => revalidate({
				record, root, rootAuthorized: true,
			}),
			...(options.scratchCleanup ? { scratchCleanup: options.scratchCleanup } : {}),
			...(options.publicationPortFor ? { publicationPortFor: options.publicationPortFor } : {}),
			...(publicationFence ? {
				publicationFenceFor: (record: NativeQueueRecordV3, root: FramescaperNativeRootGrant) => (
					publicationFence.for(record, root)
				),
			} : {}),
			...(options.removeRenderInputs ? { removeRenderInputs: options.removeRenderInputs } : {}),
			...(options.checkpointInspectFor ? { checkpointInspectFor: options.checkpointInspectFor } : {}),
			...(options.checkpointStore ? { checkpointStore: options.checkpointStore } : {}),
			...(options.externalDisplay ? { externalDisplay: options.externalDisplay } : {}),
			...(queueDispatcher ? {
				onQueueEnqueued: (record: NativeQueueRecordV3) => {
					void queueDispatcher.dispatch([record]).catch((error: unknown) => options.onWatchError?.(error));
				},
			} : {}),
		});
		const controller = new FramescaperNativeServicesControllerV3({
			queue,
			roots,
			watch,
			lifecycle,
			lease: () => lease!.lease(),
			now,
			runtimeAvailable: options.runtimeAvailable,
			nativeMediaEnabled: options.nativeMediaEnabled,
			...(options.preferences ? { preferences: options.preferences } : {}),
			...(options.capabilities ? { capabilities: options.capabilities } : {}),
			...(options.watchProjectState ? { projectState: options.watchProjectState } : {}),
			...(setPreference ? { setPreference } : {}),
			...(options.reserveQueue ? { reserveQueue: options.reserveQueue } : {}),
			rootDisplayName: (grant) => basename(grant.rootPath) || 'Authorized folder',
			...(queueDispatcher ? {
				onQueueControl: (record, action) => queueDispatcher.control(record, action),
			} : {}),
		});
		let shutdownRequested = false;
		const ready = (async () => {
			if (shutdownRequested) return;
			for (const record of queue.list()) {
				if (record.state === 'running' && recordAwaitsCarrierRegeneration(record)) {
					queue.control(record.jobId, { kind: 'await-carrier-regeneration' }, lease!.lease(), now());
				}
			}
			const current = queue.list().filter(nativeQueueRecordNeedsRecoveryRevalidation);
			const revalidations = new Map(await Promise.all(current.map(async (record) => {
				const root = roots.read(record.rootGrantId);
				return [record.jobId, await revalidate({
					record, root, rootAuthorized: root !== null && root.revokedAtMs === null,
				})] as const;
			})));
			const recovered = queue.recover(lease!.lease(), now(), (record) => {
				const result = revalidations.get(record.jobId);
				if (!result) throw new Error('Native queue recovery lost its exact revalidation result.');
				return result;
			});
			options.onRecovery?.(recovered);
			if (shutdownRequested) return;
			await watchCoordinator.start();
			if (shutdownRequested) { watchCoordinator.stop(); return; }
			const dispatchable = Object.freeze(recovered
				.filter((row) => row.record.state === 'queued')
				.map((row) => row.record));
			if (dispatchable.length > 0) await options.dispatchRecovered?.(dispatchable);
			if (dispatchable.length > 0 && queueDispatcher !== null) {
				void queueDispatcher.dispatch(dispatchable).catch(
					(error: unknown) => options.onWatchError?.(error),
				);
			}
		})();
		let closing: Promise<boolean> | null = null;
		return Object.freeze({
			databaseVersion,
			controller,
			queue,
			roots,
			watch,
			scratch,
			lease,
			lifecycle,
			watchCoordinator,
			queueDispatcher,
			publicationFence,
			ready,
			close: () => {
				if (closing !== null) return closing;
				shutdownRequested = true;
				controller.beginShutdown();
				watchCoordinator.stop();
				closing = (async () => {
					const failures: unknown[] = [];
					try { await queueDispatcher?.dispose('shutdown'); } catch (error) { failures.push(error); }
					try { await ready; } catch (error) { failures.push(error); }
					try { await controller.drain(); } catch (error) { failures.push(error); }
					try { await watchCoordinator.drain(); } catch (error) { failures.push(error); }
					try { await options.externalDisplay?.dispose?.(); } catch (error) { failures.push(error); }
					lease!.stop();
					database.close();
					if (failures.length > 0) throw new AggregateError(failures, 'Native-services shutdown failed.');
					return true;
				})();
				return closing;
			},
		});
	} catch (error) {
		lease?.stop();
		database.close();
		throw error;
	}
}

function recordAwaitsCarrierRegeneration(record: NativeQueueRecordV3): boolean {
	try { return nativeQueueRecordRequiresRendererCarrier(record); }
	catch { return false; }
}

function queueOperationUsable(
	options: FramescaperNativeServicesRuntimeV3Options,
	record: NativeQueueRecordV3,
): boolean {
	if (!options.runtimeAvailable() || !options.nativeMediaEnabled() || !options.capabilities) return false;
	const snapshot = options.capabilities();
	const render = nativeMediaCapabilityEntry(snapshot,
		NATIVE_MEDIA_CAPABILITY_IDS.renderQueue.domain, NATIVE_MEDIA_CAPABILITY_IDS.renderQueue.id);
	if (!isNativeMediaCapabilityUsable(render)) return false;
	if (record.taskKind !== 'proxy-generation') return true;
	return isNativeMediaCapabilityUsable(nativeMediaCapabilityEntry(snapshot,
		NATIVE_MEDIA_CAPABILITY_IDS.proxyCodec.domain, NATIVE_MEDIA_CAPABILITY_IDS.proxyCodec.id));
}

function failClosedRevalidation(
	context: Readonly<{ readonly record: NativeQueueRecordV3; readonly rootAuthorized: boolean }>,
): NativeQueueRevalidationV1 {
	return Object.freeze({
		projectRevisionMatches: false,
		planFingerprintMatches: true,
		inputFingerprintsMatch: false,
		rootGrantAuthorized: context.rootAuthorized,
		rootGrantValid: false,
		licensingCleared: false,
		helperBuildMatches: false,
		scratchIdentityMatches: false,
	});
}
