/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	masteringSequenceEntryTitle,
	type MasteringSequenceIssue,
	type MasteringSequenceRegionView,
	type MasteringSequenceV23,
} from '../mastering-sequence.ts';
import {
	masteringSequenceRegionViews,
	validateProjectMasteringSequence,
} from '../mastering-sequence-regions.ts';
import type { RuntimeTimelineAnnotationProject } from '../runtime-timeline-annotation-projection.ts';

/**
 * What the surfaces need to know about a project's mastering sequences.
 *
 * A sequence that cannot be delivered is still shown, with the reason attached:
 * a deleted region is a state the operator has to see and fix, and hiding the
 * sequence until it validates would hide the only place the fix can be made.
 * Positions are resolved here through the ordinary region bridge, so the panel
 * and the delivery agree about where a region is without either one asking the
 * tempo map twice.
 */

export interface DocumentMasteringSequenceEntrySnapshot {
	readonly id: string;
	readonly annotationId: string;
	readonly title: string;
	/**
	 * The title the entry itself stores, or null when it has none and takes the
	 * region's name. The editing surface needs the two apart: showing the
	 * effective title in an input that always submits pins the region's current
	 * name as an override the operator never asked for, and renaming the region
	 * then stops reaching the delivery.
	 */
	readonly titleOverride: string | null;
	/** Null when the entry's region is missing, which is also why it has an issue. */
	readonly durationFrames: number | null;
	readonly gapBeforeFrames: number;
	readonly fadeInFrames: number;
	readonly fadeOutFrames: number;
	readonly metadata: Readonly<Record<string, string>>;
}

export interface DocumentMasteringSequenceSnapshot {
	readonly id: string;
	readonly name: string;
	readonly sequenceId: string;
	readonly entries: readonly DocumentMasteringSequenceEntrySnapshot[];
	/** False when any issue is error-level; a delivery refuses on exactly this. */
	readonly deliverable: boolean;
	readonly issues: readonly MasteringSequenceIssue[];
	/** The delivered length including gaps, or null when it cannot be resolved. */
	readonly totalFrames: number | null;
}

export interface DocumentMasteringSequenceRegionSnapshot {
	readonly id: string;
	readonly name: string;
	readonly startFrame: number;
	readonly endFrame: number;
}

export interface DocumentMasteringSequenceDocumentSnapshot {
	readonly sequences: readonly DocumentMasteringSequenceSnapshot[];
	/** The regions an entry may point at, in timeline order. */
	readonly regions: readonly DocumentMasteringSequenceRegionSnapshot[];
}

const EMPTY: DocumentMasteringSequenceDocumentSnapshot = Object.freeze({
	sequences: Object.freeze([]),
	regions: Object.freeze([]),
});

/** Project mastering sequences only from documents that own the collection. */
export function createDocumentMasteringSequenceSnapshot(
	project: unknown,
): DocumentMasteringSequenceDocumentSnapshot {
	if (!holdsMasteringSequences(project)) return EMPTY;
	const document = project as unknown as RuntimeTimelineAnnotationProject;
	const regions = masteringSequenceRegionViews(document);
	const byId = new Map(regions.map((region) => [region.id, region]));
	const sequences = (project.masteringSequences as unknown as readonly MasteringSequenceV23[])
		.map((sequence) => snapshotSequence(document, sequence, byId));
	return Object.freeze({
		sequences: Object.freeze(sequences),
		regions: Object.freeze(regions
			.filter((region) => region.sequenceId === document.primarySequenceId)
			.map((region) => Object.freeze({
				id: region.id,
				name: region.name,
				startFrame: region.startFrame,
				endFrame: region.endFrame,
			}))),
	});
}

function snapshotSequence(
	project: RuntimeTimelineAnnotationProject,
	sequence: MasteringSequenceV23,
	regions: ReadonlyMap<string, MasteringSequenceRegionView>,
): DocumentMasteringSequenceSnapshot {
	const validation = validateProjectMasteringSequence(project, sequence);
	let totalFrames = 0;
	const entries = sequence.entries.map((entry) => {
		const region = regions.get(entry.annotationId) ?? null;
		const durationFrames = region ? region.endFrame - region.startFrame : null;
		totalFrames += entry.gapBeforeFrames + (durationFrames ?? 0);
		return Object.freeze({
			id: entry.id,
			annotationId: entry.annotationId,
			title: region ? masteringSequenceEntryTitle(entry, region) : entry.title ?? entry.annotationId,
			titleOverride: entry.title ?? null,
			durationFrames,
			gapBeforeFrames: entry.gapBeforeFrames,
			fadeInFrames: entry.fadeInFrames,
			fadeOutFrames: entry.fadeOutFrames,
			metadata: entry.metadata,
		});
	});
	return Object.freeze({
		id: sequence.id,
		name: sequence.name,
		sequenceId: sequence.sequenceId,
		entries: Object.freeze(entries),
		deliverable: validation.valid,
		issues: validation.issues,
		// A length that counted a missing region as zero would read as a shorter
		// delivery rather than as an unresolved one.
		totalFrames: validation.valid ? totalFrames : null,
	});
}

function holdsMasteringSequences(
	value: unknown,
): value is Readonly<Record<string, unknown>> & { masteringSequences: readonly unknown[] } {
	return value !== null
		&& typeof value === 'object'
		&& !Array.isArray(value)
		&& Array.isArray((value as Readonly<{ masteringSequences?: unknown }>).masteringSequences)
		// Sequences point at annotations, so a document holding one without the
		// collection it points into is not one this can resolve.
		&& Array.isArray((value as Readonly<{ timelineAnnotations?: unknown }>).timelineAnnotations);
}
