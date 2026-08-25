/* SPDX-License-Identifier: AGPL-3.0-only */

/** Explicit renderer session for one local-assistance job and its staged custody. */

import type { AssistanceOperation } from '../assistance/operation.ts';
import {
	LOCAL_ASSISTANCE_PROGRESS_PHASES,
	type LocalAssistanceBridge,
	type LocalAssistanceModel,
	type LocalAssistanceOutputClaim,
	type LocalAssistanceProgress,
	type LocalAssistanceUnavailableReason,
} from './local-assistance-bridge.ts';
import {
	localAssistanceModelCompatible,
	normalizeLocalAssistancePreparedMedia,
	normalizeLocalAssistanceSelectedMediaInventory,
	type LocalAssistanceSelectedMediaPreparationPort,
	type LocalAssistanceSelectedMediaSource,
} from './local-assistance-preparation.ts';
import {
	reviewLocalAssistanceOutput,
	type LocalAssistanceOutputReview,
} from './local-assistance-result-review.ts';

export type LocalAssistancePhase =
	| 'idle' | 'loading' | 'selection-required' | 'ready' | 'preparing' | 'running'
	| 'cancelling' | 'completed' | 'cancelled' | 'unavailable' | 'error';

export type LocalAssistanceUiUnavailableReason =
	| LocalAssistanceUnavailableReason
	| 'bridge-unavailable'
	| 'selection-required'
	| 'no-compatible-model';

export interface LocalAssistanceOutputBody {
	readonly claim: LocalAssistanceOutputClaim;
	readonly bytes: Blob;
	readonly review: LocalAssistanceOutputReview;
}

export interface LocalAssistanceValidatedResult {
	readonly operation: AssistanceOperation;
	readonly outputs: readonly LocalAssistanceOutputBody[];
}

export interface LocalAssistanceSnapshot {
	readonly phase: LocalAssistancePhase;
	readonly sources: readonly LocalAssistanceSelectedMediaSource[];
	readonly models: readonly LocalAssistanceModel[];
	readonly selectedSourceId: string | null;
	readonly selectedOperation: AssistanceOperation | null;
	readonly selectedModelId: string | null;
	readonly consent: boolean;
	readonly progress: LocalAssistanceProgress | null;
	readonly result: LocalAssistanceValidatedResult | null;
	readonly unavailableReason: LocalAssistanceUiUnavailableReason | null;
	readonly error: string | null;
	readonly canRun: boolean;
	readonly canCancel: boolean;
	readonly canReview: boolean;
	/** Canonical acceptance is intentionally outside this Milestone-7 UI slice. */
	readonly canAccept: false;
}

export interface LocalAssistanceSessionStore {
	getSnapshot(): LocalAssistanceSnapshot;
	subscribe(listener: () => void): () => void;
	connect(): () => void;
	load(): Promise<void>;
	selectSource(sourceId: string): void;
	selectOperation(operation: AssistanceOperation): void;
	selectModel(modelId: string): void;
	setConsent(consent: boolean): void;
	run(): Promise<void>;
	cancel(): Promise<void>;
	dispose(): Promise<void>;
}

interface StoreOptions {
	readonly bridge: LocalAssistanceBridge | null;
	readonly preparation: LocalAssistanceSelectedMediaPreparationPort | null;
}

const EMPTY_SOURCES = Object.freeze([]) as readonly LocalAssistanceSelectedMediaSource[];
const EMPTY_MODELS = Object.freeze([]) as readonly LocalAssistanceModel[];

export function createLocalAssistanceSessionStore(
	options: StoreOptions,
): LocalAssistanceSessionStore {
	const listeners = new Set<() => void>();
	let snapshot = freezeSnapshot({
		phase: 'idle', sources: EMPTY_SOURCES, models: EMPTY_MODELS,
		selectedSourceId: null, selectedOperation: null, selectedModelId: null,
		consent: false, progress: null, result: null, unavailableReason: null, error: null,
	});
	let progressDisconnect: (() => void) | null = null;
	let activeJobId: string | null = null;
	let activeOperation: AssistanceOperation | null = null;
	let preparationController: AbortController | null = null;
	let cancelRequested = false;
	let lastProgressSequence = -1;
	let lastProgressPhase = -1;
	let running: Promise<void> | null = null;
	let disposed = false;

	const emit = () => listeners.forEach((listener) => listener());
	const update = (change: Partial<LocalAssistanceSnapshot>) => {
		snapshot = freezeSnapshot({ ...snapshot, ...change });
		emit();
	};
	const connect = () => {
		if (!progressDisconnect && options.bridge) {
			progressDisconnect = options.bridge.onProgress((progress) => {
				if (progress.jobId !== activeJobId || progress.operation !== activeOperation
					|| progress.sequence <= lastProgressSequence) return;
				const phase = LOCAL_ASSISTANCE_PROGRESS_PHASES.indexOf(progress.phase);
				if (phase < lastProgressPhase) return;
				lastProgressSequence = progress.sequence;
				lastProgressPhase = phase;
				update({ progress });
			});
		}
		return () => {
			progressDisconnect?.();
			progressDisconnect = null;
		};
	};

	const load = async (): Promise<void> => {
		if (disposed) return;
		if (!options.preparation) {
			update({ phase: 'selection-required', sources: EMPTY_SOURCES, models: EMPTY_MODELS,
				unavailableReason: 'selection-required', error: null });
			return;
		}
		if (!options.bridge) {
			update({ phase: 'unavailable', sources: EMPTY_SOURCES, models: EMPTY_MODELS,
				unavailableReason: 'bridge-unavailable', error: null });
			return;
		}
		update({ phase: 'loading', unavailableReason: null, error: null, result: null });
		try {
			const [inventoryValue, modelValues] = await Promise.all([
				options.preparation.listSelectedMedia(), options.bridge.models(),
			]);
			if (disposed) return;
			const inventory = normalizeLocalAssistanceSelectedMediaInventory(inventoryValue);
			update({ phase: inventory.sources.length ? 'ready' : 'selection-required',
				sources: inventory.sources, models: modelValues,
				selectedSourceId: null, selectedOperation: null, selectedModelId: null,
				consent: false, unavailableReason: inventory.sources.length ? null : 'selection-required',
				error: null, progress: null, result: null });
		} catch {
			if (!disposed) update({ phase: 'error', error: 'Local assistance could not load its selected-media inventory.',
				unavailableReason: null });
		}
	};

	const selectSource = (sourceId: string): void => {
		if (!snapshot.sources.some((source) => source.sourceId === sourceId)) {
			throw new TypeError('The selected local-assistance source is unavailable.');
		}
		update({ phase: 'ready', selectedSourceId: sourceId, selectedOperation: null,
			selectedModelId: null, consent: false, progress: null, result: null,
			unavailableReason: null, error: null });
	};
	const selectOperation = (operation: AssistanceOperation): void => {
		const source = selectedSource(snapshot);
		if (!source?.operations.includes(operation)) {
			throw new TypeError('The selected media does not admit that assistance operation.');
		}
		const compatible = snapshot.models.filter((model) => localAssistanceModelCompatible(operation, model));
		update({ phase: compatible.length ? 'ready' : 'unavailable', selectedOperation: operation,
			selectedModelId: null, consent: false, progress: null, result: null,
			unavailableReason: compatible.length ? null : 'no-compatible-model', error: null });
	};
	const selectModel = (modelId: string): void => {
		const operation = snapshot.selectedOperation;
		const model = snapshot.models.find((candidate) => candidate.modelId === modelId);
		if (!operation || !model || !localAssistanceModelCompatible(operation, model)) {
			throw new TypeError('The selected local-assistance model is incompatible.');
		}
		update({ phase: 'ready', selectedModelId: modelId, consent: false, result: null,
			unavailableReason: null, error: null });
	};
	const setConsent = (consent: boolean): void => {
		if (typeof consent !== 'boolean') throw new TypeError('Local-processing consent must be explicit.');
		update({ consent });
	};

	const execute = async (): Promise<void> => {
		if (!snapshot.canRun || !options.bridge || !options.preparation) {
			throw new Error('The local-assistance selection is not ready to run.');
		}
		const sourceId = snapshot.selectedSourceId!;
		const operation = snapshot.selectedOperation!;
		const model = snapshot.models.find(({ modelId }) => modelId === snapshot.selectedModelId)!;
		cancelRequested = false;
		activeOperation = operation;
		lastProgressSequence = -1;
		lastProgressPhase = -1;
		update({ phase: 'preparing', progress: null, result: null, unavailableReason: null, error: null });
		let completed: LocalAssistanceValidatedResult | null = null;
		let unavailableReason: LocalAssistanceUnavailableReason | null = null;
		let consentDeclined = false;
		let failure: unknown = null;
		let released = false;
		try {
			preparationController = new AbortController();
			const preparedValue = await options.preparation.prepareSelectedMedia({
				sourceId, operation, signal: preparationController.signal,
			});
			preparationController = null;
			const prepared = normalizeLocalAssistancePreparedMedia(preparedValue, { sourceId, operation });
			if (cancelRequested) throw new CancelledSession();
			const job = await options.bridge.createJob();
			activeJobId = job.jobId;
			if (cancelRequested) throw new CancelledSession();
			const inputs = await Promise.all(prepared.inputs.map((input) => options.bridge!.stageInput({
				jobId: job.jobId, role: input.role, mediaType: input.mediaType,
				byteLength: input.bytes.size, bytes: input.bytes,
			})));
			if (cancelRequested) throw new CancelledSession();
			const outputs = await Promise.all(prepared.outputs.map((output) => options.bridge!.reserveOutput({
				jobId: job.jobId, role: output.role, mediaType: output.mediaType,
				maximumByteLength: output.maximumByteLength,
			})));
			if (cancelRequested) throw new CancelledSession();
			update({ phase: 'running' });
			const outcome = await options.bridge.run(Object.freeze({
				contractVersion: 1, jobId: job.jobId, operation,
				selectionFence: prepared.selectionFence,
				models: Object.freeze([Object.freeze({ modelId: model.modelId,
					version: model.version, artifactSha256s: model.artifactSha256s })]),
				inputs: Object.freeze(inputs), outputs: Object.freeze(outputs),
			}));
			if (cancelRequested) throw new CancelledSession();
			if (outcome.outcome === 'consent-declined') consentDeclined = true;
			else if (outcome.outcome === 'unavailable') unavailableReason = outcome.reason;
			else {
				const bodies = await Promise.all(outcome.result.outputs.map(async (claim) => {
					const bytes = await options.bridge!.readOutput({ jobId: job.jobId, claim });
					const review = await reviewLocalAssistanceOutput(claim, bytes);
					return Object.freeze({ claim, bytes, review });
				}));
				completed = Object.freeze({ operation, outputs: Object.freeze(bodies) });
			}
		} catch (error) {
			failure = error;
		} finally {
			preparationController = null;
			if (activeJobId !== null) {
				try { released = await options.bridge.release(activeJobId); }
				catch (error) { failure = error; }
			}
			activeJobId = null;
			activeOperation = null;
		}
		if (disposed) return;
		if (failure && !(failure instanceof CancelledSession)) {
			update({ phase: 'error', result: null, progress: null,
				error: 'The local-assistance operation failed.', unavailableReason: null });
		} else if (cancelRequested || consentDeclined || failure instanceof CancelledSession) {
			update({ phase: 'cancelled', result: null, progress: null, error: null, unavailableReason: null });
		} else if (!released) {
			update({ phase: 'error', result: null, progress: null,
				error: 'The local-assistance staging custody could not be released.', unavailableReason: null });
		} else if (unavailableReason) {
			update({ phase: 'unavailable', result: null, progress: null,
				error: null, unavailableReason });
		} else if (completed) {
			update({ phase: 'completed', result: completed, progress: null,
				error: null, unavailableReason: null });
		} else {
			update({ phase: 'error', result: null, progress: null,
				error: 'The local-assistance operation returned no validated result.', unavailableReason: null });
		}
	};

	const run = async (): Promise<void> => {
		if (running) return running;
		running = execute().finally(() => { running = null; });
		return running;
	};
	const cancel = async (): Promise<void> => {
		if (!running || !snapshot.canCancel || !options.bridge) return;
		cancelRequested = true;
		update({ phase: 'cancelling' });
		preparationController?.abort(new CancelledSession());
		if (activeJobId) {
			try { await options.bridge.cancel(activeJobId); }
			catch { /* The run path still owns the mandatory release attempt. */ }
		}
	};
	const dispose = async (): Promise<void> => {
		disposed = true;
		cancelRequested = true;
		preparationController?.abort(new CancelledSession());
		if (activeJobId && options.bridge) {
			try { await options.bridge.cancel(activeJobId); } catch { /* Release remains in run finally. */ }
		}
		await running;
		progressDisconnect?.();
		progressDisconnect = null;
		listeners.clear();
	};

	return Object.freeze({
		getSnapshot: () => snapshot,
		subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
		connect, load, selectSource, selectOperation, selectModel, setConsent, run, cancel, dispose,
	});
}

function freezeSnapshot(value: Omit<LocalAssistanceSnapshot,
	'canRun' | 'canCancel' | 'canReview' | 'canAccept'>): LocalAssistanceSnapshot {
	const source = selectedSource(value);
	const model = value.models.find(({ modelId }) => modelId === value.selectedModelId);
	const selectionReady = Boolean(source && value.selectedOperation
		&& source.operations.includes(value.selectedOperation)
		&& model && localAssistanceModelCompatible(value.selectedOperation, model));
	return Object.freeze({ ...value,
		canRun: value.phase === 'ready' && selectionReady && value.consent,
		canCancel: value.phase === 'preparing' || value.phase === 'running' || value.phase === 'cancelling',
		canReview: value.phase === 'completed' && Boolean(value.result?.outputs.length),
		canAccept: false,
	});
}

function selectedSource(value: Pick<LocalAssistanceSnapshot, 'sources' | 'selectedSourceId'>) {
	return value.sources.find(({ sourceId }) => sourceId === value.selectedSourceId) ?? null;
}

class CancelledSession extends Error {}
