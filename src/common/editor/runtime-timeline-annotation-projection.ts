/* SPDX-License-Identifier: AGPL-3.0-only */

import { createIndexedBeatFrameProjector } from './indexed-tempo-projector.ts';
import {
	AUDIO_EDITOR_TIMELINE_ANNOTATION_LIMITS,
	createTimelineAnnotationsV11,
	type TimelineAnnotationV11,
	validateTimelineAnnotationsV11,
} from './timeline-annotation.ts';
import {
	compareRationals,
	type HoldTempoMap,
	type RationalInput,
} from './timeline-time.ts';

export interface RuntimeTimelineAnnotationProject extends Readonly<Record<string, unknown>> {
	readonly sampleRate: number;
	readonly tempoMap: HoldTempoMap;
	readonly sequences: readonly Readonly<{ readonly id: unknown }>[];
	readonly timelineAnnotations: readonly TimelineAnnotationV11[];
}

export type RuntimeTimelineAnnotationProjection = TimelineAnnotationV11 & Readonly<{
	timelineStartFrame: number;
	timelineEndFrame: number;
	durationFrames: number;
	coordinateDomain: 'resolved-samples';
}>;

type BeatFrameResolver = (beat: RationalInput) => number;

/** Resolve one annotation without introducing a second runtime timing authority. */
export function resolveRuntimeTimelineAnnotationProjection(
	project: RuntimeTimelineAnnotationProject,
	annotation: TimelineAnnotationV11,
): RuntimeTimelineAnnotationProjection {
	const context = projectionContext(project);
	return resolveAnnotation(annotation, context.resolveBeatFrame);
}

/** Resolve and deterministically sort a transient annotation view. Persisted order is never changed. */
export function resolveRuntimeTimelineAnnotationsProjection(
	project: RuntimeTimelineAnnotationProject,
): readonly RuntimeTimelineAnnotationProjection[] {
	const projected = resolveRuntimeTimelineAnnotationsInDocumentOrder(project);
	const sequenceOrder = projectSequenceOrder(project);
	return Object.freeze([...projected].sort((left, right) => (
		sequenceIndex(sequenceOrder, left.sequenceId) - sequenceIndex(sequenceOrder, right.sequenceId)
			|| compareRuntimeTimelineAnnotations(left, right)
	)));
}

/** Resolve the command-facing annotation view without changing persisted document order. */
export function resolveRuntimeTimelineAnnotationsInDocumentOrder(
	project: RuntimeTimelineAnnotationProject,
): readonly RuntimeTimelineAnnotationProjection[] {
	if (!project || typeof project !== 'object') throw new TypeError('An annotation project is required.');
	if (!Array.isArray(project.timelineAnnotations)) {
		throw new TypeError('project.timelineAnnotations must be an array.');
	}
	if (project.timelineAnnotations.length > AUDIO_EDITOR_TIMELINE_ANNOTATION_LIMITS.maximumAnnotations) {
		throw new RangeError(
			`project.timelineAnnotations cannot exceed ${String(AUDIO_EDITOR_TIMELINE_ANNOTATION_LIMITS.maximumAnnotations)} annotations.`,
		);
	}
	const sequenceOrder = projectSequenceOrder(project);
	for (const annotation of project.timelineAnnotations) sequenceIndex(sequenceOrder, annotation.sequenceId);
	const context = projectionContext(project);
	return Object.freeze(project.timelineAnnotations.map((annotation) => (
		resolveAnnotation(annotation, context.resolveBeatFrame)
	)));
}

/**
 * Restore the authoritative wire collection only from a complete resolved
 * projection. The four transient fields are the only properties removed.
 */
export function restoreTimelineAnnotationsFromRuntimeProjection(
	project: RuntimeTimelineAnnotationProject,
): readonly TimelineAnnotationV11[] {
	if (!Array.isArray(project.timelineAnnotations)) {
		throw new TypeError('project.timelineAnnotations must be an array.');
	}
	const candidates = persistedCandidates(project.timelineAnnotations);
	const context = collectionContext(project);
	validateTimelineAnnotationsV11(candidates, context);
	return createTimelineAnnotationsV11(candidates, context);
}

/** Validate the complete derived timing shape without re-running linear tempo scans. */
export function assertRuntimeTimelineAnnotationsProjectionShape(
	project: RuntimeTimelineAnnotationProject,
): void {
	if (!Array.isArray(project.timelineAnnotations)) {
		throw new TypeError('project.timelineAnnotations must be an array.');
	}
	const candidates = persistedCandidates(project.timelineAnnotations);
	const resolved = resolveRuntimeTimelineAnnotationsInDocumentOrder({
		...project,
		timelineAnnotations: candidates as unknown as readonly TimelineAnnotationV11[],
	});
	for (const [index, expected] of resolved.entries()) {
		const actual = project.timelineAnnotations[index] as Readonly<Record<string, unknown>>;
		if (actual.coordinateDomain !== expected.coordinateDomain
			|| actual.timelineStartFrame !== expected.timelineStartFrame
			|| actual.timelineEndFrame !== expected.timelineEndFrame
			|| actual.durationFrames !== expected.durationFrames) {
			throw new TypeError('A resolved runtime projection requires resolved timeline annotations.');
		}
	}
}

/**
 * Compare projected annotations by timing semantics, then stable ID.
 * Relational string comparison is deliberately binary and never locale-aware.
 */
export function compareRuntimeTimelineAnnotations(
	left: RuntimeTimelineAnnotationProjection,
	right: RuntimeTimelineAnnotationProjection,
): number {
	return integerCompare(left.timelineStartFrame, right.timelineStartFrame)
		|| kindCompare(left, right)
		|| integerCompare(left.timelineEndFrame, right.timelineEndFrame)
		|| anchorCompare(left, right)
		|| authoritativeMusicalCompare(left, right)
		|| binaryCompare(left.id, right.id);
}

function kindCompare(
	left: RuntimeTimelineAnnotationProjection,
	right: RuntimeTimelineAnnotationProjection,
): -1 | 0 | 1 {
	return left.kind === right.kind ? 0 : left.kind === 'marker' ? -1 : 1;
}

function anchorCompare(
	left: RuntimeTimelineAnnotationProjection,
	right: RuntimeTimelineAnnotationProjection,
): -1 | 0 | 1 {
	return left.anchor === right.anchor ? 0 : left.anchor === 'sample' ? -1 : 1;
}

function authoritativeMusicalCompare(
	left: RuntimeTimelineAnnotationProjection,
	right: RuntimeTimelineAnnotationProjection,
): -1 | 0 | 1 {
	if (left.anchor !== 'musical' || right.anchor !== 'musical' || left.kind !== right.kind) return 0;
	if (left.kind === 'marker' && right.kind === 'marker') {
		return compareRationals(left.positionBeat, right.positionBeat);
	}
	if (left.kind === 'region' && right.kind === 'region') {
		return compareRationals(left.startBeat, right.startBeat)
			|| compareRationals(left.endBeat, right.endBeat);
	}
	return 0;
}

function projectionContext(project: RuntimeTimelineAnnotationProject): Readonly<{
	resolveBeatFrame: BeatFrameResolver;
}> {
	if (!project || typeof project !== 'object') throw new TypeError('An annotation project is required.');
	const sampleRate = positiveSafeInteger(project.sampleRate, 'project.sampleRate');
	if (!project.tempoMap || typeof project.tempoMap !== 'object') {
		throw new TypeError('project.tempoMap is required for annotation projection.');
	}
	return Object.freeze({
		resolveBeatFrame: createIndexedBeatFrameProjector(project.tempoMap, sampleRate),
	});
}

function collectionContext(project: RuntimeTimelineAnnotationProject) {
	return {
		tempoMap: project.tempoMap,
		sampleRate: project.sampleRate,
		sequenceIds: [...projectSequenceOrder(project).keys()],
	};
}

function persistedCandidates(
	annotations: readonly object[],
): readonly Record<string, unknown>[] {
	return annotations.map((annotation) => {
		const candidate = { ...annotation } as Record<string, unknown>;
		delete candidate.timelineStartFrame;
		delete candidate.timelineEndFrame;
		delete candidate.durationFrames;
		delete candidate.coordinateDomain;
		return candidate;
	});
}

function resolveAnnotation(
	annotation: TimelineAnnotationV11,
	resolveBeatFrame: BeatFrameResolver,
): RuntimeTimelineAnnotationProjection {
	if (!annotation || typeof annotation !== 'object') throw new TypeError('A timeline annotation is required.');
	let timelineStartFrame: number;
	let timelineEndFrame: number;
	if (annotation.kind === 'marker' && annotation.anchor === 'sample') {
		timelineStartFrame = nonNegativeSafeInteger(annotation.positionFrame, 'annotation.positionFrame');
		timelineEndFrame = timelineStartFrame;
	} else if (annotation.kind === 'marker') {
		timelineStartFrame = nonNegativeSafeInteger(
			resolveBeatFrame(annotation.positionBeat),
			'projected annotation position',
		);
		timelineEndFrame = timelineStartFrame;
	} else if (annotation.anchor === 'sample') {
		timelineStartFrame = nonNegativeSafeInteger(annotation.startFrame, 'annotation.startFrame');
		timelineEndFrame = nonNegativeSafeInteger(annotation.endFrame, 'annotation.endFrame');
	} else {
		timelineStartFrame = nonNegativeSafeInteger(
			resolveBeatFrame(annotation.startBeat),
			'projected annotation start',
		);
		timelineEndFrame = nonNegativeSafeInteger(
			resolveBeatFrame(annotation.endBeat),
			'projected annotation end',
		);
	}
	const durationFrames = timelineEndFrame - timelineStartFrame;
	if (!Number.isSafeInteger(durationFrames) || durationFrames < 0) {
		throw new RangeError('A projected annotation must have a non-negative safe duration.');
	}
	if (annotation.kind === 'region' && durationFrames === 0) {
		throw new RangeError('A projected annotation region must have a positive duration.');
	}
	return Object.freeze({
		...annotation,
		timelineStartFrame,
		timelineEndFrame,
		durationFrames,
		coordinateDomain: 'resolved-samples',
	});
}

function projectSequenceOrder(project: RuntimeTimelineAnnotationProject): ReadonlyMap<string, number> {
	if (!Array.isArray(project.sequences)) throw new TypeError('project.sequences must be an array.');
	const order = new Map<string, number>();
	for (const [index, sequence] of project.sequences.entries()) {
		const id = stableId(sequence?.id, `project.sequences[${String(index)}].id`);
		if (order.has(id)) throw new RangeError(`project.sequences contains duplicate sequence ID: ${id}.`);
		order.set(id, index);
	}
	return order;
}

function sequenceIndex(order: ReadonlyMap<string, number>, sequenceId: string): number {
	const index = order.get(sequenceId);
	if (index === undefined) throw new ReferenceError(`Timeline annotation references missing sequence ${sequenceId}.`);
	return index;
}

function integerCompare(left: number, right: number): -1 | 0 | 1 {
	return left < right ? -1 : left > right ? 1 : 0;
}

function binaryCompare(left: string, right: string): -1 | 0 | 1 {
	return left < right ? -1 : left > right ? 1 : 0;
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value.length || value !== value.trim()) {
		throw new TypeError(`${name} must be a canonical non-empty string.`);
	}
	return value;
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return Number(value);
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return Number(value);
}
