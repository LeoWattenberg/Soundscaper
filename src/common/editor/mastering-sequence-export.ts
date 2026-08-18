/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createMasteringSequenceDeliveryPlan,
	masteringSequenceDeliveryCues,
	scaleMasteringSequenceDeliveryPlan,
	type MasteringSequenceDeliveryPlan,
	type MasteringSequenceDeliverySegment,
} from './mastering-sequence-delivery.ts';
import { masteringSequenceRegionViews } from './mastering-sequence-regions.ts';
import type { MasteringSequenceV23 } from './mastering-sequence.ts';
import type { RuntimeTimelineAnnotationProject } from './runtime-timeline-annotation-projection.ts';
import type { RiffMarkerInput } from './riff-markers.ts';

/**
 * Resolving a mastering sequence into the parts an export plan is built from.
 *
 * A sequence delivery is an ordinary plan — one plan, one artifact — that
 * happens to read several ranges of the project instead of one. This works out
 * which ranges, how long the result is, and where its cues land, and refuses
 * every case where a sequence cannot be delivered honestly. Nothing here decides
 * how the audio is produced: the plan still describes the delivery and the
 * ordinary offline render still performs it.
 */

export interface MasteringSequenceExportDelivery {
	readonly sequenceId: string;
	/** Delivery positions in the rate the file is written at. */
	readonly plan: MasteringSequenceDeliveryPlan;
	readonly cues: readonly RiffMarkerInput[];
	readonly outputFrames: number;
	/** The span of the project this delivery reads, for reporting and admission. */
	readonly sourceRange: Readonly<{
		startFrame: number;
		endFrame: number;
		durationFrames: number;
	}>;
	/**
	 * The longest single render this delivery performs. Entries render one at a
	 * time, so the whole span the sequence draws from would badly overstate what
	 * one render holds — two short regions at opposite ends of a long project
	 * would be refused the offline render they comfortably fit in.
	 */
	readonly longestRenderFrames: number;
}

export interface MasteringSequenceExportRequest {
	readonly masteringSequenceId: unknown;
	readonly mode: string;
	readonly outputSampleRate: number;
	readonly admMetadata: unknown;
}

/** Resolve the requested sequence, or null when this delivery is not one. */
export function resolveMasteringSequenceExport(
	project: RuntimeTimelineAnnotationProject,
	request: MasteringSequenceExportRequest,
): MasteringSequenceExportDelivery | null {
	const requestedId = request.masteringSequenceId;
	if (requestedId == null) return null;
	if (typeof requestedId !== 'string' || requestedId === '') {
		throw new TypeError('A mastering sequence delivery requires the sequence id.');
	}
	if (request.mode !== 'mix') {
		// A sequence is one delivered artifact by construction; stems would each
		// have to be spliced the same way and would stop summing to it.
		throw new Error('Mastering sequence delivery is mix-only.');
	}
	if (request.admMetadata != null) {
		// ADM metadata describes positions on the project timeline. Splicing the
		// audio without re-timing it would leave the two describing different
		// things, and re-timing it is not something this slice may invent.
		throw new Error('ADM delivery describes the project timeline and cannot deliver a mastering sequence.');
	}

	const sequences = readSequences(project);
	const sequence = sequences.find((candidate) => candidate.id === requestedId);
	if (!sequence) throw new RangeError(`Mastering sequence ${requestedId} is not in this project.`);

	// Throws the typed validation error when the sequence is not deliverable, so
	// a delivery either describes a whole sequence or does not start.
	const sourcePlan = createMasteringSequenceDeliveryPlan(sequence, masteringSequenceRegionViews(project));
	const sourceSampleRate = Number(project.sampleRate);
	const plan = scaleMasteringSequenceDeliveryPlan(sourcePlan, {
		sourceSampleRate,
		outputSampleRate: request.outputSampleRate,
	});

	return Object.freeze({
		sequenceId: sequence.id,
		plan,
		cues: masteringSequenceDeliveryCues(plan),
		outputFrames: plan.totalFrames,
		sourceRange: sourceSpan(plan.segments),
		longestRenderFrames: plan.segments.reduce(
			(longest, segment) => Math.max(longest, segment.sourceEndFrame - segment.sourceStartFrame),
			0,
		),
	});
}

function readSequences(project: RuntimeTimelineAnnotationProject): readonly MasteringSequenceV23[] {
	const sequences = (project as unknown as { masteringSequences?: unknown }).masteringSequences;
	if (!Array.isArray(sequences)) {
		throw new TypeError('This project revision does not carry mastering sequences.');
	}
	return sequences as readonly MasteringSequenceV23[];
}

function sourceSpan(
	segments: readonly MasteringSequenceDeliverySegment[],
): Readonly<{ startFrame: number; endFrame: number; durationFrames: number }> {
	if (segments.length === 0) return Object.freeze({ startFrame: 0, endFrame: 0, durationFrames: 0 });
	let startFrame = Number.POSITIVE_INFINITY;
	let endFrame = 0;
	for (const segment of segments) {
		startFrame = Math.min(startFrame, segment.sourceStartFrame);
		endFrame = Math.max(endFrame, segment.sourceEndFrame);
	}
	return Object.freeze({ startFrame, endFrame, durationFrames: endFrame - startFrame });
}
