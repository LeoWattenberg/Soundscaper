/* SPDX-License-Identifier: AGPL-3.0-only */

import { basename } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { NativeQueueRecordV2 } from '../src/common/editor/native-queue-record.ts';
import {
	NATIVE_MEDIA_CAPABILITY_IDS,
	isNativeMediaCapabilityUsable,
	nativeMediaCapabilityEntry,
	type NativeMediaCapabilitySnapshotV1,
} from '../src/common/editor/native-media-capability-snapshot.ts';
import type { NativeQueueRevalidationV1 } from '../src/common/editor/native-queue-state-machine.ts';
import {
	FramescaperNativeServicesController,
	type FramescaperNativeServicePreference,
	type FramescaperNativeServicePreferences,
} from './native-services-controller.ts';
import {
	FramescaperNativeServicesLifecycle,
	type FramescaperNativeExternalDisplayPort,
} from './native-services-lifecycle.ts';
import type { FramescaperNativePublicationPort, NativeImageSequenceCheckpointFrameV1 } from './native-services-publication.ts';
import type { FramescaperNativeCheckpointStore } from './native-services-checkpoint-recovery.ts';
import {
	initializeFramescaperNativeServicesDatabase,
} from './native-services-database.ts';
import {
	FramescaperNativeServicesLeaseCoordinator,
} from './native-services-lease-coordinator.ts';
import {
	FramescaperNativeMediaQueueDispatcher,
	type FramescaperNativeMediaQueueDispatcherOptions,
} from './native-media-queue-dispatcher.ts';
import {
	FramescaperNativeQueueRepository,
	nativeQueueRecordNeedsRecoveryRevalidation,
	type FramescaperNativeQueueRecovery,
} from './native-services-queue-repository.ts';
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
import { FramescaperNativePublicationFenceService } from './native-services-publication-fence.ts';

export interface FramescaperNativeServicesRuntimeOptions {
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
	readonly now?: () => number;
	readonly schedule?: (callback: () => void, delayMs: number) => unknown;
	readonly cancelSchedule?: (handle: unknown) => void;
	readonly onFenced?: (error: unknown) => void;
	readonly onWatchError?: (error: unknown) => void;
	readonly revalidate?: FramescaperNativeQueueRevalidator;
	readonly onRecovery?: (rows: readonly FramescaperNativeQueueRecovery[]) => void;
	readonly dispatchRecovered?: (
		records: readonly NativeQueueRecordV2[],
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
	readonly removeRenderInputs?: (record: NativeQueueRecordV2) => Promise<void>;
	readonly checkpointInspectFor?: (
		grant: FramescaperNativeRootGrant,
	) => (frame: NativeImageSequenceCheckpointFrameV1) => Promise<Readonly<{
		byteLength: number;
		sha256: string;
		symbolicLink: boolean;
	}> | null>;
	readonly checkpointStore?: FramescaperNativeCheckpointStore;
	readonly externalDisplay?: FramescaperNativeExternalDisplayPort;
	readonly nativeQueueExecution?: Pick<FramescaperNativeMediaQueueDispatcherOptions,
		'pool' | 'prepare' | 'concurrency' | 'onError'>;
}

export type FramescaperNativeQueueRevalidator = (
	context: Readonly<{
		record: NativeQueueRecordV2;
		readonly rootAuthorized: boolean;
		readonly root: FramescaperNativeRootGrant | null;
	}>,
) => NativeQueueRevalidationV1 | Promise<NativeQueueRevalidationV1>;

export interface FramescaperNativeServicesRuntime {
	readonly databaseVersion: number;
	readonly controller: FramescaperNativeServicesController;
	readonly queue: FramescaperNativeQueueRepository;
	readonly roots: FramescaperNativeRootRepository;
	readonly watch: FramescaperNativeWatchRepository;
	readonly scratch: FramescaperNativeScratchRepository;
	readonly lease: FramescaperNativeServicesLeaseCoordinator;
	readonly lifecycle: FramescaperNativeServicesLifecycle;
	readonly watchCoordinator: FramescaperNativeWatchCoordinator;
	readonly queueDispatcher: FramescaperNativeMediaQueueDispatcher | null;
	readonly publicationFence: FramescaperNativePublicationFenceService | null;
	readonly ready: Promise<void>;
	close(): Promise<boolean>;
}

/** Compose the process-lifetime repositories; no renderer ever receives the database or a path. */
export function startFramescaperNativeServicesRuntime(
	options: FramescaperNativeServicesRuntimeOptions,
): FramescaperNativeServicesRuntime {
	const database = new DatabaseSync(options.databasePath);
	let lease: FramescaperNativeServicesLeaseCoordinator | null = null;
	try {
		const databaseVersion = initializeFramescaperNativeServicesDatabase(database);
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
			? new FramescaperNativePublicationFenceService({
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
		const queueDispatcher = options.nativeQueueExecution
			? new FramescaperNativeMediaQueueDispatcher({
				queue, roots, lease: () => lease!.lease(), now,
				available: options.runtimeAvailable,
				nativeMediaEnabled: options.nativeMediaEnabled,
				...options.nativeQueueExecution,
			})
			: null;
		const lifecycle = new FramescaperNativeServicesLifecycle({
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
			...(options.scratchCleanup ? { scratchCleanup: options.scratchCleanup } : {}),
			...(options.publicationPortFor ? { publicationPortFor: options.publicationPortFor } : {}),
			...(publicationFence ? {
				publicationFenceFor: (record: NativeQueueRecordV2, root: FramescaperNativeRootGrant) => (
					publicationFence.for(record, root)
				),
			} : {}),
			...(options.removeRenderInputs ? { removeRenderInputs: options.removeRenderInputs } : {}),
			...(options.checkpointInspectFor ? { checkpointInspectFor: options.checkpointInspectFor } : {}),
			...(options.checkpointStore ? { checkpointStore: options.checkpointStore } : {}),
			...(options.externalDisplay ? { externalDisplay: options.externalDisplay } : {}),
			...(queueDispatcher ? {
				onQueueEnqueued: (record: NativeQueueRecordV2) => {
					void queueDispatcher.dispatch([record]).catch((error: unknown) => options.onWatchError?.(error));
				},
			} : {}),
		});
		const controller = new FramescaperNativeServicesController({
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
			...(options.setPreference ? { setPreference: options.setPreference } : {}),
			rootDisplayName: (grant) => basename(grant.rootPath) || 'Authorized folder',
			...(queueDispatcher ? {
				onQueueControl: (record, action) => queueDispatcher.control(record, action),
			} : {}),
		});
		let shutdownRequested = false;
		const ready = (async () => {
			if (shutdownRequested) return;
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
			if (dispatchable.length > 0) await queueDispatcher?.dispatch(dispatchable);
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
					try { await queueDispatcher?.dispose(); } catch (error) { failures.push(error); }
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

function queueOperationUsable(
	options: FramescaperNativeServicesRuntimeOptions,
	record: NativeQueueRecordV2,
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
	context: Readonly<{ readonly record: NativeQueueRecordV2; readonly rootAuthorized: boolean }>,
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
