/* SPDX-License-Identifier: AGPL-3.0-only */

import { compareCodeUnits } from '../code-unit-order.ts';
import {
	localModelByteCount,
	localModelId,
	normalizeLocalModelGarbageCollection,
	normalizeLocalModelInstallProgress,
	normalizeLocalModelInstallCancellation,
	normalizeLocalModelInstalledNotices,
	normalizeLocalModelManagerModel,
	normalizeLocalModelManagerStatus,
	normalizeLocalModelReconciliation,
	normalizeLocalModelRelocation,
	type LocalModelGarbageCollection,
	type LocalModelInstalledNotice,
	type LocalModelInstallProgress,
	type LocalModelManagerBridge,
	type LocalModelManagerModel,
	type LocalModelReconciliation,
	type LocalModelRelocation,
} from './local-model-manager-bridge.ts';

export type LocalModelManagerPhase = 'idle' | 'loading' | 'ready' | 'error';

export interface LocalModelManagerError {
	readonly modelId: string | null;
	readonly message: string;
}

export type LocalModelMaintenanceOperation = 'reconcile' | 'garbage-collect' | 'notices' | 'relocate';
export type LocalModelManagerResult =
	| Readonly<{ kind: 'reconcile'; value: LocalModelReconciliation }>
	| Readonly<{ kind: 'garbage-collect'; value: LocalModelGarbageCollection }>
	| Readonly<{ kind: 'relocate'; value: LocalModelRelocation }>;

export interface LocalModelManagerSnapshot {
	readonly phase: LocalModelManagerPhase;
	readonly runtimeAvailable: boolean | null;
	readonly runtimeReason: string | null;
	readonly models: readonly LocalModelManagerModel[];
	readonly busyModelIds: readonly string[];
	readonly installingModelIds: readonly string[];
	readonly cancellingModelIds: readonly string[];
	readonly progress: readonly LocalModelInstallProgress[];
	readonly maintenanceOperation: LocalModelMaintenanceOperation | null;
	readonly lastResult: LocalModelManagerResult | null;
	readonly notices: readonly LocalModelInstalledNotice[];
	readonly noticesLoaded: boolean;
	readonly error: LocalModelManagerError | null;
}

export interface LocalModelManagerStore {
	readonly getSnapshot: () => LocalModelManagerSnapshot;
	readonly subscribe: (listener: () => void) => () => void;
	readonly connect: () => () => void;
	readonly load: () => Promise<void>;
	readonly install: (modelId: string) => Promise<void>;
	readonly installPreseeded: (modelId: string) => Promise<void>;
	readonly cancelInstall: (modelId: string) => Promise<void>;
	readonly remove: (modelId: string) => Promise<void>;
	readonly reconcile: () => Promise<void>;
	readonly garbageCollect: () => Promise<void>;
	readonly showNotices: () => Promise<void>;
	readonly relocate: () => Promise<void>;
}

const EMPTY_SNAPSHOT: LocalModelManagerSnapshot = Object.freeze({
	phase: 'idle', runtimeAvailable: null, runtimeReason: null,
	models: Object.freeze([]), busyModelIds: Object.freeze([]),
	installingModelIds: Object.freeze([]), cancellingModelIds: Object.freeze([]),
	progress: Object.freeze([]), maintenanceOperation: null, lastResult: null,
	notices: Object.freeze([]), noticesLoaded: false, error: null,
});
const STORES = new WeakMap<LocalModelManagerBridge, LocalModelManagerStore>();

export function localModelManagerStoreFor(
	bridge: LocalModelManagerBridge,
): LocalModelManagerStore {
	const existing = STORES.get(bridge);
	if (existing) return existing;
	const store = createLocalModelManagerStore(bridge);
	STORES.set(bridge, store);
	return store;
}

export function createLocalModelManagerStore(
	bridge: LocalModelManagerBridge,
): LocalModelManagerStore {
	let snapshot = EMPTY_SNAPSHOT;
	let loadOperation: Promise<void> | null = null;
	let refreshGeneration = 0;
	let connectionCount = 0;
	let unsubscribeProgress: (() => void) | null = null;
	const listeners = new Set<() => void>();
	const activeModels = new Map<string, 'install' | 'preseed' | 'remove'>();
	const cancellingModels = new Set<string>();
	let maintenanceOperation: LocalModelMaintenanceOperation | null = null;
	const progressByModelId = new Map<string, LocalModelInstallProgress>();

	const publish = (changes: Partial<LocalModelManagerSnapshot>): void => {
		snapshot = Object.freeze({ ...snapshot, ...changes });
		for (const listener of listeners) listener();
	};

	const publishOperationState = (
		error: LocalModelManagerError | null = snapshot.error,
	): void => publish({
		busyModelIds: Object.freeze([...new Set([
			...activeModels.keys(), ...cancellingModels,
		])].sort(compareCodeUnits)),
		installingModelIds: Object.freeze([...activeModels]
			.filter(([, operation]) => operation !== 'remove')
			.map(([modelId]) => modelId).sort()),
		cancellingModelIds: Object.freeze([...cancellingModels].sort(compareCodeUnits)),
		progress: Object.freeze([...progressByModelId.values()]
			.sort((left, right) => compareCodeUnits(left.modelId, right.modelId))),
		maintenanceOperation,
		error,
	});

	const refresh = async (announceLoading: boolean): Promise<void> => {
		const generation = ++refreshGeneration;
		if (announceLoading) publish({ phase: 'loading', error: null });
		try {
			const status = normalizeLocalModelManagerStatus(await bridge.listAssistanceModels());
			if (generation !== refreshGeneration) return;
			publish({
				phase: 'ready', runtimeAvailable: status.runtimeAvailable,
				runtimeReason: status.runtimeReason, models: status.models,
				error: announceLoading ? null : snapshot.error,
			});
		} catch (error) {
			if (generation !== refreshGeneration) return;
			publish({
				phase: announceLoading ? 'error' : snapshot.phase,
				error: managerError(null, error),
			});
		}
	};

	const load = (): Promise<void> => {
		if (loadOperation) return loadOperation;
		loadOperation = refresh(true).finally(() => { loadOperation = null; });
		return loadOperation;
	};

	const install = async (rawModelId: string): Promise<void> => {
		const modelId = localModelId(rawModelId);
		const model = actionableModel(snapshot.models, modelId, 'installable');
		if (!model || activeModels.has(modelId) || cancellingModels.has(modelId)
			|| maintenanceOperation) return;
		activeModels.set(modelId, 'install');
		progressByModelId.delete(modelId);
		publishOperationState(null);
		try {
			normalizeLocalModelManagerModel(await bridge.installAssistanceModel(modelId));
			await refresh(false);
		} catch (error) {
			if (!cancellingModels.has(modelId)) publishOperationState(managerError(modelId, error));
		} finally {
			activeModels.delete(modelId);
			progressByModelId.delete(modelId);
			publishOperationState();
		}
	};

	const installPreseeded = async (rawModelId: string): Promise<void> => {
		const modelId = localModelId(rawModelId);
		const model = actionableModel(snapshot.models, modelId, 'installable');
		if (!model || activeModels.has(modelId) || cancellingModels.has(modelId)
			|| maintenanceOperation) return;
		activeModels.set(modelId, 'preseed');
		progressByModelId.delete(modelId);
		publishOperationState(null);
		try {
			const installed = await bridge.installPreseededAssistanceModel(modelId);
			if (installed !== null) {
				normalizeLocalModelManagerModel(installed);
				await refresh(false);
			}
		} catch (error) {
			if (!cancellingModels.has(modelId)) publishOperationState(managerError(modelId, error));
		} finally {
			activeModels.delete(modelId);
			progressByModelId.delete(modelId);
			publishOperationState();
		}
	};

	const cancelInstall = async (rawModelId: string): Promise<void> => {
		const modelId = localModelId(rawModelId);
		if (!activeModels.has(modelId) || activeModels.get(modelId) === 'remove'
			|| cancellingModels.has(modelId)) return;
		cancellingModels.add(modelId);
		publishOperationState(null);
		try {
			normalizeLocalModelInstallCancellation(
				await bridge.cancelAssistanceModelInstall(modelId),
			);
			await refresh(false);
		} catch (error) {
			publishOperationState(managerError(modelId, error));
		} finally {
			cancellingModels.delete(modelId);
			publishOperationState();
		}
	};

	const remove = async (rawModelId: string): Promise<void> => {
		const modelId = localModelId(rawModelId);
		const model = actionableModel(snapshot.models, modelId, 'installed');
		if (!model || activeModels.has(modelId) || cancellingModels.has(modelId)
			|| maintenanceOperation) return;
		activeModels.set(modelId, 'remove');
		publishOperationState(null);
		try {
			localModelByteCount(await bridge.removeAssistanceModel(modelId), 'reclaimed byte count');
			await refresh(false);
		} catch (error) {
			publishOperationState(managerError(modelId, error));
		} finally {
			activeModels.delete(modelId);
			progressByModelId.delete(modelId);
			publishOperationState();
		}
	};

	const canMaintain = (): boolean => maintenanceOperation === null
		&& activeModels.size === 0 && cancellingModels.size === 0;

	const reconcile = async (): Promise<void> => {
		if (!canMaintain()) return;
		maintenanceOperation = 'reconcile';
		publishOperationState(null);
		try {
			const value = normalizeLocalModelReconciliation(await bridge.reconcileAssistanceModels());
			publish({ lastResult: Object.freeze({ kind: 'reconcile', value }) });
			await refresh(false);
		} catch (error) {
			publishOperationState(managerError(null, error));
		} finally {
			maintenanceOperation = null;
			publishOperationState();
		}
	};

	const garbageCollect = async (): Promise<void> => {
		if (!canMaintain()) return;
		maintenanceOperation = 'garbage-collect';
		publishOperationState(null);
		try {
			const value = normalizeLocalModelGarbageCollection(
				await bridge.collectAssistanceModelGarbage(),
			);
			publish({ lastResult: Object.freeze({ kind: 'garbage-collect', value }) });
			await refresh(false);
		} catch (error) {
			publishOperationState(managerError(null, error));
		} finally {
			maintenanceOperation = null;
			publishOperationState();
		}
	};

	const showNotices = async (): Promise<void> => {
		if (!canMaintain()) return;
		maintenanceOperation = 'notices';
		publishOperationState(null);
		try {
			publish({
				notices: normalizeLocalModelInstalledNotices(
					await bridge.listAssistanceModelNotices(),
				),
				noticesLoaded: true,
			});
		} catch (error) {
			publishOperationState(managerError(null, error));
		} finally {
			maintenanceOperation = null;
			publishOperationState();
		}
	};

	const relocate = async (): Promise<void> => {
		if (!canMaintain()) return;
		maintenanceOperation = 'relocate';
		publishOperationState(null);
		try {
			const result = await bridge.relocateAssistanceModels();
			if (result !== null) {
				const value = normalizeLocalModelRelocation(result);
				publish({ lastResult: Object.freeze({ kind: 'relocate', value }) });
				await refresh(false);
			}
		} catch (error) {
			publishOperationState(managerError(null, error));
		} finally {
			maintenanceOperation = null;
			publishOperationState();
		}
	};

	const connect = (): (() => void) => {
		connectionCount += 1;
		if (connectionCount === 1) {
			unsubscribeProgress = bridge.onAssistanceInstallProgress((value) => {
				try {
					const progress = normalizeLocalModelInstallProgress(value);
					if (!activeModels.has(progress.modelId)
						|| activeModels.get(progress.modelId) === 'remove') return;
					progressByModelId.set(progress.modelId, progress);
					publishOperationState();
				} catch {
					// The preload validates this event too; malformed external events are ignored.
				}
			});
		}
		let connected = true;
		return () => {
			if (!connected) return;
			connected = false;
			connectionCount -= 1;
			if (connectionCount === 0) {
				unsubscribeProgress?.();
				unsubscribeProgress = null;
			}
		};
	};

	return Object.freeze({
		getSnapshot: () => snapshot,
		subscribe: (listener: () => void) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		connect, load, install, installPreseeded, cancelInstall, remove,
		reconcile, garbageCollect, showNotices, relocate,
	});
}

function actionableModel(
	models: readonly LocalModelManagerModel[],
	modelId: string,
	availability: LocalModelManagerModel['availability'],
): LocalModelManagerModel | null {
	const model = models.find((candidate) => candidate.modelId === modelId) ?? null;
	return model?.availability === availability ? model : null;
}

function managerError(modelId: string | null, value: unknown): LocalModelManagerError {
	const message = value instanceof Error && value.message.trim()
		? value.message.slice(0, 512)
		: 'The local-model operation failed.';
	return Object.freeze({ modelId, message });
}
