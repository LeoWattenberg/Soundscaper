/* SPDX-License-Identifier: AGPL-3.0-only */

import { isTimelineAnnotationProjectSchema } from '../project-schema-version.ts';
import {
	resolveRuntimeTimelineAnnotationsInDocumentOrder,
	restoreTimelineAnnotationsFromRuntimeProjection,
	type RuntimeTimelineAnnotationProject,
	type RuntimeTimelineAnnotationProjection,
} from '../runtime-timeline-annotation-projection.ts';
import { isRuntimeProjectProjection } from '../runtime-clip-projection.ts';
import {
	createTimelineAnnotationsV11,
	type TimelineAnnotationV11,
} from '../timeline-annotation.ts';
import { sampleFrameToBeat } from '../timeline-tempo-inverse.ts';
import {
	addRationals,
	compareRationals,
	scaleSampleFrame,
	subtractRationals,
	type HoldTempoMap,
	type Rational,
} from '../timeline-time.ts';
import type {
	AudioEditorClipboard,
	AudioEditorClipboardAnnotation,
} from './protocol.ts';

// foundation-edit-matrix: paste
// foundation-edit-matrix: duplicate

type DataRecord = Record<string, unknown>;

interface ClipboardAnnotationProject extends RuntimeTimelineAnnotationProject, DataRecord {
	readonly schemaVersion: number;
	readonly selection?: Readonly<{ readonly annotationIds?: readonly string[] }>;
}

interface MutableClipboardAnnotationProject extends DataRecord {
	schemaVersion: number;
	sampleRate: number;
	tempoMap: HoldTempoMap;
	sequences: readonly Readonly<{ readonly id: unknown }>[];
	timelineAnnotations: RuntimeTimelineAnnotationProjection[];
}

export interface TimelineAnnotationClipboardCopyOptions {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly sourceSequenceIds: readonly string[];
	readonly annotationIds?: readonly string[];
}

export interface TimelineAnnotationClipboardPasteGeometry {
	readonly placementFrameBySequenceId: ReadonlyMap<string, number>;
	readonly insertionSpanBySequenceId: ReadonlyMap<string, Readonly<{
		readonly startFrame: number;
		readonly endFrame: number;
	}>>;
}

interface ValidatedAnnotationPasteMaps {
	readonly sequenceMap: Readonly<Record<string, string>>;
	readonly annotationIds: Readonly<Record<string, string>>;
	readonly annotationBatchIds: Readonly<Record<string, string>>;
}

/** Encode selected annotations plus range-overlapping peers in participating sequences. */
export function createTimelineAnnotationClipboardDescriptors(
	projectValue: unknown,
	options: TimelineAnnotationClipboardCopyOptions,
): readonly AudioEditorClipboardAnnotation[] {
	const project = projectRecord(projectValue);
	if (!isTimelineAnnotationProjectSchema(project.schemaVersion)) return Object.freeze([]);
	const startFrame = nonNegativeSafeInteger(options.startFrame, 'clipboard range startFrame');
	const endFrame = nonNegativeSafeInteger(options.endFrame, 'clipboard range endFrame');
	if (endFrame <= startFrame) throw new RangeError('The clipboard range must have a positive duration.');
	const sourceSequenceIds = new Set(canonicalIdArray(options.sourceSequenceIds, 'sourceSequenceIds'));
	const selectedIds = new Set([
		...canonicalIdArray(project.selection?.annotationIds || [], 'project.selection.annotationIds'),
		...canonicalIdArray(options.annotationIds || [], 'clipboard annotationIds'),
	]);
	const authoritative = restoreTimelineAnnotationsFromRuntimeProjection(project);
	const projected = resolveRuntimeTimelineAnnotationsInDocumentOrder({ ...project, timelineAnnotations: authoritative });
	const startBeat = sampleFrameToBeat(startFrame, project.tempoMap, project.sampleRate);
	return Object.freeze(projected.flatMap((annotation) => {
		const selected = selectedIds.has(annotation.id);
		const participating = sourceSequenceIds.size === 0 || sourceSequenceIds.has(annotation.sequenceId);
		const overlaps = annotation.kind === 'marker'
			? annotation.timelineStartFrame >= startFrame && annotation.timelineStartFrame < endFrame
			: annotation.timelineStartFrame < endFrame && annotation.timelineEndFrame > startFrame;
		if (!selected && (!participating || !overlaps)) return [];
		return [annotationDescriptor(annotation, startFrame, startBeat)];
	}));
}

/**
 * Open the same span in the annotations that an edit opens in the media.
 *
 * A three-point insert ripples every media lane of the sequences it names, and a
 * marker or region that sat after the insert point annotates material that has
 * moved. Insert-mode paste has always expanded them; the three-point insert was
 * the odd one out and left them behind, describing whatever ended up under them.
 */
export function stageTimelineAnnotationInsertMutation(
	projectValue: unknown,
	spanBySequenceId: ReadonlyMap<string, Readonly<{ startFrame: number; endFrame: number }>>,
): () => void {
	const project = dataRecord(projectValue, 'project') as MutableClipboardAnnotationProject;
	if (spanBySequenceId.size === 0) return () => undefined;
	if (!isTimelineAnnotationProjectSchema(project.schemaVersion)) return () => undefined;
	if (project.timelineAnnotations.length === 0) return () => undefined;
	if (!isRuntimeProjectProjection(project)) {
		throw new TypeError('Timeline annotation insertion requires a trusted runtime projection.');
	}
	const authoritative = restoreTimelineAnnotationsFromRuntimeProjection(
		project as unknown as RuntimeTimelineAnnotationProject,
	);
	const canonical = createTimelineAnnotationsV11(
		expandAnnotations(project, authoritative, spanBySequenceId),
		collectionContext(project),
	);
	const projected = resolveRuntimeTimelineAnnotationsInDocumentOrder({
		...project,
		timelineAnnotations: canonical,
	});
	return () => {
		project.timelineAnnotations.splice(0, project.timelineAnnotations.length, ...projected);
	};
}

/** Validate ID/sequence maps and stage expansion plus additions as one projected replacement. */
export function stageTimelineAnnotationClipboardPaste(
	projectValue: unknown,
	clipboard: AudioEditorClipboard,
	commandValue: unknown,
	mode: string,
	geometry: TimelineAnnotationClipboardPasteGeometry,
): () => void {
	const project = dataRecord(projectValue, 'project') as MutableClipboardAnnotationProject;
	const command = dataRecord(commandValue, 'clipboard paste command');
	const annotations = clipboard.schemaVersion >= 3 ? clipboard.annotations || [] : [];
	if (annotations.length && !isTimelineAnnotationProjectSchema(project.schemaVersion)) {
		throw new RangeError('Timeline annotation paste requires schema 11 or 12.');
	}
	let maps: ValidatedAnnotationPasteMaps | null = null;
	if (clipboard.schemaVersion < 3) {
		for (const key of ['sequenceMap', 'annotationIds', 'annotationBatchIds']) {
			if (Object.hasOwn(command, key)) throw new TypeError(`Legacy clipboard paste cannot contain ${key}.`);
		}
	} else {
		maps = validateCurrentMaps(project, clipboard, command);
	}
	const expands = mode === 'insert-all'
		&& isTimelineAnnotationProjectSchema(project.schemaVersion)
		&& project.timelineAnnotations.length > 0;
	if (!annotations.length && !expands) return () => undefined;
	if (!isRuntimeProjectProjection(project)) {
		throw new TypeError('Timeline annotation paste requires a trusted runtime projection.');
	}
	const authoritative = restoreTimelineAnnotationsFromRuntimeProjection(
		project as unknown as RuntimeTimelineAnnotationProject,
	);
	const expanded = expands ? expandAnnotations(project, authoritative, geometry.insertionSpanBySequenceId) : authoritative;
	const additions = maps === null ? [] : annotations.map((descriptor) => pastedAnnotation(
		project,
		descriptor,
		maps,
		geometry,
		clipboard.sampleRate,
	));
	const canonical = createTimelineAnnotationsV11([...expanded, ...additions], collectionContext(project));
	const projected = resolveRuntimeTimelineAnnotationsInDocumentOrder({
		...project,
		timelineAnnotations: canonical,
	});
	return () => {
		project.timelineAnnotations.splice(0, project.timelineAnnotations.length, ...projected);
	};
}

function annotationDescriptor(
	annotation: RuntimeTimelineAnnotationProjection,
	startFrame: number,
	startBeat: Rational,
): AudioEditorClipboardAnnotation {
	const common = {
		key: annotation.id,
		sourceSequenceId: annotation.sequenceId,
		name: annotation.name,
		color: annotation.color,
		batchId: annotation.batchId,
		opaqueExtensions: structuredClone(annotation.opaqueExtensions),
	};
	if (annotation.kind === 'marker' && annotation.anchor === 'sample') {
		return Object.freeze({ ...common, kind: annotation.kind, anchor: annotation.anchor, positionOffsetFrame: annotation.positionFrame - startFrame });
	}
	if (annotation.kind === 'marker') {
		return Object.freeze({ ...common, kind: annotation.kind, anchor: annotation.anchor, positionOffsetBeat: subtractRationals(annotation.positionBeat, startBeat) });
	}
	if (annotation.anchor === 'sample') {
		return Object.freeze({
			...common,
			kind: annotation.kind,
			anchor: annotation.anchor,
			startOffsetFrame: annotation.startFrame - startFrame,
			endOffsetFrame: annotation.endFrame - startFrame,
		});
	}
	return Object.freeze({
		...common,
		kind: annotation.kind,
		anchor: annotation.anchor,
		startOffsetBeat: subtractRationals(annotation.startBeat, startBeat),
		endOffsetBeat: subtractRationals(annotation.endBeat, startBeat),
	});
}

function validateCurrentMaps(
	project: MutableClipboardAnnotationProject,
	clipboard: AudioEditorClipboard,
	command: DataRecord,
): ValidatedAnnotationPasteMaps {
	const annotations = clipboard.annotations || [];
	const sourceSequenceIds = new Set([
		...clipboard.tracks.map((track) => canonicalId(track.sourceSequenceId, 'clipboard track sourceSequenceId')),
		...annotations.map((annotation) => annotation.sourceSequenceId),
	]);
	const annotationKeys = annotations.map((annotation) => annotation.key);
	const batchIds = [...new Set(annotations.flatMap((annotation) => annotation.batchId ? [annotation.batchId] : []))];
	const sequenceMap = exactIdMap(
		ownDataValue(command, 'sequenceMap', 'paste'),
		sourceSequenceIds,
		'paste.sequenceMap',
	);
	const annotationIds = exactIdMap(
		ownDataValue(command, 'annotationIds', 'paste'),
		new Set(annotationKeys),
		'paste.annotationIds',
	);
	const annotationBatchIds = exactIdMap(
		ownDataValue(command, 'annotationBatchIds', 'paste'),
		new Set(batchIds),
		'paste.annotationBatchIds',
	);
	const destinationSequenceIds = new Set(project.sequences.map((sequence, index) => (
		canonicalId(sequence.id, `project.sequences[${String(index)}].id`)
	)));
	for (const [sourceId, targetId] of Object.entries(sequenceMap)) {
		if (!destinationSequenceIds.has(targetId)) throw new ReferenceError(`Paste sequence ${sourceId} maps to missing sequence ${targetId}.`);
	}
	const existingAnnotations = Array.isArray(project.timelineAnnotations) ? project.timelineAnnotations : [];
	assertFreshMap(annotationIds, annotationKeys, new Set(existingAnnotations.map(({ id }) => id)), 'annotation');
	const existingBatchIds = new Set(existingAnnotations.flatMap(({ batchId }) => batchId ? [batchId] : []));
	assertFreshMap(annotationBatchIds, batchIds, existingBatchIds, 'annotation batch');
	return Object.freeze({ sequenceMap, annotationIds, annotationBatchIds });
}

function assertFreshMap(
	map: Readonly<Record<string, string>>,
	sourceIds: readonly string[],
	existingIds: ReadonlySet<string>,
	name: string,
): void {
	const values = new Set<string>();
	for (const sourceId of sourceIds) {
		const targetId = map[sourceId];
		if (targetId === sourceId || existingIds.has(targetId)) throw new RangeError(`A fresh pasted ${name} ID is required for ${sourceId}.`);
		if (values.has(targetId)) throw new RangeError(`Pasted ${name} IDs must be unique.`);
		values.add(targetId);
	}
}

function pastedAnnotation(
	project: MutableClipboardAnnotationProject,
	descriptor: AudioEditorClipboardAnnotation,
	maps: ValidatedAnnotationPasteMaps,
	geometry: TimelineAnnotationClipboardPasteGeometry,
	inputSampleRate: number,
): TimelineAnnotationV11 {
	const sequenceId = maps.sequenceMap[descriptor.sourceSequenceId];
	const placementFrame = geometry.placementFrameBySequenceId.get(sequenceId);
	if (placementFrame === undefined) throw new ReferenceError(`Paste geometry is missing target sequence ${sequenceId}.`);
	const baseBeat = sampleFrameToBeat(placementFrame, project.tempoMap, project.sampleRate);
	const common = {
		id: maps.annotationIds[descriptor.key],
		sequenceId,
		name: descriptor.name,
		color: descriptor.color,
		batchId: descriptor.batchId === null ? null : maps.annotationBatchIds[descriptor.batchId],
		opaqueExtensions: descriptor.opaqueExtensions,
	};
	if (descriptor.kind === 'marker' && descriptor.anchor === 'sample') {
		return { ...common, kind: descriptor.kind, anchor: descriptor.anchor, positionFrame: scaledOffsetPosition(placementFrame, descriptor.positionOffsetFrame, inputSampleRate, project.sampleRate) };
	}
	if (descriptor.kind === 'marker') {
		return { ...common, kind: descriptor.kind, anchor: descriptor.anchor, positionBeat: addRationals(baseBeat, descriptor.positionOffsetBeat) };
	}
	if (descriptor.anchor === 'sample') {
		const startFrame = scaledOffsetPosition(
			placementFrame,
			descriptor.startOffsetFrame,
			inputSampleRate,
			project.sampleRate,
		);
		const scaledEndFrame = scaledOffsetPosition(
			placementFrame,
			descriptor.endOffsetFrame,
			inputSampleRate,
			project.sampleRate,
		);
		return {
			...common,
			kind: descriptor.kind,
			anchor: descriptor.anchor,
			startFrame,
			endFrame: positiveSampleRegionEnd(startFrame, scaledEndFrame),
		};
	}
	return {
		...common,
		kind: descriptor.kind,
		anchor: descriptor.anchor,
		startBeat: addRationals(baseBeat, descriptor.startOffsetBeat),
		endBeat: addRationals(baseBeat, descriptor.endOffsetBeat),
	};
}

function scaledOffsetPosition(base: number, offset: number, inputRate: number, outputRate: number): number {
	const scaled = scaleSampleFrame(offset, inputRate, outputRate, 'point');
	const result = base + scaled;
	if (!Number.isSafeInteger(result) || result < 0) throw new RangeError('A pasted annotation resolves outside the sample timeline.');
	return result;
}

function positiveSampleRegionEnd(startFrame: number, scaledEndFrame: number): number {
	if (scaledEndFrame > startFrame) return scaledEndFrame;
	if (startFrame === Number.MAX_SAFE_INTEGER) {
		throw new RangeError('The minimum pasted annotation region resolves outside the sample timeline.');
	}
	return startFrame + 1;
}

function expandAnnotations(
	project: MutableClipboardAnnotationProject,
	annotations: readonly TimelineAnnotationV11[],
	spanBySequenceId: ReadonlyMap<string, Readonly<{ startFrame: number; endFrame: number }>>,
): readonly TimelineAnnotationV11[] {
	const operations = new Map([...spanBySequenceId].map(([sequenceId, span]) => [sequenceId, {
		sampleStart: span.startFrame,
		sampleDelta: span.endFrame - span.startFrame,
		beatStart: sampleFrameToBeat(span.startFrame, project.tempoMap, project.sampleRate),
		beatDelta: subtractRationals(
			sampleFrameToBeat(span.endFrame, project.tempoMap, project.sampleRate),
			sampleFrameToBeat(span.startFrame, project.tempoMap, project.sampleRate),
		),
	}]));
	return annotations.map((annotation) => {
		const operation = operations.get(annotation.sequenceId);
		if (!operation) return annotation;
		if (annotation.kind === 'marker' && annotation.anchor === 'sample') {
			return annotation.positionFrame < operation.sampleStart
				? annotation : { ...annotation, positionFrame: annotation.positionFrame + operation.sampleDelta };
		}
		if (annotation.kind === 'marker') {
			return compareRationals(annotation.positionBeat, operation.beatStart) < 0
				? annotation : { ...annotation, positionBeat: addRationals(annotation.positionBeat, operation.beatDelta) };
		}
		if (annotation.anchor === 'sample') {
			if (annotation.endFrame <= operation.sampleStart) return annotation;
			if (annotation.startFrame >= operation.sampleStart) return {
				...annotation,
				startFrame: annotation.startFrame + operation.sampleDelta,
				endFrame: annotation.endFrame + operation.sampleDelta,
			};
			return { ...annotation, endFrame: annotation.endFrame + operation.sampleDelta };
		}
		if (compareRationals(annotation.endBeat, operation.beatStart) <= 0) return annotation;
		if (compareRationals(annotation.startBeat, operation.beatStart) >= 0) return {
			...annotation,
			startBeat: addRationals(annotation.startBeat, operation.beatDelta),
			endBeat: addRationals(annotation.endBeat, operation.beatDelta),
		};
		return { ...annotation, endBeat: addRationals(annotation.endBeat, operation.beatDelta) };
	});
}

function exactIdMap(value: unknown, expected: ReadonlySet<string>, name: string): Readonly<Record<string, string>> {
	const candidate = plainRecord(value, name);
	const keys = Reflect.ownKeys(candidate);
	const entries: Array<readonly [string, string]> = [];
	for (const key of keys) {
		if (typeof key !== 'string' || !expected.has(key)) throw new TypeError(`${name} contains an unexpected source ID: ${String(key)}.`);
		const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
		entries.push([key, canonicalId(descriptor.value, `${name}.${key}`)]);
	}
	for (const key of expected) if (!Object.hasOwn(candidate, key)) throw new TypeError(`${name}.${key} is required.`);
	return Object.freeze(Object.fromEntries(entries));
}

function ownDataValue(value: DataRecord, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
	}
	return descriptor.value;
}

function plainRecord(value: unknown, name: string): DataRecord {
	const candidate = dataRecord(value, name);
	const prototype = Object.getPrototypeOf(candidate);
	if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${name} must be a plain object.`);
	return candidate;
}

function collectionContext(project: MutableClipboardAnnotationProject) {
	return {
		sampleRate: project.sampleRate,
		tempoMap: project.tempoMap,
		sequenceIds: project.sequences.map((sequence, index) => canonicalId(sequence.id, `project.sequences[${String(index)}].id`)),
	};
}

function projectRecord(value: unknown): ClipboardAnnotationProject {
	return dataRecord(value, 'project') as ClipboardAnnotationProject;
}

function dataRecord(value: unknown, name: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as DataRecord;
}

function canonicalIdArray(value: readonly unknown[], name: string): string[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	const seen = new Set<string>();
	return value.map((candidate, index) => {
		const id = canonicalId(candidate, `${name}[${String(index)}]`);
		if (seen.has(id)) throw new RangeError(`${name} cannot contain duplicate IDs.`);
		seen.add(id);
		return id;
	});
}

function canonicalId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value.length || value !== value.trim()) throw new TypeError(`${name} must be a canonical non-empty string.`);
	return value;
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Object.is(value, -0) || Number(value) < 0) throw new RangeError(`${name} must be a non-negative safe integer.`);
	return Number(value);
}
