/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	localModelByteCount,
	localModelId,
	normalizeLocalModelInstallProgress,
	normalizeLocalModelManagerModel,
	normalizeLocalModelManagerStatus,
	type LocalModelInstallProgress,
	type LocalModelManagerBridge,
	type LocalModelManagerModel,
} from './local-model-manager-bridge.ts';

export type LocalModelManagerPhase = 'idle' | 'loading' | 'ready' | 'error';

export interface LocalModelManagerError {
	readonly modelId: string | null;
	readonly message: string;
}

export interface LocalModelManagerSnapshot {
	readonly phase: LocalModelManagerPhase;
	readonly runtimeAvailable: boolean | null;
	readonly runtimeReason: string | null;
	readonly models: readonly LocalModelManagerModel[];
	readonly busyModelIds: readonly string[];
	readonly progress: readonly LocalModelInstallProgress[];
	readonly error: LocalModelManagerError | null;
}

export interface LocalModelManagerStore {
	readonly getSnapshot: () => LocalModelManagerSnapshot;
	readonly subscribe: (listener: () => void) => () => void;
	readonly connect: () => () => void;
	readonly load: () => Promise<void>;
	readonly install: (modelId: string) => Promise<void>;
	readonly remove: (modelId: string) => Promise<void>;
}

const EMPTY_SNAPSHOT: LocalModelManagerSnapshot = Object.freeze({
	phase: 'idle', runtimeAvailable: null, runtimeReason: null,
	models: Object.freeze([]), busyModelIds: Object.freeze([]),
	progress: Object.freeze([]), error: null,
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
	let connectionCount = 0;
	let unsubscribeProgress: (() => void) | null = null;
	const listeners = new Set<() => void>();
	const activeModels = new Set<string>();
	const progressByModelId = new Map<string, LocalModelInstallProgress>();

	const publish = (changes: Partial<LocalModelManagerSnapshot>): void => {
		snapshot = Object.freeze({ ...snapshot, ...changes });
		for (const listener of listeners) listener();
	};

	const publishOperationState = (
		error: LocalModelManagerError | null = snapshot.error,
	): void => publish({
		busyModelIds: Object.freeze([...activeModels].sort()),
		progress: Object.freeze([...progressByModelId.values()]
			.sort((left, right) => left.modelId.localeCompare(right.modelId))),
		error,
	});

	const refresh = async (announceLoading: boolean): Promise<void> => {
		if (announceLoading) publish({ phase: 'loading', error: null });
		try {
			const status = normalizeLocalModelManagerStatus(await bridge.listAssistanceModels());
			publish({
				phase: 'ready', runtimeAvailable: status.runtimeAvailable,
				runtimeReason: status.runtimeReason, models: status.models, error: null,
			});
		} catch (error) {
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
		if (!model || activeModels.has(modelId)) return;
		activeModels.add(modelId);
		progressByModelId.delete(modelId);
		publishOperationState(null);
		try {
			normalizeLocalModelManagerModel(await bridge.installAssistanceModel(modelId));
			await refresh(false);
		} catch (error) {
			publishOperationState(managerError(modelId, error));
		} finally {
			activeModels.delete(modelId);
			progressByModelId.delete(modelId);
			publishOperationState();
		}
	};

	const remove = async (rawModelId: string): Promise<void> => {
		const modelId = localModelId(rawModelId);
		const model = actionableModel(snapshot.models, modelId, 'installed');
		if (!model || activeModels.has(modelId)) return;
		activeModels.add(modelId);
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

	const connect = (): (() => void) => {
		connectionCount += 1;
		if (connectionCount === 1) {
			unsubscribeProgress = bridge.onAssistanceInstallProgress((value) => {
				try {
					const progress = normalizeLocalModelInstallProgress(value);
					if (!activeModels.has(progress.modelId)) return;
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
		connect, load, install, remove,
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
