/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	assertMasteringSequenceDeliverableV23,
	masteringSequenceEntryTitle,
	validateMasteringSequenceV23,
	type MasteringSequenceRegionView,
	type MasteringSequenceV23,
} from './mastering-sequence.ts';
import { addDeliveryReportItem } from './delivery-report.ts';
import type { RiffMarkerInput } from './riff-markers.ts';

/**
 * Turning a mastering sequence into the timeline a delivery renders.
 *
 * The sequence says which regions, in what order, with what gaps and fades. This
 * resolves that into exact output positions: an entry's audio starts where the
 * previous one ended plus its own gap, and every boundary is an integer sample
 * derived by accumulation rather than by rounding a duration. Nothing here reads
 * or writes project state — the plan is a description the delivery consumes, so
 * realizing gaps and fades never mutates the document, which is the slice's stop
 * condition.
 *
 * **A sequence that does not validate cannot be delivered.** The refusal happens
 * here, before any plan exists, so a delivery either describes a whole sequence
 * or does not start.
 */

export interface MasteringSequenceDeliverySegment {
	readonly entryId: string;
	readonly annotationId: string;
	readonly title: string;
	/** Silence before this entry, already included in `outputStartFrame`. */
	readonly gapBeforeFrames: number;
	/** Where the entry's audio begins and ends in the delivered file. */
	readonly outputStartFrame: number;
	readonly outputEndFrame: number;
	/** The project-timeline span this entry renders. */
	readonly sourceStartFrame: number;
	readonly sourceEndFrame: number;
	readonly fadeInFrames: number;
	readonly fadeOutFrames: number;
	readonly metadata: Readonly<Record<string, string>>;
}

export interface MasteringSequenceDeliveryPlan {
	readonly sequenceId: string;
	readonly segments: readonly MasteringSequenceDeliverySegment[];
	/** Total delivered length, including every gap. */
	readonly totalFrames: number;
}

/**
 * Resolve the delivery timeline for one validated sequence.
 *
 * Throws `MasteringSequenceValidationError` when the sequence has any
 * error-level issue, so a delivery never renders a partially resolvable order.
 */
export function createMasteringSequenceDeliveryPlan(
	sequence: MasteringSequenceV23,
	regions: Iterable<MasteringSequenceRegionView>,
): MasteringSequenceDeliveryPlan {
	const byId = new Map<string, MasteringSequenceRegionView>();
	for (const region of regions) byId.set(region.id, region);
	assertMasteringSequenceDeliverableV23(validateMasteringSequenceV23(sequence, byId.values()));

	const segments: MasteringSequenceDeliverySegment[] = [];
	let outputFrame = 0;
	for (const entry of sequence.entries) {
		const region = byId.get(entry.annotationId)!;
		// The gap belongs to the entry that follows it, so it is added before the
		// audio rather than after the previous entry — which is what makes the
		// first entry's gap a lead-in and keeps every gap owned exactly once.
		outputFrame += entry.gapBeforeFrames;
		const durationFrames = region.endFrame - region.startFrame;
		segments.push(Object.freeze({
			entryId: entry.id,
			annotationId: entry.annotationId,
			title: masteringSequenceEntryTitle(entry, region),
			gapBeforeFrames: entry.gapBeforeFrames,
			outputStartFrame: outputFrame,
			outputEndFrame: outputFrame + durationFrames,
			sourceStartFrame: region.startFrame,
			sourceEndFrame: region.endFrame,
			fadeInFrames: entry.fadeInFrames,
			fadeOutFrames: entry.fadeOutFrames,
			metadata: entry.metadata,
		}));
		outputFrame += durationFrames;
	}

	return Object.freeze({
		sequenceId: sequence.id,
		segments: Object.freeze(segments),
		totalFrames: outputFrame,
	});
}

/**
 * The region cues a delivery emits, one per entry, at its delivered position.
 *
 * These ride the existing RIFF marker mechanics rather than introducing a second
 * cue model, and they describe positions in the *delivered file* — a cue that
 * pointed at a project-timeline position would be meaningless to whoever opens
 * the master.
 */
export function masteringSequenceDeliveryCues(
	plan: MasteringSequenceDeliveryPlan,
): readonly RiffMarkerInput[] {
	return Object.freeze(plan.segments.map((segment, index) => Object.freeze({
		id: index + 1,
		sampleOffset: segment.outputStartFrame,
		sampleLength: segment.outputEndFrame - segment.outputStartFrame,
		label: segment.title,
	})));
}

/**
 * Record what the sequence contributed to the delivery.
 *
 * Every entry becomes an item carrying its delivered position and its metadata,
 * because per-region metadata that reached the audio but not the report would be
 * a delivery decision nobody can see. Cue support is a property of the container,
 * so a format that cannot carry cues reports the omission rather than dropping
 * them silently — that is the difference between a lossy delivery and a hidden
 * one.
 */
export function addMasteringSequenceDeliveryItems(
	draft: Parameters<typeof addDeliveryReportItem>[0],
	plan: MasteringSequenceDeliveryPlan,
	options: Readonly<{ cuesSupported: boolean }>,
): void {
	for (const segment of plan.segments) {
		addDeliveryReportItem(draft, {
			code: 'delivery.mastering-sequence-entry',
			disposition: 'preserved',
			severity: 'info',
			scope: { kind: 'mastering-sequence-entry', id: segment.entryId },
			data: {
				title: segment.title,
				outputStartFrame: segment.outputStartFrame,
				durationFrames: segment.outputEndFrame - segment.outputStartFrame,
				gapBeforeFrames: segment.gapBeforeFrames,
				fadeInFrames: segment.fadeInFrames,
				fadeOutFrames: segment.fadeOutFrames,
				metadata: segment.metadata,
			},
			message: 'The entry was delivered at this position with its authored metadata.',
		});
	}
	if (plan.segments.length === 0) return;
	addDeliveryReportItem(draft, options.cuesSupported ? {
		code: 'delivery.mastering-sequence-cues',
		disposition: 'preserved',
		severity: 'info',
		data: { cues: plan.segments.length },
		message: 'A region cue was written for every entry.',
	} : {
		code: 'delivery.mastering-sequence-cues-omitted',
		disposition: 'omitted',
		severity: 'warning',
		data: { cues: plan.segments.length },
		message: 'This format cannot carry cues, so the region boundaries were not written into the delivery.',
	});
}

/** True when the delivered timeline is exactly the regions plus their gaps. */
export function masteringSequenceDeliveryFrameCount(
	plan: MasteringSequenceDeliveryPlan,
): number {
	return plan.totalFrames;
}
