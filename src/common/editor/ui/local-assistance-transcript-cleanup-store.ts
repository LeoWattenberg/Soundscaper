/* SPDX-License-Identifier: AGPL-3.0-only */

/** Shared transcript-cleanup state machine for assistance session surfaces. */

import {
	createLocalAssistanceTranscriptCleanupPreparation,
	createLocalAssistanceTranscriptCleanupState,
	localAssistanceTranscriptCleanupEligible,
	localAssistanceTranscriptCleanupPortAvailable,
	normalizeLocalAssistanceTranscriptCleanupProposals,
	type LocalAssistanceTranscriptCleanupPreset,
	type LocalAssistanceTranscriptCleanupVoiceActivity,
} from '../assistance/local-assistance-cleanup.ts';
import type { LocalAssistanceSelectedMediaPreparationPort,
	LocalAssistanceValidatedResultAcceptanceRequest } from '../assistance/local-assistance-preparation.ts';
import type { LocalAssistanceSnapshot } from './local-assistance-session-types.ts';

const EMPTY_PROPOSALS = Object.freeze([]);
const EMPTY_MODEL_IDS = Object.freeze([]) as readonly string[];

interface TranscriptCleanupStoreOptions {
	readonly preparation: LocalAssistanceSelectedMediaPreparationPort | null;
	readonly snapshot: () => LocalAssistanceSnapshot;
	readonly acceptance: () => LocalAssistanceValidatedResultAcceptanceRequest | null;
	readonly clearAcceptance: () => void;
	readonly voiceActivity: () => LocalAssistanceTranscriptCleanupVoiceActivity | null;
	readonly update: (change: Partial<LocalAssistanceSnapshot>) => void;
	readonly disposed: () => boolean;
}

export interface LocalAssistanceTranscriptCleanupStore {
	available(): boolean;
	discard(): void;
	prepare(preset?: LocalAssistanceTranscriptCleanupPreset): Promise<void>;
	setSelected(proposalId: string, selected: boolean): void;
	accept(): Promise<void>;
	reject(): Promise<void>;
	dispose(): Promise<void>;
}

export function createLocalAssistanceTranscriptCleanupStore(
	options: TranscriptCleanupStoreOptions,
): LocalAssistanceTranscriptCleanupStore {
	let epoch = 0;
	const available = (): boolean => {
		const acceptance = options.acceptance();
		return acceptance !== null
			&& localAssistanceTranscriptCleanupPortAvailable(options.preparation)
			&& localAssistanceTranscriptCleanupEligible(acceptance);
	};
	const discard = (): void => {
		epoch += 1;
		const cleanup = options.snapshot().cleanup;
		if (cleanup?.phase !== 'loading' && cleanup?.phase !== 'review') return;
		const cancel = options.preparation?.cancelTranscriptCleanup;
		if (cancel) void cancel.call(options.preparation).catch(() => undefined);
	};
	const prepare = async (
		preset: LocalAssistanceTranscriptCleanupPreset = 'balanced',
	): Promise<void> => {
		const port = options.preparation?.prepareTranscriptCleanup;
		const acceptance = options.acceptance();
		const snapshot = options.snapshot();
		const canReprepare = snapshot.phase === 'completed' && snapshot.cleanup?.phase === 'review';
		if ((!snapshot.canPrepareTranscriptCleanup && !canReprepare) || !port || !acceptance) {
			throw new Error('No authenticated Parakeet transcript is ready for cleanup review.');
		}
		discard();
		const currentEpoch = epoch;
		const request = createLocalAssistanceTranscriptCleanupPreparation(
			acceptance, options.voiceActivity(), preset,
		);
		options.update({ cleanup: createLocalAssistanceTranscriptCleanupState(
			'loading', EMPTY_PROPOSALS, EMPTY_MODEL_IDS,
			request.voiceActivity !== null, null, request.preset,
		) });
		try {
			const value = await port.call(options.preparation, request);
			if (options.disposed() || currentEpoch !== epoch) return;
			const proposals = normalizeLocalAssistanceTranscriptCleanupProposals(
				value, request.selectionFence,
			);
			options.update({ cleanup: createLocalAssistanceTranscriptCleanupState(
				'review', proposals, EMPTY_MODEL_IDS,
				request.voiceActivity !== null, null, request.preset,
			) });
		} catch (error) {
			if (options.disposed() || currentEpoch !== epoch) return;
			const unavailable = error instanceof RangeError
				&& /produced no cleanup proposals/u.test(error.message);
			options.update({ cleanup: createLocalAssistanceTranscriptCleanupState(
				unavailable ? 'unavailable' : 'error', EMPTY_PROPOSALS, EMPTY_MODEL_IDS,
				request.voiceActivity !== null,
				error instanceof Error ? error.message : 'Transcript cleanup preparation failed.',
				request.preset,
			) });
		}
	};
	const setSelected = (proposalId: string, selected: boolean): void => {
		const cleanup = options.snapshot().cleanup;
		if (cleanup?.phase !== 'review' || typeof selected !== 'boolean'
			|| !cleanup.proposals.some(({ id }) => id === proposalId)) {
			throw new TypeError('The transcript cleanup proposal choice is unavailable.');
		}
		const selectedIds = new Set(cleanup.selectedProposalIds);
		if (selected) selectedIds.add(proposalId);
		else selectedIds.delete(proposalId);
		options.update({ cleanup: createLocalAssistanceTranscriptCleanupState(
			'review', cleanup.proposals, Object.freeze([...selectedIds]),
			cleanup.usesVoiceActivity, null, cleanup.preset,
		) });
	};
	const settle = async (decision: 'accept' | 'reject'): Promise<void> => {
		const cleanup = options.snapshot().cleanup;
		const port = decision === 'accept'
			? options.preparation?.acceptTranscriptCleanup
			: options.preparation?.rejectTranscriptCleanup;
		if (cleanup?.phase !== 'review' || !port
			|| (decision === 'accept' && cleanup.selectedProposalIds.length < 1)) {
			throw new Error(decision === 'accept'
				? 'No selected transcript cleanup proposals are ready to apply.'
				: 'No transcript cleanup proposal review is ready to reject.');
		}
		const currentEpoch = epoch;
		options.update({ cleanup: createLocalAssistanceTranscriptCleanupState(
			'accepting', cleanup.proposals, cleanup.selectedProposalIds,
			cleanup.usesVoiceActivity, null, cleanup.preset,
		) });
		try {
			if (decision === 'accept') {
				await (port as NonNullable<LocalAssistanceSelectedMediaPreparationPort['acceptTranscriptCleanup']>)
					.call(options.preparation, cleanup.selectedProposalIds);
			} else {
				await (port as NonNullable<LocalAssistanceSelectedMediaPreparationPort['rejectTranscriptCleanup']>)
					.call(options.preparation);
			}
			if (options.disposed() || currentEpoch !== epoch) return;
			if (decision === 'accept') options.clearAcceptance();
			options.update({
				...(decision === 'accept' ? { phase: 'accepted' as const } : {}),
				cleanup: createLocalAssistanceTranscriptCleanupState(
					decision === 'accept' ? 'accepted' : 'rejected', cleanup.proposals,
					cleanup.selectedProposalIds, cleanup.usesVoiceActivity, null, cleanup.preset,
				),
			});
		} catch (error) {
			if (options.disposed() || currentEpoch !== epoch) return;
			if (decision === 'accept') options.clearAcceptance();
			options.update({ cleanup: createLocalAssistanceTranscriptCleanupState(
				'error', cleanup.proposals, cleanup.selectedProposalIds, cleanup.usesVoiceActivity,
				error instanceof Error ? error.message : `Transcript cleanup could not be ${decision === 'accept' ? 'applied' : 'rejected'}.`,
				cleanup.preset,
			) });
		}
	};
	const dispose = async (): Promise<void> => {
		epoch += 1;
		const cleanup = options.snapshot().cleanup;
		if ((cleanup?.phase === 'loading' || cleanup?.phase === 'review')
			&& options.preparation?.cancelTranscriptCleanup) {
			try { await options.preparation.cancelTranscriptCleanup(); } catch { /* Best effort. */ }
		}
	};
	return Object.freeze({ available, discard, prepare, setSelected,
		accept: () => settle('accept'), reject: () => settle('reject'), dispose });
}
