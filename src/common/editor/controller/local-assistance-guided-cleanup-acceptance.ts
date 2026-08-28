/* SPDX-License-Identifier: AGPL-3.0-only */

/** Atomic publication of an already-reviewed Guided cleanup subset. */

import {
	acceptedProposalRanges,
	type DisfluencyProposal,
} from '../assistance/disfluency.ts';
import {
	reviewAssistanceOwnedAudioCutTransformResultV1,
} from '../assistance/owned-audio-cut-transform-results-v1.ts';
import type {
	AssistanceCleanupProposalsV1,
} from '../assistance/owned-audio-cut-transform-types-v1.ts';
import {
	AssistanceProposalStaleError,
	validateAssistanceSelectionFence,
	type AssistanceSelectionFence,
} from '../assistance/proposal-session.ts';
import { prepareDisjointRangeDeleteCommand } from '../commands.js';
import type { AudioEditorCommand } from '../commands/protocol.ts';
import type {
	LocalAssistanceTranscriptCleanupAuthority,
} from './local-assistance-cleanup-acceptance.ts';

type Awaitable<Value> = PromiseLike<Value> | Value;

export interface LocalAssistanceGuidedCleanupAcceptanceDependencies {
	readonly currentAuthority: () => LocalAssistanceTranscriptCleanupAuthority;
	readonly captureProject: () => unknown;
	readonly assertProject: (token: unknown) => void;
	readonly commit: (command: AudioEditorCommand) => Awaitable<void>;
}

export interface LocalAssistanceGuidedCleanupAcceptanceRequest {
	readonly selectionFence: AssistanceSelectionFence;
	readonly result: unknown;
	readonly selectedProposalIds: readonly string[];
}

export interface LocalAssistanceGuidedCleanupAcceptance {
	accept(request: LocalAssistanceGuidedCleanupAcceptanceRequest): Promise<void>;
}

interface NormalizedAuthority {
	readonly project: LocalAssistanceTranscriptCleanupAuthority['project'];
	readonly fence: AssistanceSelectionFence;
	readonly trackId: string;
	readonly timelineStartFrame: number;
	readonly timelineEndFrame: number;
	readonly sourceStartFrame: number;
	readonly sourceEndFrame: number;
}

export function createLocalAssistanceGuidedCleanupAcceptance(
	dependencies: LocalAssistanceGuidedCleanupAcceptanceDependencies,
): Readonly<LocalAssistanceGuidedCleanupAcceptance> {
	validateDependencies(dependencies);
	return Object.freeze({ accept });

	async function accept(request: LocalAssistanceGuidedCleanupAcceptanceRequest): Promise<void> {
		const fence = validateAssistanceSelectionFence(request?.selectionFence);
		const reviewed = (reviewAssistanceOwnedAudioCutTransformResultV1({
			schemaVersion: 1, transformId: 'propose-cleanup',
			outputs: { 'cleanup-proposals': request?.result },
		}) as Readonly<{ readonly outputs: Readonly<{
			readonly 'cleanup-proposals': AssistanceCleanupProposalsV1;
		}> }>).outputs['cleanup-proposals'];
		const selected = selectedIds(request?.selectedProposalIds, reviewed.proposals);
		const initial = normalizeAuthority(dependencies.currentAuthority());
		assertSameFence(fence, initial.fence);
		if (selected.length === 0) return;
		const proposals = reviewed.proposals.map((proposal): DisfluencyProposal => Object.freeze({
			id: proposal.id, kind: proposal.kind,
			startFrame: timelineFrame(proposal.startFrame, initial),
			endFrame: timelineFrame(proposal.endFrame, initial), text: proposal.text,
		}));
		const ranges = acceptedProposalRanges(proposals, selected);
		if (ranges.length === 0) return;
		const token = dependencies.captureProject();
		const current = normalizeAuthority(dependencies.currentAuthority());
		assertSameFence(fence, current.fence);
		if (current.trackId !== initial.trackId) throw new AssistanceProposalStaleError();
		const command = prepareDisjointRangeDeleteCommand(current.project, {
			ranges, trackIds: [current.trackId], rippleMode: 'track',
		}) as AudioEditorCommand;
		dependencies.assertProject(token);
		const final = normalizeAuthority(dependencies.currentAuthority());
		assertSameFence(fence, final.fence);
		if (final.trackId !== current.trackId) throw new AssistanceProposalStaleError();
		await dependencies.commit(command);
	}
}

function selectedIds(
	value: unknown,
	proposals: readonly Readonly<{ readonly id: string }>[],
): readonly string[] {
	if (!Array.isArray(value) || value.length > proposals.length) {
		throw new RangeError('The selected Guided cleanup subset is out of range.');
	}
	const admitted = new Set(proposals.map(({ id }) => id));
	const result = value.map((candidate) => {
		if (typeof candidate !== 'string' || !admitted.has(candidate)) {
			throw new RangeError(`Unknown Guided cleanup proposal ${String(candidate)}.`);
		}
		return candidate;
	});
	if (new Set(result).size !== result.length) {
		throw new TypeError('Selected Guided cleanup proposal IDs must be unique.');
	}
	return Object.freeze(result);
}

function normalizeAuthority(
	value: LocalAssistanceTranscriptCleanupAuthority,
): NormalizedAuthority {
	if (!value || typeof value !== 'object' || !value.project || typeof value.project !== 'object') {
		throw new TypeError('Guided cleanup requires selected-media authority.');
	}
	const fence = validateAssistanceSelectionFence(value.fence);
	if (value.project.id !== fence.projectId || value.project.schemaFamily !== fence.schemaFamily
		|| value.project.schemaVersion !== fence.schemaVersion
		|| value.project.revision !== fence.revision || !Array.isArray(value.project.tracks)) {
		throw new AssistanceProposalStaleError();
	}
	const timelineStartFrame = frame(value.startFrame, 'selected timeline start');
	const timelineEndFrame = frame(value.endFrame, 'selected timeline end');
	const sourceStartFrame = frame(value.sourceStartFrame, 'selected source start');
	const sourceEndFrame = frame(value.sourceEndFrame, 'selected source end');
	if (timelineEndFrame <= timelineStartFrame || sourceEndFrame <= sourceStartFrame
		|| timelineEndFrame - timelineStartFrame !== sourceEndFrame - sourceStartFrame
		|| sourceStartFrame !== fence.sourceStartFrame || sourceEndFrame !== fence.sourceEndFrame) {
		throw new AssistanceProposalStaleError();
	}
	const trackId = stableId(value.track?.id, 'selected cleanup track ID');
	const tracks = value.project.tracks.filter(({ id }) => id === trackId);
	if (tracks.length !== 1 || tracks[0]!.type !== 'audio'
		|| !Array.isArray(tracks[0]!.clipIds)
		|| !tracks[0]!.clipIds.some((id: unknown) => fence.occurrenceIds.includes(String(id)))) {
		throw new AssistanceProposalStaleError();
	}
	return Object.freeze({ project: value.project, fence, trackId, timelineStartFrame,
		timelineEndFrame, sourceStartFrame, sourceEndFrame });
}

function timelineFrame(sourceFrameValue: number, authority: NormalizedAuthority): number {
	const sourceFrame = frame(sourceFrameValue, 'Guided cleanup source frame');
	const result = authority.timelineStartFrame + sourceFrame - authority.sourceStartFrame;
	if (!Number.isSafeInteger(result) || sourceFrame < authority.sourceStartFrame
		|| sourceFrame > authority.sourceEndFrame || result < authority.timelineStartFrame
		|| result > authority.timelineEndFrame) {
		throw new RangeError('A Guided cleanup proposal exceeds its selected occurrence.');
	}
	return result;
}

function assertSameFence(left: AssistanceSelectionFence, right: AssistanceSelectionFence): void {
	if (JSON.stringify(left) !== JSON.stringify(right)) throw new AssistanceProposalStaleError();
}

function validateDependencies(value: LocalAssistanceGuidedCleanupAcceptanceDependencies): void {
	if (!value || typeof value !== 'object' || typeof value.currentAuthority !== 'function'
		|| typeof value.captureProject !== 'function' || typeof value.assertProject !== 'function'
		|| typeof value.commit !== 'function') {
		throw new TypeError('Guided cleanup requires exact controller transaction ports.');
	}
}

function frame(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`The ${label} is invalid.`);
	}
	return Number(value);
}

function stableId(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 256) {
		throw new TypeError(`The ${label} is invalid.`);
	}
	return value;
}
