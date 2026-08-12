/* SPDX-License-Identifier: AGPL-3.0-only */

import { digestScapeBytes } from '../scape-archive-media.ts';
import type { TakeCycleCaptureSpan } from '../take-cycle-capture-domain.ts';
import type {
	RawPcmSpoolRecord,
	RawPcmSpoolRepository,
} from '../storage/raw-pcm-spool-repository.ts';
import type { TakeCycleLaneTarget } from './take-cycle-recording-repository-composition.ts';

const TEXT_ENCODER = new TextEncoder();

export interface TakeCycleLiveCaptureDiscardAuthority {
	readonly projectId: string;
	readonly publicationGeneration: number;
	readonly envelopeId: string;
	readonly groupId: string;
	readonly laneId: string;
	readonly target: TakeCycleLaneTarget;
	readonly captureSpans: readonly TakeCycleCaptureSpan[];
}

export interface TakeCycleLiveCaptureDiscardOutcome {
	readonly kind: 'take-cycle-live-capture-discard-v1';
	readonly projectId: string;
	readonly publicationGeneration: number;
	readonly envelopeId: string;
	readonly groupId: string;
	readonly laneId: string;
	readonly target: TakeCycleLaneTarget;
	readonly manifestSha256: string;
}

/** Durably mark the exact live prefix failed before reclaiming its raw PCM. */
export async function discardTakeCycleLiveCapture(
	repository: Pick<RawPcmSpoolRepository, 'discard'>,
	record: RawPcmSpoolRecord,
	authority: TakeCycleLiveCaptureDiscardAuthority,
): Promise<void> {
	if (record.state !== 'capturing' || record.projectId !== authority.projectId
		|| record.spoolId !== authority.envelopeId) {
		throw new Error('Take cycle live discard does not own the capturing lane.');
	}
	const outcome: TakeCycleLiveCaptureDiscardOutcome = Object.freeze({
		kind: 'take-cycle-live-capture-discard-v1',
		projectId: authority.projectId,
		publicationGeneration: authority.publicationGeneration,
		envelopeId: authority.envelopeId,
		groupId: authority.groupId,
		laneId: authority.laneId,
		target: authority.target,
		manifestSha256: digestScapeBytes(TEXT_ENCODER.encode(JSON.stringify(authority))),
	});
	if (!await repository.discard(record, outcome)) {
		throw new Error('Take cycle live discard refused stale or settled lane ownership.');
	}
}
