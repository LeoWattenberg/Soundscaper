/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AssistanceOperation } from '../assistance/operation.ts';
import type { LocalAssistanceModel } from '../assistance/local-assistance-bridge.ts';
import {
	normalizeLocalAssistanceShotDetectionMode,
	type LocalAssistanceShotDetectionMode,
} from '../assistance/shot-detection-mode.ts';
import {
	localAssistanceModelCompatible,
	localAssistanceOperationModelsAvailable,
	localAssistanceReplaceSelectedModel,
	normalizeLocalAssistanceSelectedMediaInventory,
	type LocalAssistanceSelectedMediaSource,
} from '../assistance/local-assistance-preparation.ts';
import type { LocalAssistanceSnapshot } from './local-assistance-session-types.ts';

export const EMPTY_LOCAL_ASSISTANCE_SOURCES = Object.freeze(
	[],
) as readonly LocalAssistanceSelectedMediaSource[];
export const EMPTY_LOCAL_ASSISTANCE_MODELS = Object.freeze([]) as readonly LocalAssistanceModel[];
export const EMPTY_LOCAL_ASSISTANCE_MODEL_IDS = Object.freeze([]) as readonly string[];

type SelectionSnapshot = Pick<LocalAssistanceSnapshot,
	'sources' | 'models' | 'selectedSourceId' | 'selectedOperation' | 'selectedModelIds' | 'shotDetectionMode'>;
type SelectionChange = Partial<LocalAssistanceSnapshot>;

interface InventoryLoader {
	listSelectedMedia(): PromiseLike<unknown> | unknown;
	listModels(): PromiseLike<readonly LocalAssistanceModel[]> | readonly LocalAssistanceModel[];
	isCurrent(): boolean;
}

/** Load and reset the shared selected-media/model state for either assistance surface. */
export async function loadLocalAssistanceSelectionInventory(
	loader: InventoryLoader,
): Promise<SelectionChange | null> {
	const [inventoryValue, models] = await Promise.all([
		loader.listSelectedMedia(),
		loader.listModels(),
	]);
	if (!loader.isCurrent()) return null;
	const inventory = normalizeLocalAssistanceSelectedMediaInventory(inventoryValue);
	return {
		phase: inventory.sources.length ? 'ready' : 'selection-required',
		sources: inventory.sources,
		models,
		selectedSourceId: null,
		selectedOperation: null,
		selectedModelIds: EMPTY_LOCAL_ASSISTANCE_MODEL_IDS,
		shotDetectionMode: 'fast',
		consent: false,
		unavailableReason: inventory.sources.length ? null : 'selection-required',
		error: null,
		progress: null,
		result: null,
		cleanup: null,
	};
}

export function selectLocalAssistanceSource(
	snapshot: SelectionSnapshot,
	sourceId: string,
): SelectionChange {
	if (!snapshot.sources.some((source) => source.sourceId === sourceId)) {
		throw new TypeError('The selected local-assistance source is unavailable.');
	}
	return {
		phase: 'ready', selectedSourceId: sourceId, selectedOperation: null,
		shotDetectionMode: 'fast', selectedModelIds: EMPTY_LOCAL_ASSISTANCE_MODEL_IDS,
		consent: false, progress: null, result: null,
		unavailableReason: null, error: null, cleanup: null,
	};
}

export function selectLocalAssistanceOperation(
	snapshot: SelectionSnapshot,
	operation: AssistanceOperation,
): SelectionChange {
	const source = selectedSource(snapshot);
	if (!source?.operations.includes(operation)) {
		throw new TypeError('The selected media does not admit that assistance operation.');
	}
	const available = localAssistanceOperationModelsAvailable(operation, snapshot.models,
		operation === 'shot-detection' ? 'fast' : undefined);
	return {
		phase: available ? 'ready' : 'unavailable', selectedOperation: operation,
		shotDetectionMode: 'fast', selectedModelIds: EMPTY_LOCAL_ASSISTANCE_MODEL_IDS,
		consent: false, progress: null, result: null,
		unavailableReason: available ? null : 'no-compatible-model', error: null, cleanup: null,
	};
}

export function selectLocalAssistanceShotDetectionMode(
	snapshot: SelectionSnapshot,
	value: LocalAssistanceShotDetectionMode,
): SelectionChange {
	if (snapshot.selectedOperation !== 'shot-detection') {
		throw new TypeError('Only Mark Cuts has a detection mode.');
	}
	const mode = normalizeLocalAssistanceShotDetectionMode(value);
	const available = localAssistanceOperationModelsAvailable('shot-detection', snapshot.models, mode);
	return {
		phase: available ? 'ready' : 'unavailable', shotDetectionMode: mode,
		selectedModelIds: EMPTY_LOCAL_ASSISTANCE_MODEL_IDS, consent: false,
		progress: null, result: null,
		unavailableReason: available ? null : 'no-compatible-model', error: null, cleanup: null,
	};
}

export function selectLocalAssistanceModel(
	snapshot: SelectionSnapshot,
	modelId: string,
): SelectionChange {
	const operation = snapshot.selectedOperation;
	const model = snapshot.models.find((candidate) => candidate.modelId === modelId);
	const mode = operation === 'shot-detection' ? snapshot.shotDetectionMode : undefined;
	if (!operation || !model || !localAssistanceModelCompatible(operation, model, mode)) {
		throw new TypeError('The selected local-assistance model is incompatible.');
	}
	const available = localAssistanceOperationModelsAvailable(operation, snapshot.models, mode);
	return {
		phase: available ? 'ready' : 'unavailable',
		selectedModelIds: localAssistanceReplaceSelectedModel(
			operation, snapshot.models, snapshot.selectedModelIds, model, mode,
		),
		consent: false, result: null, cleanup: null,
		unavailableReason: available ? null : 'no-compatible-model', error: null,
	};
}

export function localAssistanceConsentChange(consent: boolean): SelectionChange {
	if (typeof consent !== 'boolean') throw new TypeError('Local-processing consent must be explicit.');
	return { consent };
}

export function createLocalAssistanceListenerAuthority(): Readonly<{
	emit(): void;
	subscribe(listener: () => void): () => void;
	clear(): void;
}> {
	const listeners = new Set<() => void>();
	return Object.freeze({
		emit: () => { listeners.forEach((listener) => { listener(); }); },
		subscribe: (listener: () => void) => {
			listeners.add(listener);
			return () => { listeners.delete(listener); };
		},
		clear: () => { listeners.clear(); },
	});
}

function selectedSource(snapshot: SelectionSnapshot): LocalAssistanceSelectedMediaSource | null {
	return snapshot.sources.find((source) => source.sourceId === snapshot.selectedSourceId) ?? null;
}
