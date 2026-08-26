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
	localAssistanceModelTaskSlots,
	localAssistanceOperationModelsAvailable,
	localAssistanceSelectedModels,
	normalizeLocalAssistancePreparedMedia,
	normalizeLocalAssistanceSelectedMediaInventory,
	type LocalAssistanceSelectedMediaPreparationPort,
	type LocalAssistanceSelectedMediaSource,
	type LocalAssistanceValidatedResultAcceptanceRequest,
} from './local-assistance-preparation.ts';
import {
	reviewLocalAssistanceOutput,
	type LocalAssistanceOutputReview,
} from './local-assistance-result-review.ts';
import {
	createLocalAssistanceTranscriptCleanupPreparation,
	createLocalAssistanceTranscriptCleanupState,
	localAssistanceCleanupVoiceActivity,
	localAssistanceTranscriptCleanupEligible,
	localAssistanceTranscriptCleanupPortAvailable,
	normalizeLocalAssistanceTranscriptCleanupProposals,
	type LocalAssistanceTranscriptCleanupState,
	type LocalAssistanceTranscriptCleanupVoiceActivity,
} from './local-assistance-cleanup.ts';

export type LocalAssistancePhase =
	| 'idle' | 'loading' | 'selection-required' | 'ready' | 'preparing' | 'running'
	| 'cancelling' | 'completed' | 'accepting' | 'accepted'
	| 'cancelled' | 'unavailable' | 'error';

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
	readonly selectedModelIds: readonly string[];
	readonly consent: boolean;
	readonly progress: LocalAssistanceProgress | null;
	readonly result: LocalAssistanceValidatedResult | null;
	readonly unavailableReason: LocalAssistanceUiUnavailableReason | null;
	readonly error: string | null;
	readonly cleanup?: LocalAssistanceTranscriptCleanupState | null;
	readonly canRun: boolean;
	readonly canCancel: boolean;
	readonly canReview: boolean;
	readonly canAccept: boolean;
	readonly canPrepareTranscriptCleanup?: boolean;
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
	accept(): Promise<void>;
	prepareTranscriptCleanup(): Promise<void>;
	setTranscriptCleanupProposalSelected(proposalId: string, selected: boolean): void;
	acceptTranscriptCleanup(): Promise<void>;
	rejectTranscriptCleanup(): Promise<void>;
	dispose(): Promise<void>;
}

interface StoreOptions {
	readonly bridge: LocalAssistanceBridge | null;
	readonly preparation: LocalAssistanceSelectedMediaPreparationPort | null;
}

const EMPTY_SOURCES = Object.freeze([]) as readonly LocalAssistanceSelectedMediaSource[];
const EMPTY_MODELS = Object.freeze([]) as readonly LocalAssistanceModel[];
const EMPTY_MODEL_IDS = Object.freeze([]) as readonly string[];
const EMPTY_PROPOSALS = Object.freeze([]);

export function createLocalAssistanceSessionStore(
	options: StoreOptions,
): LocalAssistanceSessionStore {
	const listeners = new Set<() => void>();
	let pendingAcceptance: LocalAssistanceValidatedResultAcceptanceRequest | null = null;
	let reviewedVoiceActivity: LocalAssistanceTranscriptCleanupVoiceActivity | null = null;
	let cleanupEpoch = 0;
	let snapshot = freezeSnapshot({
		phase: 'idle', sources: EMPTY_SOURCES, models: EMPTY_MODELS,
		selectedSourceId: null, selectedOperation: null, selectedModelIds: EMPTY_MODEL_IDS,
		consent: false, progress: null, result: null, unavailableReason: null, error: null, cleanup: null,
	}, false, false);
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
		snapshot = freezeSnapshot({ ...snapshot, ...change }, pendingAcceptance !== null
			&& typeof options.preparation?.acceptValidatedResult === 'function',
		pendingAcceptance !== null && localAssistanceTranscriptCleanupPortAvailable(options.preparation)
			&& localAssistanceTranscriptCleanupEligible(pendingAcceptance));
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
	const discardCleanupSession = (): void => {
		cleanupEpoch += 1;
		if (snapshot.cleanup?.phase !== 'loading' && snapshot.cleanup?.phase !== 'review') return;
		const cancelCleanup = options.preparation?.cancelTranscriptCleanup;
		if (cancelCleanup) {
			void cancelCleanup.call(options.preparation).catch(() => undefined);
		}
	};

	const load = async (): Promise<void> => {
		if (disposed) return;
		discardCleanupSession();
		pendingAcceptance = null;
		reviewedVoiceActivity = null;
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
		update({ phase: 'loading', unavailableReason: null, error: null, result: null, cleanup: null });
		try {
			const [inventoryValue, modelValues] = await Promise.all([
				options.preparation.listSelectedMedia(), options.bridge.models(),
			]);
			if (disposed) return;
			const inventory = normalizeLocalAssistanceSelectedMediaInventory(inventoryValue);
			update({ phase: inventory.sources.length ? 'ready' : 'selection-required',
				sources: inventory.sources, models: modelValues,
				selectedSourceId: null, selectedOperation: null, selectedModelIds: EMPTY_MODEL_IDS,
				consent: false, unavailableReason: inventory.sources.length ? null : 'selection-required',
				error: null, progress: null, result: null, cleanup: null });
		} catch {
			if (!disposed) update({ phase: 'error', error: 'Local assistance could not load its selected-media inventory.',
				unavailableReason: null });
		}
	};

	const selectSource = (sourceId: string): void => {
		if (!snapshot.sources.some((source) => source.sourceId === sourceId)) {
			throw new TypeError('The selected local-assistance source is unavailable.');
		}
		discardCleanupSession();
		pendingAcceptance = null;
		reviewedVoiceActivity = null;
		update({ phase: 'ready', selectedSourceId: sourceId, selectedOperation: null,
			selectedModelIds: EMPTY_MODEL_IDS, consent: false, progress: null, result: null,
			unavailableReason: null, error: null, cleanup: null });
	};
	const selectOperation = (operation: AssistanceOperation): void => {
		const source = selectedSource(snapshot);
		if (!source?.operations.includes(operation)) {
			throw new TypeError('The selected media does not admit that assistance operation.');
		}
		const modelsAvailable = localAssistanceOperationModelsAvailable(operation, snapshot.models);
		discardCleanupSession();
		pendingAcceptance = null;
		update({ phase: modelsAvailable ? 'ready' : 'unavailable', selectedOperation: operation,
			selectedModelIds: EMPTY_MODEL_IDS, consent: false, progress: null, result: null,
			unavailableReason: modelsAvailable ? null : 'no-compatible-model', error: null, cleanup: null });
	};
	const selectModel = (modelId: string): void => {
		const operation = snapshot.selectedOperation;
		const model = snapshot.models.find((candidate) => candidate.modelId === modelId);
		if (!operation || !model || !localAssistanceModelCompatible(operation, model)) {
			throw new TypeError('The selected local-assistance model is incompatible.');
		}
		const modelsAvailable = localAssistanceOperationModelsAvailable(operation, snapshot.models);
		discardCleanupSession();
		pendingAcceptance = null;
		update({ phase: modelsAvailable ? 'ready' : 'unavailable',
			selectedModelIds: selectedModelIds(snapshot, model),
			consent: false, result: null, cleanup: null,
			unavailableReason: modelsAvailable ? null : 'no-compatible-model', error: null });
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
		const models = localAssistanceSelectedModels(
			operation, snapshot.models, snapshot.selectedModelIds,
		)!;
		cancelRequested = false;
		activeOperation = operation;
		lastProgressSequence = -1;
		lastProgressPhase = -1;
		discardCleanupSession();
		pendingAcceptance = null;
		update({ phase: 'preparing', progress: null, result: null, unavailableReason: null,
			error: null, cleanup: null });
		let completed: LocalAssistanceValidatedResult | null = null;
		let completedAcceptance: LocalAssistanceValidatedResultAcceptanceRequest | null = null;
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
				models: Object.freeze(models.map((model) => Object.freeze({ modelId: model.modelId,
					version: model.version, artifactSha256s: model.artifactSha256s }))),
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
				completedAcceptance = Object.freeze({
					sourceId,
					operation,
					selectionFence: prepared.selectionFence,
					models,
					outputs: Object.freeze(bodies.map(({ claim, review }) => Object.freeze({ claim, review }))),
				});
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
			pendingAcceptance = completedAcceptance;
			if (completedAcceptance?.operation === 'voice-activity-detection') {
				reviewedVoiceActivity = localAssistanceCleanupVoiceActivity(completedAcceptance);
			}
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
	const accept = async (): Promise<void> => {
		const port = options.preparation?.acceptValidatedResult;
		const request = pendingAcceptance;
		if (!snapshot.canAccept || !port || !request) {
			throw new Error('No reviewed local-assistance proposal is ready to accept.');
		}
		pendingAcceptance = null;
		update({ phase: 'accepting', error: null, unavailableReason: null });
		try {
			await port.call(options.preparation, request);
			if (!disposed) update({ phase: 'accepted', error: null, unavailableReason: null });
		} catch (error) {
			if (!disposed) update({
				phase: 'error',
				error: error instanceof Error
					? error.message : 'The assistance proposal could not be accepted.',
				unavailableReason: null,
			});
		}
	};
	const prepareTranscriptCleanup = async (): Promise<void> => {
		const port = options.preparation?.prepareTranscriptCleanup;
		const acceptance = pendingAcceptance;
		if (!snapshot.canPrepareTranscriptCleanup || !port || !acceptance) {
			throw new Error('No authenticated Parakeet transcript is ready for cleanup review.');
		}
		discardCleanupSession();
		const epoch = cleanupEpoch;
		const request = createLocalAssistanceTranscriptCleanupPreparation(
			acceptance, reviewedVoiceActivity,
		);
		update({ cleanup: createLocalAssistanceTranscriptCleanupState(
			'loading', EMPTY_PROPOSALS, EMPTY_MODEL_IDS,
			request.voiceActivity !== null, null) });
		try {
			const value = await port.call(options.preparation, request);
			if (disposed || epoch !== cleanupEpoch) return;
			const proposals = normalizeLocalAssistanceTranscriptCleanupProposals(
				value, request.selectionFence,
			);
			update({ cleanup: createLocalAssistanceTranscriptCleanupState(
				'review', proposals, EMPTY_MODEL_IDS,
				request.voiceActivity !== null, null) });
		} catch (error) {
			if (disposed || epoch !== cleanupEpoch) return;
			const unavailable = error instanceof RangeError
				&& /produced no cleanup proposals/u.test(error.message);
			update({ cleanup: createLocalAssistanceTranscriptCleanupState(
				unavailable ? 'unavailable' : 'error',
				EMPTY_PROPOSALS, EMPTY_MODEL_IDS, request.voiceActivity !== null,
				error instanceof Error ? error.message : 'Transcript cleanup preparation failed.') });
		}
	};
	const setTranscriptCleanupProposalSelected = (proposalId: string, selected: boolean): void => {
		const cleanup = snapshot.cleanup;
		if (cleanup?.phase !== 'review' || typeof selected !== 'boolean'
			|| !cleanup.proposals.some(({ id }) => id === proposalId)) {
			throw new TypeError('The transcript cleanup proposal choice is unavailable.');
		}
		const proposalIds = new Set(cleanup.selectedProposalIds);
		if (selected) proposalIds.add(proposalId);
		else proposalIds.delete(proposalId);
		update({ cleanup: createLocalAssistanceTranscriptCleanupState('review', cleanup.proposals,
			Object.freeze([...proposalIds]), cleanup.usesVoiceActivity, null) });
	};
	const acceptTranscriptCleanup = async (): Promise<void> => {
		const port = options.preparation?.acceptTranscriptCleanup;
		const cleanup = snapshot.cleanup;
		if (cleanup?.phase !== 'review' || cleanup.selectedProposalIds.length < 1 || !port) {
			throw new Error('No selected transcript cleanup proposals are ready to apply.');
		}
		const epoch = cleanupEpoch;
		update({ cleanup: createLocalAssistanceTranscriptCleanupState('accepting', cleanup.proposals,
			cleanup.selectedProposalIds, cleanup.usesVoiceActivity, null) });
		try {
			await port.call(options.preparation, cleanup.selectedProposalIds);
			if (disposed || epoch !== cleanupEpoch) return;
			pendingAcceptance = null;
			update({ phase: 'accepted', cleanup: createLocalAssistanceTranscriptCleanupState(
				'accepted', cleanup.proposals,
				cleanup.selectedProposalIds, cleanup.usesVoiceActivity, null) });
		} catch (error) {
			if (disposed || epoch !== cleanupEpoch) return;
			pendingAcceptance = null;
			update({ cleanup: createLocalAssistanceTranscriptCleanupState('error', cleanup.proposals,
				cleanup.selectedProposalIds, cleanup.usesVoiceActivity,
				error instanceof Error ? error.message : 'Transcript cleanup could not be applied.') });
		}
	};
	const rejectTranscriptCleanup = async (): Promise<void> => {
		const port = options.preparation?.rejectTranscriptCleanup;
		const cleanup = snapshot.cleanup;
		if (cleanup?.phase !== 'review' || !port) {
			throw new Error('No transcript cleanup proposal review is ready to reject.');
		}
		const epoch = cleanupEpoch;
		update({ cleanup: createLocalAssistanceTranscriptCleanupState('accepting', cleanup.proposals,
			cleanup.selectedProposalIds, cleanup.usesVoiceActivity, null) });
		try {
			await port.call(options.preparation);
			if (disposed || epoch !== cleanupEpoch) return;
			update({ cleanup: createLocalAssistanceTranscriptCleanupState('rejected', cleanup.proposals,
				cleanup.selectedProposalIds, cleanup.usesVoiceActivity, null) });
		} catch (error) {
			if (disposed || epoch !== cleanupEpoch) return;
			update({ cleanup: createLocalAssistanceTranscriptCleanupState('error', cleanup.proposals,
				cleanup.selectedProposalIds, cleanup.usesVoiceActivity,
				error instanceof Error ? error.message : 'Transcript cleanup could not be rejected.') });
		}
	};
	const dispose = async (): Promise<void> => {
		disposed = true;
		pendingAcceptance = null;
		reviewedVoiceActivity = null;
		cleanupEpoch += 1;
		cancelRequested = true;
		if ((snapshot.cleanup?.phase === 'loading' || snapshot.cleanup?.phase === 'review')
			&& options.preparation?.cancelTranscriptCleanup) {
			try { await options.preparation.cancelTranscriptCleanup(); } catch { /* Discard is best-effort. */ }
		}
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
		connect, load, selectSource, selectOperation, selectModel, setConsent, run, cancel, accept,
		prepareTranscriptCleanup, setTranscriptCleanupProposalSelected,
		acceptTranscriptCleanup, rejectTranscriptCleanup, dispose,
	});
}

function freezeSnapshot(value: Omit<LocalAssistanceSnapshot,
	'canRun' | 'canCancel' | 'canReview' | 'canAccept' | 'canPrepareTranscriptCleanup'>,
	acceptanceAvailable: boolean,
	cleanupAvailable: boolean,
): LocalAssistanceSnapshot {
	const source = selectedSource(value);
	const models = value.selectedOperation === null ? null : localAssistanceSelectedModels(
		value.selectedOperation, value.models, value.selectedModelIds,
	);
	const selectionReady = Boolean(source && value.selectedOperation
		&& source.operations.includes(value.selectedOperation)
		&& models);
	return Object.freeze({ ...value,
		canRun: value.phase === 'ready' && selectionReady && value.consent,
		canCancel: value.phase === 'preparing' || value.phase === 'running' || value.phase === 'cancelling',
		canReview: value.phase === 'completed' && Boolean(value.result?.outputs.length),
		canAccept: value.phase === 'completed' && Boolean(value.result?.outputs.length)
			&& acceptanceAvailable && value.cleanup?.phase !== 'loading'
			&& value.cleanup?.phase !== 'review' && value.cleanup?.phase !== 'accepting',
		canPrepareTranscriptCleanup: value.phase === 'completed'
			&& Boolean(value.result?.outputs.length) && cleanupAvailable && value.cleanup == null,
	});
}

function selectedSource(value: Pick<LocalAssistanceSnapshot, 'sources' | 'selectedSourceId'>) {
	return value.sources.find(({ sourceId }) => sourceId === value.selectedSourceId) ?? null;
}

function selectedModelIds(
	snapshot: LocalAssistanceSnapshot,
	selected: LocalAssistanceModel,
): readonly string[] {
	const operation = snapshot.selectedOperation!;
	const slot = localAssistanceModelTaskSlots(operation).find(
		(candidate) => candidate.includes(selected.task),
	)!;
	const current = snapshot.selectedModelIds
		.map((modelId) => snapshot.models.find((model) => model.modelId === modelId))
		.filter((model): model is LocalAssistanceModel => model !== undefined && !slot.includes(model.task));
	current.push(selected);
	return Object.freeze(localAssistanceModelTaskSlots(operation).flatMap((candidate) => {
		const model = current.find(({ task }) => candidate.includes(task));
		return model ? [model.modelId] : [];
	}));
}

class CancelledSession extends Error {}
