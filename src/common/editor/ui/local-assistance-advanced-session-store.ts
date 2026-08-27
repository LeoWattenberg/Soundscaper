/* SPDX-License-Identifier: AGPL-3.0-only */

/** Advanced UI compatibility over one closed single-stage AssistanceWorkflow-v1 request. */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import type { AssistanceOperation } from '../assistance/operation.ts';
import {
	validateAssistanceWorkflow,
	type AssistanceAdvancedWorkflowId,
	type AssistanceWorkflowV1,
} from '../assistance/workflow.ts';
import { defaultAssistanceWorkflowSettingsV1 } from '../assistance/workflow-settings-v1.ts';
import type {
	LocalAssistanceBridge,
	LocalAssistanceModel,
	LocalAssistanceOutputClaim,
	LocalAssistanceProgress,
} from './local-assistance-bridge.ts';
import {
	assertLocalAssistanceShotDetectionReviewMode,
	localAssistanceModelCompatible,
	localAssistanceModelTaskSlots,
	localAssistanceOperationModelsAvailable,
	localAssistanceSelectedModels,
	normalizeLocalAssistancePreparedMedia,
	normalizeLocalAssistanceSelectedMediaInventory,
	type LocalAssistancePreparedMedia,
	type LocalAssistanceSelectedMediaPreparationPort,
	type LocalAssistanceSelectedMediaSource,
	type LocalAssistanceValidatedResultAcceptanceRequest,
} from './local-assistance-preparation.ts';
import { deriveLocalAssistanceReviewAuthority } from './local-assistance-review-authority.ts';
import { reviewLocalAssistanceOutput } from './local-assistance-result-review.ts';
import type {
	LocalAssistanceSessionStore,
	LocalAssistanceSnapshot,
	LocalAssistanceUiUnavailableReason,
} from './local-assistance-session-store.ts';

interface Options {
	readonly bridge: LocalAssistanceBridge | null;
	readonly preparation: LocalAssistanceSelectedMediaPreparationPort | null;
}

const EMPTY_SOURCES = Object.freeze([]) as readonly LocalAssistanceSelectedMediaSource[];
const EMPTY_MODELS = Object.freeze([]) as readonly LocalAssistanceModel[];
const EMPTY_MODEL_IDS = Object.freeze([]) as readonly string[];

export function createLocalAssistanceAdvancedWorkflowSessionStore(
	options: Options,
): LocalAssistanceSessionStore {
	const listeners = new Set<() => void>();
	let pendingAcceptance: LocalAssistanceValidatedResultAcceptanceRequest | null = null;
	let snapshot = freezeSnapshot({ phase: 'idle', sources: EMPTY_SOURCES, models: EMPTY_MODELS,
		selectedSourceId: null, selectedOperation: null, shotDetectionMode: 'fast',
		selectedModelIds: EMPTY_MODEL_IDS, consent: false, progress: null, result: null,
		unavailableReason: null, error: null, cleanup: null }, false);
	let activeJobId: string | null = null;
	let activeOperation: AssistanceOperation | null = null;
	let controller: AbortController | null = null;
	let progressDisconnect: (() => void) | null = null;
	let cancelRequested = false;
	let running: Promise<void> | null = null;
	let disposed = false;

	const workflow = options.bridge?.workflow ?? null;
	const emit = (): void => listeners.forEach((listener) => listener());
	const update = (change: Partial<LocalAssistanceSnapshot>): void => {
		snapshot = freezeSnapshot({ ...snapshot, ...change }, pendingAcceptance !== null
			&& typeof options.preparation?.acceptValidatedResult === 'function');
		emit();
	};
	const connect = (): (() => void) => {
		if (!progressDisconnect && workflow) {
			progressDisconnect = workflow.onProgress((progress) => {
				if (progress.jobId !== activeJobId || progress.workflowId !== advancedId(activeOperation)) return;
				update({ progress: workflowProgress(activeOperation!, progress) });
			});
		}
		return () => { progressDisconnect?.(); progressDisconnect = null; };
	};
	const load = async (): Promise<void> => {
		if (disposed) return;
		pendingAcceptance = null;
		if (!options.preparation) return unavailableSelection();
		if (!workflow?.custody || !workflow.readOutput
			|| typeof options.preparation.prepareAdvancedWorkflow !== 'function') {
			update({ phase: 'unavailable', sources: EMPTY_SOURCES, models: EMPTY_MODELS,
				unavailableReason: 'bridge-unavailable', error: null });
			return;
		}
		update({ phase: 'loading', unavailableReason: null, error: null, result: null });
		try {
			const [inventoryValue, models] = await Promise.all([
				options.preparation.listSelectedMedia(), options.bridge!.models(),
			]);
			if (disposed) return;
			const inventory = normalizeLocalAssistanceSelectedMediaInventory(inventoryValue);
			update({ phase: inventory.sources.length ? 'ready' : 'selection-required',
				sources: inventory.sources, models, selectedSourceId: null, selectedOperation: null,
				shotDetectionMode: 'fast', selectedModelIds: EMPTY_MODEL_IDS, consent: false,
				unavailableReason: inventory.sources.length ? null : 'selection-required',
				error: null, progress: null, result: null });
		} catch {
			if (!disposed) update({ phase: 'error', unavailableReason: null,
				error: 'Local assistance could not load its selected-media inventory.' });
		}
	};
	const unavailableSelection = (): void => update({ phase: 'selection-required',
		sources: EMPTY_SOURCES, models: EMPTY_MODELS, unavailableReason: 'selection-required', error: null });
	const selectSource = (sourceId: string): void => {
		if (!snapshot.sources.some((source) => source.sourceId === sourceId)) {
			throw new TypeError('The selected local-assistance source is unavailable.');
		}
		pendingAcceptance = null;
		update({ phase: 'ready', selectedSourceId: sourceId, selectedOperation: null,
			shotDetectionMode: 'fast', selectedModelIds: EMPTY_MODEL_IDS, consent: false,
			progress: null, result: null, unavailableReason: null, error: null, cleanup: null });
	};
	const selectOperation = (operation: AssistanceOperation): void => {
		const source = selectedSource(snapshot);
		if (!source?.operations.includes(operation)) {
			throw new TypeError('The selected media does not admit that assistance operation.');
		}
		pendingAcceptance = null;
		const available = localAssistanceOperationModelsAvailable(operation, snapshot.models,
			operation === 'shot-detection' ? 'fast' : undefined);
		update({ phase: available ? 'ready' : 'unavailable', selectedOperation: operation,
			shotDetectionMode: 'fast', selectedModelIds: EMPTY_MODEL_IDS, consent: false,
			progress: null, result: null, unavailableReason: available ? null : 'no-compatible-model',
			error: null, cleanup: null });
	};
	const selectShotDetectionMode = (mode: 'fast' | 'accurate'): void => {
		if (snapshot.selectedOperation !== 'shot-detection' || !['fast', 'accurate'].includes(mode)) {
			throw new TypeError('Only Mark Cuts has a supported detection mode.');
		}
		pendingAcceptance = null;
		const available = localAssistanceOperationModelsAvailable('shot-detection', snapshot.models, mode);
		update({ phase: available ? 'ready' : 'unavailable', shotDetectionMode: mode,
			selectedModelIds: EMPTY_MODEL_IDS, consent: false, progress: null, result: null,
			unavailableReason: available ? null : 'no-compatible-model', error: null });
	};
	const selectModel = (modelId: string): void => {
		const operation = snapshot.selectedOperation;
		const model = snapshot.models.find((candidate) => candidate.modelId === modelId);
		const mode = operation === 'shot-detection' ? snapshot.shotDetectionMode : undefined;
		if (!operation || !model || !localAssistanceModelCompatible(operation, model, mode)) {
			throw new TypeError('The selected local-assistance model is incompatible.');
		}
		pendingAcceptance = null;
		update({ phase: 'ready', selectedModelIds: selectModelIds(snapshot, model), consent: false,
			progress: null, result: null, unavailableReason: null, error: null });
	};
	const setConsent = (consent: boolean): void => {
		if (typeof consent !== 'boolean') throw new TypeError('Local-processing consent must be explicit.');
		update({ consent });
	};

	const execute = async (): Promise<void> => {
		if (!snapshot.canRun || !workflow?.custody || !workflow.readOutput || !options.preparation
			|| typeof options.preparation.prepareAdvancedWorkflow !== 'function') {
			throw new Error('The Advanced assistance selection is not ready to run.');
		}
		const sourceId = snapshot.selectedSourceId!;
		const operation = snapshot.selectedOperation!;
		const mode = operation === 'shot-detection' ? snapshot.shotDetectionMode : undefined;
		const models = localAssistanceSelectedModels(
			operation, snapshot.models, snapshot.selectedModelIds, mode,
		)!;
		const workflowId = advancedId(operation)!;
		cancelRequested = false;
		activeOperation = operation;
		pendingAcceptance = null;
		update({ phase: 'preparing', progress: null, result: null,
			unavailableReason: null, error: null, cleanup: null });
		let completed: LocalAssistanceSnapshot['result'] = null;
		let acceptance: LocalAssistanceValidatedResultAcceptanceRequest | null = null;
		let unavailableReason: LocalAssistanceUiUnavailableReason | null = null;
		let consentDeclined = false;
		let failure: unknown = null;
		let released = false;
		try {
			controller = new AbortController();
			const signal = controller.signal;
			const job = await workflow.createJob();
			activeJobId = job.jobId;
			const preparedValue = await options.preparation.prepareAdvancedWorkflow({ jobId: job.jobId,
				workflowId, sourceId, operation, ...(mode ? { shotDetectionMode: mode } : {}),
				settings: defaultAssistanceWorkflowSettingsV1(workflowId), models,
				custody: workflow.custody, signal });
			const prepared = normalizeAdvancedPreparation(preparedValue, job.jobId, workflowId,
				sourceId, operation, mode, models);
			if (prepared.outcome === 'unavailable') {
				unavailableReason = prepared.reason === 'model-binding-unavailable'
					? 'no-compatible-model' : 'bridge-unavailable';
			} else {
				const authority = await deriveLocalAssistanceReviewAuthority(prepared.prepared);
				signal.throwIfAborted();
				update({ phase: 'running' });
				const outcome = await workflow.run(prepared.workflow);
				signal.throwIfAborted();
				if (outcome.outcome === 'consent-declined') consentDeclined = true;
				else if (outcome.outcome === 'unavailable') unavailableReason = mapUnavailable(outcome.reason);
				else {
					const bodies = await Promise.all(outcome.result.outputs.map(async (claim, index) => {
						const output = prepared.prepared.outputs[index];
						if (!output || claim.slotId !== (output.slotId ?? output.role)) {
							throw new TypeError('Advanced output custody lost its canonical slot order.');
						}
						const bytes = await workflow.readOutput!({ jobId: job.jobId, workflowId, claim });
						const outputClaim = await reviewedClaim(claim.claimId, job.jobId,
							output.role, bytes, signal);
						const review = await reviewLocalAssistanceOutput(outputClaim, bytes, authority);
						if (mode) assertLocalAssistanceShotDetectionReviewMode(mode, review);
						return Object.freeze({ ...(output.slotId ? { slotId: output.slotId } : {}),
							claim: outputClaim, bytes, review });
					}));
					completed = Object.freeze({ operation, outputs: Object.freeze(bodies) });
					acceptance = Object.freeze({ sourceId, operation,
						selectionFence: prepared.prepared.selectionFence, models,
						outputs: Object.freeze(bodies.map(({ slotId, claim, bytes, review }) => Object.freeze(
							slotId ? { slotId, claim, bytes, review } : { claim, review },
						))) });
				}
			}
		} catch (error) {
			failure = error;
		} finally {
			controller = null;
			if (activeJobId !== null) {
				try { released = await workflow.custody.release(activeJobId); }
				catch (error) { failure ??= error; }
			}
			activeJobId = null;
			activeOperation = null;
		}
		if (disposed) return;
		if (cancelRequested || failure instanceof AdvancedCancelledError || consentDeclined) {
			update({ phase: 'cancelled', progress: null, result: null, unavailableReason: null, error: null });
		} else if (failure) {
			update({ phase: 'error', progress: null, result: null, unavailableReason: null,
				error: failure instanceof Error ? failure.message : 'The Advanced workflow failed.' });
		} else if (!released) {
			update({ phase: 'error', progress: null, result: null, unavailableReason: null,
				error: 'The Advanced workflow custody could not be released.' });
		} else if (unavailableReason) {
			update({ phase: 'unavailable', progress: null, result: null, unavailableReason, error: null });
		} else if (completed && acceptance) {
			pendingAcceptance = acceptance;
			update({ phase: 'completed', progress: null, result: completed,
				unavailableReason: null, error: null });
		} else {
			update({ phase: 'error', progress: null, result: null, unavailableReason: null,
				error: 'The Advanced workflow returned no validated result.' });
		}
	};
	const run = async (): Promise<void> => {
		if (running) return running;
		running = execute().finally(() => { running = null; });
		return running;
	};
	const cancel = async (): Promise<void> => {
		if (!running || !snapshot.canCancel || !workflow) return;
		cancelRequested = true;
		update({ phase: 'cancelling' });
		controller?.abort(new AdvancedCancelledError());
		if (activeJobId) await workflow.cancel(activeJobId).catch(() => undefined);
	};
	const accept = async (): Promise<void> => {
		const request = pendingAcceptance;
		const port = options.preparation?.acceptValidatedResult;
		if (!snapshot.canAccept || !request || !port) throw new Error('No reviewed proposal is ready.');
		pendingAcceptance = null;
		update({ phase: 'accepting', error: null });
		try {
			await port.call(options.preparation, request);
			if (!disposed) update({ phase: 'accepted', error: null });
		} catch (error) {
			if (!disposed) update({ phase: 'error', unavailableReason: null,
				error: error instanceof Error ? error.message : 'The proposal could not be accepted.' });
		}
	};
	const unsupportedCleanup = async (): Promise<never> => {
		throw new Error('Primitive Advanced review does not expose Guided transcript cleanup.');
	};
	const dispose = async (): Promise<void> => {
		disposed = true;
		pendingAcceptance = null;
		cancelRequested = true;
		controller?.abort(new AdvancedCancelledError());
		if (activeJobId && workflow) await workflow.cancel(activeJobId).catch(() => undefined);
		await running;
		progressDisconnect?.();
		progressDisconnect = null;
		listeners.clear();
	};
	return Object.freeze({ getSnapshot: () => snapshot,
		subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
		connect, load, selectSource, selectOperation, selectShotDetectionMode, selectModel, setConsent,
		run, cancel, accept, prepareTranscriptCleanup: unsupportedCleanup,
		setTranscriptCleanupProposalSelected() { throw new Error('Advanced cleanup review is unavailable.'); },
		acceptTranscriptCleanup: unsupportedCleanup, rejectTranscriptCleanup: unsupportedCleanup, dispose });
}

type PreparedOutcome = Readonly<{ outcome: 'prepared'; workflow: AssistanceWorkflowV1;
	prepared: LocalAssistancePreparedMedia }> | Readonly<{ outcome: 'unavailable';
	reason: 'aggregate-custody-unavailable' | 'model-binding-unavailable' }>;

function normalizeAdvancedPreparation(
	value: unknown, jobId: string, workflowId: AssistanceAdvancedWorkflowId,
	sourceId: string, operation: AssistanceOperation, mode: 'fast' | 'accurate' | undefined,
	models: readonly LocalAssistanceModel[],
): PreparedOutcome {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Advanced preparation returned a malformed outcome.');
	}
	const row = value as Record<string, unknown>;
	if (row.outcome === 'unavailable') {
		const reason = row.reason === 'aggregate-custody-unavailable'
			|| row.reason === 'model-binding-unavailable' ? row.reason : null;
		if (Object.keys(row).length !== 2 || reason === null) {
			throw new TypeError('Advanced preparation returned an unsupported refusal.');
		}
		return Object.freeze({ outcome: 'unavailable', reason });
	}
	if (row.outcome !== 'prepared' || Object.keys(row).length !== 3) {
		throw new TypeError('Advanced preparation returned a malformed prepared outcome.');
	}
	const workflow = validateAssistanceWorkflow(row.workflow);
	if (workflow.jobId !== jobId || workflow.workflowId !== workflowId
		|| workflow.stageIds.length !== 1 || workflow.stageIds[0] !== `run-${operation}`
		|| JSON.stringify(workflow.settings) !== JSON.stringify(defaultAssistanceWorkflowSettingsV1(workflowId))) {
		throw new TypeError('Advanced preparation lost exact workflow authority.');
	}
	const prepared = normalizeLocalAssistancePreparedMedia(row.prepared, { sourceId, operation,
		...(mode ? { shotDetectionMode: mode } : {}) });
	const bound = workflow.models.map(({ modelId, version, artifactSha256s }) => ({
		modelId, version, artifactSha256s,
	}));
	if (JSON.stringify(bound) !== JSON.stringify(models.map(({ modelId, version, artifactSha256s }) => ({
		modelId, version, artifactSha256s: [...artifactSha256s].sort(),
	})))) throw new TypeError('Advanced preparation changed its selected models.');
	return Object.freeze({ outcome: 'prepared', workflow, prepared });
}

async function reviewedClaim(
	claimId: string, jobId: string, role: LocalAssistanceOutputClaim['role'], body: Blob,
	signal: AbortSignal,
): Promise<LocalAssistanceOutputClaim> {
	const digest = sha256.create();
	const reader = body.stream().getReader();
	try {
		while (true) {
			signal.throwIfAborted();
			const chunk = await reader.read();
			if (chunk.done) break;
			digest.update(chunk.value);
		}
	} finally {
		await reader.cancel().catch(() => undefined);
		reader.releaseLock();
	}
	return Object.freeze({ claimVersion: 1, claimId, jobId, role, mediaType: body.type,
		byteLength: body.size, sha256: bytesToHex(digest.digest()) });
}

function workflowProgress(
	operation: AssistanceOperation,
	progress: Readonly<{ jobId: string; sequence: number; phase: LocalAssistanceProgress['phase'];
		completed: number | null; total: number | null }>,
): LocalAssistanceProgress {
	return Object.freeze({ contractVersion: 1, jobId: progress.jobId, operation,
		sequence: progress.sequence, phase: progress.phase,
		completed: progress.completed, total: progress.total });
}

function mapUnavailable(reason: string): LocalAssistanceUiUnavailableReason {
	if (reason === 'model-unavailable') return 'model-unavailable';
	if (reason === 'stage-unavailable') return 'adapter-unavailable';
	return 'runtime-unavailable';
}

function freezeSnapshot(
	value: Omit<LocalAssistanceSnapshot,
		'canRun' | 'canCancel' | 'canReview' | 'canAccept' | 'canPrepareTranscriptCleanup'>,
	acceptanceAvailable: boolean,
): LocalAssistanceSnapshot {
	const source = selectedSource(value);
	const mode = value.selectedOperation === 'shot-detection' ? value.shotDetectionMode : undefined;
	const models = value.selectedOperation === null ? null : localAssistanceSelectedModels(
		value.selectedOperation, value.models, value.selectedModelIds, mode,
	);
	const ready = Boolean(source && value.selectedOperation
		&& source.operations.includes(value.selectedOperation) && models);
	return Object.freeze({ ...value, canRun: value.phase === 'ready' && ready,
		canCancel: ['preparing', 'running', 'cancelling'].includes(value.phase),
		canReview: value.phase === 'completed' && Boolean(value.result?.outputs.length),
		canAccept: value.phase === 'completed' && Boolean(value.result?.outputs.length)
			&& acceptanceAvailable,
		canPrepareTranscriptCleanup: false });
}

function selectedSource(value: Pick<LocalAssistanceSnapshot, 'sources' | 'selectedSourceId'>) {
	return value.sources.find(({ sourceId }) => sourceId === value.selectedSourceId) ?? null;
}

function selectModelIds(snapshot: LocalAssistanceSnapshot, selected: LocalAssistanceModel): readonly string[] {
	const operation = snapshot.selectedOperation!;
	const mode = operation === 'shot-detection' ? snapshot.shotDetectionMode : undefined;
	const slot = localAssistanceModelTaskSlots(operation, mode)
		.find((candidate) => candidate.includes(selected.task))!;
	const current = snapshot.selectedModelIds.map(
		(modelId) => snapshot.models.find((model) => model.modelId === modelId),
	).filter((model): model is LocalAssistanceModel => model !== undefined && !slot.includes(model.task));
	current.push(selected);
	return Object.freeze(localAssistanceModelTaskSlots(operation, mode).flatMap((candidate) => {
		const model = current.find(({ task }) => candidate.includes(task));
		return model ? [model.modelId] : [];
	}));
}

function advancedId(operation: AssistanceOperation | null): AssistanceAdvancedWorkflowId | null {
	return operation === null ? null : `advanced:${operation}`;
}

class AdvancedCancelledError extends Error {}
