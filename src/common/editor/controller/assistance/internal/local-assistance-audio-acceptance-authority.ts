/* SPDX-License-Identifier: AGPL-3.0-only */

/** Shared selected-audio currency and geometry admission for legacy acceptance paths. */

import {
	AssistanceProposalStaleError,
	validateAssistanceSelectionFence,
	type AssistanceSelectionFence,
} from '../../../assistance/proposal-session.ts';

type DataRecord = Readonly<Record<string, unknown>>;

interface AuthorityCandidate {
	readonly project?: unknown;
	readonly fence?: unknown;
	readonly startFrame?: unknown;
	readonly endFrame?: unknown;
	readonly sourceStartFrame?: unknown;
	readonly sourceEndFrame?: unknown;
}

export interface NormalizedLocalAssistanceAudioAcceptanceAuthority {
	readonly fence: AssistanceSelectionFence;
	readonly sampleRate: number;
	readonly timelineStartFrame: number;
	readonly timelineEndFrame: number;
	readonly sourceStartFrame: number;
	readonly sourceEndFrame: number;
	readonly tracks: readonly DataRecord[];
}

export function normalizeLocalAssistanceAudioAcceptanceAuthority(
	value: unknown,
	missingAuthorityMessage: string,
): NormalizedLocalAssistanceAudioAcceptanceAuthority {
	const authority = value as AuthorityCandidate | null;
	if (!authority || !authority.project || typeof authority.project !== 'object') {
		throw new TypeError(missingAuthorityMessage);
	}
	const project = authority.project as DataRecord;
	const fence = validateAssistanceSelectionFence(authority.fence);
	if (project.id !== fence.projectId || project.schemaFamily !== fence.schemaFamily
		|| project.schemaVersion !== fence.schemaVersion
		|| project.revision !== fence.revision || !Array.isArray(project.tracks)) {
		throw new AssistanceProposalStaleError();
	}
	const sampleRate = integer(project.sampleRate, 1, 'project sample rate');
	const timelineStartFrame = integer(authority.startFrame, 0, 'timeline start');
	const timelineEndFrame = integer(authority.endFrame, 1, 'timeline end');
	const sourceStartFrame = integer(authority.sourceStartFrame, 0, 'source start');
	const sourceEndFrame = integer(authority.sourceEndFrame, 1, 'source end');
	if (timelineEndFrame <= timelineStartFrame || sourceEndFrame <= sourceStartFrame
		|| timelineEndFrame - timelineStartFrame !== sourceEndFrame - sourceStartFrame
		|| sourceStartFrame !== fence.sourceStartFrame || sourceEndFrame !== fence.sourceEndFrame) {
		throw new AssistanceProposalStaleError();
	}
	return Object.freeze({
		fence,
		sampleRate,
		timelineStartFrame,
		timelineEndFrame,
		sourceStartFrame,
		sourceEndFrame,
		tracks: Object.freeze([...project.tracks]) as readonly DataRecord[],
	});
}

function integer(value: unknown, minimum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum) {
		throw new RangeError(`The ${label} is invalid.`);
	}
	return Number(value);
}
