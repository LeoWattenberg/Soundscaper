/* SPDX-License-Identifier: AGPL-3.0-only */

import { digestScapeBytes } from '../scape-archive-media.ts';
import type { TakeCycleRecoveryEnvelope } from '../take-cycle-recovery-envelope.ts';
import type { TakeCycleCaptureDraft } from './take-cycle-capture-spool.ts';
import type { TakeCycleCapturingSpoolEvidence } from './take-cycle-live-capture-spool.ts';

const TEXT_ENCODER = new TextEncoder();

export interface TakeCycleOpenRecoveryAuthority {
	readonly publicationGeneration: number;
	readonly recoveryToken: string;
}

/** Derive one exact, stale-detecting authority from every durable recovery root. */
export function deriveTakeCycleOpenRecoveryAuthority({
	projectId,
	envelope,
	drafts,
	capturing,
}: Readonly<{
	readonly projectId: string;
	readonly envelope: TakeCycleRecoveryEnvelope | null;
	readonly drafts: readonly TakeCycleCaptureDraft[];
	readonly capturing: readonly TakeCycleCapturingSpoolEvidence[];
}>): TakeCycleOpenRecoveryAuthority | null {
	if (envelope && envelope.projectFence.projectId !== projectId) {
		throw new Error('Take cycle recovery envelope belongs to another project.');
	}
	const generations = new Set<number>();
	if (envelope) generations.add(envelope.generation);
	for (const draft of drafts) generations.add(draft.publicationGeneration);
	for (const capture of capturing) generations.add(capture.publicationGeneration);
	if (!generations.size) return null;
	if (generations.size !== 1) {
		throw new Error('Active take cycle recovery roots have contradictory publication generations.');
	}
	const identities = [
		...drafts.map(({ draftId }) => draftId),
		...capturing.map(({ draftId }) => draftId),
	];
	if (new Set(identities).size !== identities.length) {
		throw new Error('Active take cycle recovery roots have contradictory draft ownership.');
	}
	const groupTargets = new Map<string, string>();
	for (const root of [
		...drafts.map(({ lane, target }) => ({ groupId: lane.groupId, target })),
		...capturing,
	]) {
		const target = `${root.target.sequenceId}\u0000${root.target.trackId}`;
		const previous = groupTargets.get(root.groupId);
		if (previous && previous !== target) {
			throw new Error(`Take cycle group ${root.groupId} has contradictory routed targets.`);
		}
		groupTargets.set(root.groupId, target);
	}
	const authority = {
		version: 1,
		projectId,
		envelope: envelope ? envelopeAuthority(envelope) : null,
		drafts: [...drafts]
			.sort((left, right) => left.draftId.localeCompare(right.draftId))
			.map((draft) => ({
				draftId: draft.draftId,
				draftToken: draft.draftToken,
				publicationGeneration: draft.publicationGeneration,
				lane: draft.lane,
				target: draft.target,
				sources: draft.sources,
			})),
		capturing: [...capturing].sort((left, right) => left.draftId.localeCompare(right.draftId)),
	};
	return Object.freeze({
		publicationGeneration: [...generations][0]!,
		recoveryToken: `take-cycle-open-recovery-v1:${digestScapeBytes(
			TEXT_ENCODER.encode(JSON.stringify(authority)),
		)}`,
	});
}

function envelopeAuthority(envelope: TakeCycleRecoveryEnvelope): unknown {
	return {
		envelopeId: envelope.envelopeId,
		state: envelope.state,
		generation: envelope.generation,
		captureRequest: envelope.captureRequest,
		entries: envelope.entries,
		projectFence: envelope.projectFence,
	};
}
