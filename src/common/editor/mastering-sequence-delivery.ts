/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	assertMasteringSequenceDeliverableV23,
	masteringSequenceEntryTitle,
	validateMasteringSequenceV23,
	type MasteringSequenceRegionView,
	type MasteringSequenceV23,
} from './mastering-sequence.ts';
import type { DeliveryDisposition, DeliverySeverity } from './delivery-report.ts';
import type { RiffMarkerInput } from './riff-markers.ts';
import { scaleSampleFrame } from './timeline-time.ts';

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
 * Express one delivery plan in the sample rate the file is written at.
 *
 * Delivery positions are resolved in project frames, but the cues and the
 * assembled audio live in the delivered file's rate, and the two only agree if
 * the conversion happens once. Each gap and each region extent is scaled and
 * rounded on its own and then accumulated, so the delivered length stays the
 * exact sum of its parts — scaling the accumulated positions instead would let
 * rounding move a boundary away from the audio it belongs to.
 *
 * Source frames are left in the project's rate: they say what to render, not
 * what was written.
 */
export function scaleMasteringSequenceDeliveryPlan(
	plan: MasteringSequenceDeliveryPlan,
	rates: Readonly<{ sourceSampleRate: number; outputSampleRate: number }>,
): MasteringSequenceDeliveryPlan {
	const { sourceSampleRate, outputSampleRate } = rates;
	for (const rate of [sourceSampleRate, outputSampleRate]) {
		if (!Number.isFinite(rate) || rate <= 0) {
			throw new RangeError('A mastering sequence delivery requires positive sample rates.');
		}
	}
	if (sourceSampleRate === outputSampleRate) return plan;
	const scale = (frames: number): number => scaleSampleFrame(
		frames, sourceSampleRate, outputSampleRate, 'point',
	);

	const segments: MasteringSequenceDeliverySegment[] = [];
	let outputFrame = 0;
	for (const segment of plan.segments) {
		const gapBeforeFrames = scale(segment.gapBeforeFrames);
		outputFrame += gapBeforeFrames;
		const durationFrames = scale(segment.outputEndFrame - segment.outputStartFrame);
		segments.push(Object.freeze({
			...segment,
			gapBeforeFrames,
			outputStartFrame: outputFrame,
			outputEndFrame: outputFrame + durationFrames,
			fadeInFrames: scale(segment.fadeInFrames),
			fadeOutFrames: scale(segment.fadeOutFrames),
		}));
		outputFrame += durationFrames;
	}
	return Object.freeze({
		sequenceId: plan.sequenceId,
		segments: Object.freeze(segments),
		totalFrames: outputFrame,
	});
}

interface MasteringSequenceDeliveryConversion {
	readonly code: string;
	readonly disposition: DeliveryDisposition;
	readonly severity: DeliverySeverity;
	readonly data: Readonly<Record<string, unknown>>;
	readonly scope?: Readonly<Record<string, unknown>>;
	readonly message?: string;
}

/**
 * What the sequence contributed to the delivery, derived from the plan.
 *
 * This joins the plan-derived inventory rather than being appended by whoever
 * wrote the export path, which is what stops a sequence delivery from quietly
 * losing something: every entry becomes an item carrying its delivered position
 * and its metadata, because per-region metadata that reached the audio but not
 * the report would be a delivery decision nobody can see. Cue support is a
 * property of the container, so a format that cannot carry cues reports the
 * omission — that is the difference between a lossy delivery and a hidden one,
 * and `delivery.unreportedConversions` counts the difference.
 */
export function masteringSequenceDeliveryConversions(
	plan: unknown,
	cuesSupported: boolean,
): readonly MasteringSequenceDeliveryConversion[] {
	if (!isDeliveryPlan(plan) || plan.segments.length === 0) return Object.freeze([]);
	const conversions: MasteringSequenceDeliveryConversion[] = plan.segments.map((segment) => Object.freeze({
		code: 'delivery.mastering-sequence-entry',
		disposition: 'preserved' as DeliveryDisposition,
		severity: 'info' as DeliverySeverity,
		scope: Object.freeze({ kind: 'mastering-sequence-entry', id: segment.entryId }),
		data: Object.freeze({
			title: segment.title,
			outputStartFrame: segment.outputStartFrame,
			durationFrames: segment.outputEndFrame - segment.outputStartFrame,
			gapBeforeFrames: segment.gapBeforeFrames,
			fadeInFrames: segment.fadeInFrames,
			fadeOutFrames: segment.fadeOutFrames,
			metadata: segment.metadata,
		}),
		message: 'The entry was delivered at this position with its authored metadata.',
	}));
	conversions.push(Object.freeze(cuesSupported ? {
		code: 'delivery.mastering-sequence-cues',
		disposition: 'preserved' as DeliveryDisposition,
		severity: 'info' as DeliverySeverity,
		data: Object.freeze({ cues: plan.segments.length }),
		message: 'A region cue was written for every entry.',
	} : {
		code: 'delivery.mastering-sequence-cues-omitted',
		disposition: 'omitted' as DeliveryDisposition,
		severity: 'warning' as DeliverySeverity,
		data: Object.freeze({ cues: plan.segments.length }),
		message: 'This format cannot carry cues, so the region boundaries were not written into the delivery.',
	}));
	return Object.freeze(conversions);
}

function isDeliveryPlan(value: unknown): value is MasteringSequenceDeliveryPlan {
	return Boolean(value)
		&& typeof value === 'object'
		&& Array.isArray((value as MasteringSequenceDeliveryPlan).segments);
}
