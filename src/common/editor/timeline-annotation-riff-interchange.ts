/* SPDX-License-Identifier: AGPL-3.0-only */

import { projectForRuntimeConsumers } from './project-current-runtime.ts';
import { isTimelineAnnotationProjectSchema } from './project-schema-version.ts';
import type { RiffMarker, RiffMarkerInput } from './riff-markers.ts';
import type { RuntimeClipProject } from './runtime-clip-projection.ts';
import {
	resolveRuntimeTimelineAnnotationsProjection,
	type RuntimeTimelineAnnotationProjection,
} from './runtime-timeline-annotation-projection.ts';
import {
	AUDIO_EDITOR_TIMELINE_ANNOTATION_LIMITS,
	createTimelineAnnotationsV11,
	type TimelineAnnotationV11,
} from './timeline-annotation.ts';
import {
	addTimelineAnnotationInterchangeItem,
	createTimelineAnnotationInterchangeReport,
	finalizeTimelineAnnotationInterchangeReport,
	type TimelineAnnotationInterchangeReport,
} from './timeline-annotation-interchange-report.ts';
import { scaleSampleFrame, type HoldTempoMap } from './timeline-time.ts';

const UINT32_MAX = 0xffff_ffff;
const INVALID_ANNOTATION_NAME_TEXT = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

type DataRecord = Record<string, unknown>;

export type RiffMarkerExportSource = 'timeline-annotations' | 'label-track' | 'none';

export interface RiffAnnotationExportOptions {
	readonly range: Readonly<{ readonly startFrame: number; readonly endFrame: number }>;
	readonly outputSampleRate: number;
	readonly markerSource?: RiffMarkerExportSource;
	readonly markerTrackId?: string;
	readonly preservedRiffMarkers?: boolean;
	/** The delivery writes a mastering sequence's region cues instead of these. */
	readonly masteringSequenceCues?: boolean;
}

export interface RiffAnnotationExportResult {
	readonly markers: readonly RiffMarkerInput[];
	readonly report: TimelineAnnotationInterchangeReport;
}

export interface RiffAnnotationImportProject extends Readonly<Record<string, unknown>> {
	readonly schemaVersion: number;
	readonly sampleRate: number;
	readonly tempoMap: HoldTempoMap;
	readonly primarySequenceId: string;
	readonly sequences: readonly Readonly<Record<string, unknown>>[];
	readonly timelineAnnotations: readonly TimelineAnnotationV11[];
}

export interface RiffAnnotationImportOptions {
	readonly sourceSampleRate: number;
	readonly timelineStartFrame: number;
	readonly idFactory: (prefix: string) => string;
}

export interface RiffAnnotationImportResult {
	readonly annotations: readonly TimelineAnnotationV11[];
	readonly report: TimelineAnnotationInterchangeReport;
}

/** Project schema-11-or-12 annotations or one explicitly selected legacy label track into RIFF cues. */
export function createRiffAnnotationExport(
	projectValue: RuntimeClipProject,
	options: RiffAnnotationExportOptions,
): RiffAnnotationExportResult {
	const project = projectForRuntimeConsumers(projectValue) as RuntimeClipProject & DataRecord;
	const range = exportRange(options.range);
	const inputSampleRate = positiveSafeInteger(project.sampleRate, 'project.sampleRate');
	const outputSampleRate = positiveSafeInteger(options.outputSampleRate, 'outputSampleRate');
	const source = markerSource(project, options);
	const report = createTimelineAnnotationInterchangeReport('export', source);
	if (source === 'none') return frozenExport([], report);
	if (options.preservedRiffMarkers === true) {
		const itemCount = sourceItemCount(project, source, options);
		if (itemCount) addItem(
			report,
			'RIFF_MARKER_SOURCE_OMITTED_FOR_PASSTHROUGH',
			'omitted',
			null,
			'Authored marker metadata was omitted because the BW64 passthrough preserves its original RIFF marker chunks byte-for-byte.',
			{ itemCount, source },
		);
		return frozenExport([], report);
	}
	if (options.masteringSequenceCues === true) {
		// The delivered timeline is a splice of regions in an authored order, so a
		// project-timeline position has no delivered counterpart to be written at.
		// The cues that are written describe the sequence instead.
		const itemCount = sourceItemCount(project, source, options);
		if (itemCount) addItem(
			report,
			'RIFF_MARKER_SOURCE_REPLACED_BY_MASTERING_SEQUENCE',
			'omitted',
			null,
			'Authored markers were omitted because this delivery writes the mastering sequence\'s region cues.',
			{ itemCount, source },
		);
		return frozenExport([], report);
	}
	if (source === 'label-track') {
		return frozenExport(labelTrackMarkers(project, range, inputSampleRate, outputSampleRate, options, report), report);
	}
	const annotationProject = project as unknown as Parameters<typeof resolveRuntimeTimelineAnnotationsProjection>[0];
	const annotations = resolveRuntimeTimelineAnnotationsProjection(annotationProject);
	const primarySequenceId = canonicalId(project.primarySequenceId, 'project.primarySequenceId');
	const usedCueIds = new Set<number>();
	const markers: RiffMarkerInput[] = [];
	for (const annotation of annotations) {
		if (annotation.sequenceId !== primarySequenceId) {
			addItem(report, 'RIFF_ANNOTATION_NON_PRIMARY_SEQUENCE_OMITTED', 'omitted', annotation.id,
				'RIFF has one flat timeline; an annotation outside the primary sequence was omitted.', {
					sequenceId: annotation.sequenceId,
				});
			continue;
		}
		const marker = projectedAnnotationMarker(
			annotation,
			range,
			inputSampleRate,
			outputSampleRate,
			allocateCueId(annotation.id, usedCueIds),
			report,
		);
		if (marker) markers.push(marker);
	}
	return frozenExport(markers, report);
}

function sourceItemCount(
	project: RuntimeClipProject & DataRecord,
	source: RiffMarkerExportSource,
	options: RiffAnnotationExportOptions,
): number {
	return source === 'timeline-annotations'
		? recordArray(project.timelineAnnotations).length
		: selectedLabelCount(project, options.markerTrackId);
}

/** Convert parsed RIFF cues into fresh sample-authoritative primary-sequence annotations. */
export function createRiffAnnotationImport(
	project: RiffAnnotationImportProject,
	markers: readonly RiffMarker[],
	options: RiffAnnotationImportOptions,
): RiffAnnotationImportResult {
	if (!isTimelineAnnotationProjectSchema(project)) {
		throw new RangeError('RIFF annotation import requires a maintained timeline-annotation project schema.');
	}
	if (!Array.isArray(markers)) throw new TypeError('RIFF annotation import markers must be an array.');
	const sourceSampleRate = positiveSafeInteger(options.sourceSampleRate, 'sourceSampleRate');
	const projectSampleRate = positiveSafeInteger(project.sampleRate, 'project.sampleRate');
	const timelineStartFrame = nonNegativeSafeInteger(options.timelineStartFrame, 'timelineStartFrame');
	if (typeof options.idFactory !== 'function') throw new TypeError('RIFF annotation import requires an ID factory.');
	const report = createTimelineAnnotationInterchangeReport('import', 'timeline-annotations');
	const candidates = markers.map((marker, index) => {
		const normalized = riffMarker(marker, index);
		const relativeStart = scaleSampleFrame(normalized.sampleOffset, sourceSampleRate, projectSampleRate, 'point');
		const startFrame = safeAdd(timelineStartFrame, relativeStart, 'RIFF annotation start');
		const rawName = normalized.label || normalized.note || '';
		const name = canonicalAnnotationName(rawName);
		if (name !== rawName) addItem(
			report,
			'RIFF_ANNOTATION_NAME_NORMALIZED',
			'converted',
			null,
			'RIFF marker text was normalized for the single-line annotation name while its original text remains opaque.',
			{ cueId: normalized.id },
		);
		const common = {
			id: canonicalId(options.idFactory('annotation'), 'imported annotation ID'),
			sequenceId: canonicalId(project.primarySequenceId, 'project.primarySequenceId'),
			name,
			color: 'auto' as const,
			batchId: null,
			opaqueExtensions: {
				riffCue: {
					id: normalized.id,
					label: normalized.label,
					note: normalized.note,
					sampleOffset: normalized.sampleOffset,
					sampleLength: normalized.sampleLength,
				},
			},
		};
		if (normalized.sampleLength === 0) {
			return { ...common, kind: 'marker' as const, anchor: 'sample' as const, positionFrame: startFrame };
		}
		const sourceEnd = safeAdd(normalized.sampleOffset, normalized.sampleLength, 'RIFF source region end');
		const relativeEnd = scaleSampleFrame(sourceEnd, sourceSampleRate, projectSampleRate, 'point');
		const resolvedEnd = safeAdd(timelineStartFrame, relativeEnd, 'RIFF annotation end');
		const endFrame = resolvedEnd > startFrame
			? resolvedEnd
			: safeAdd(startFrame, 1, 'minimum RIFF annotation region end');
		if (resolvedEnd <= startFrame) addItem(
			report,
			'RIFF_ANNOTATION_REGION_EXPANDED_TO_MINIMUM_SAMPLE',
			'converted',
			common.id,
			'A positive RIFF region collapsed at the project rate and was expanded to one project sample.',
			{ cueId: normalized.id, resolvedStartFrame: startFrame, resolvedEndFrame: resolvedEnd },
		);
		return { ...common, kind: 'region' as const, anchor: 'sample' as const, startFrame, endFrame };
	});
	const all = createTimelineAnnotationsV11([...project.timelineAnnotations, ...candidates], {
		tempoMap: project.tempoMap,
		sampleRate: projectSampleRate,
		sequenceIds: project.sequences.map(({ id }) => canonicalId(id, 'project sequence ID')),
	});
	const annotations = Object.freeze(all.slice(project.timelineAnnotations.length));
	return Object.freeze({
		annotations,
		report: finalizeTimelineAnnotationInterchangeReport(report),
	});
}

export function createOmittedRiffAnnotationImportReport(
	markers: readonly RiffMarker[],
	reason: 'project-bin',
): TimelineAnnotationInterchangeReport {
	const report = createTimelineAnnotationInterchangeReport('import', 'timeline-annotations');
	if (markers.length) addItem(
		report,
		'RIFF_ANNOTATIONS_PROJECT_BIN_OMITTED',
		'omitted',
		null,
		'RIFF cues cannot be placed on a sequence when media is imported only to the Project Bin.',
		{ markerCount: markers.length, reason },
	);
	return finalizeTimelineAnnotationInterchangeReport(report);
}

function projectedAnnotationMarker(
	annotation: RuntimeTimelineAnnotationProjection,
	range: Readonly<{ startFrame: number; endFrame: number }>,
	inputSampleRate: number,
	outputSampleRate: number,
	id: number,
	report: ReturnType<typeof createTimelineAnnotationInterchangeReport>,
): RiffMarkerInput | null {
	if (annotation.kind === 'marker') {
		if (annotation.timelineStartFrame < range.startFrame || annotation.timelineStartFrame >= range.endFrame) {
			addItem(report, 'RIFF_ANNOTATION_OUTSIDE_EXPORT_RANGE', 'omitted', annotation.id,
				'A timeline marker outside the half-open export range was omitted.', {});
			return null;
		}
		const sampleOffset = scaleSampleFrame(
			annotation.timelineStartFrame - range.startFrame,
			inputSampleRate,
			outputSampleRate,
			'point',
		);
		if (sampleOffset > UINT32_MAX) return unrepresentableOffset(report, annotation.id);
		reportAnnotationSemanticLosses(annotation, report);
		return Object.freeze({
			id,
			sampleOffset,
			sampleLength: 0,
			label: annotation.name,
			note: riffNote(annotation),
		});
	}
	if (annotation.timelineEndFrame <= range.startFrame || annotation.timelineStartFrame >= range.endFrame) {
		addItem(report, 'RIFF_ANNOTATION_OUTSIDE_EXPORT_RANGE', 'omitted', annotation.id,
			'A timeline region outside the half-open export range was omitted.', {});
		return null;
	}
	const clippedStart = Math.max(annotation.timelineStartFrame, range.startFrame);
	const clippedEnd = Math.min(annotation.timelineEndFrame, range.endFrame);
	if (clippedStart !== annotation.timelineStartFrame || clippedEnd !== annotation.timelineEndFrame) {
		addItem(report, 'RIFF_ANNOTATION_REGION_CLIPPED', 'clipped', annotation.id,
			'A timeline region crossing the export range was clipped to the exported audio.', {
				originalStartFrame: annotation.timelineStartFrame,
				originalEndFrame: annotation.timelineEndFrame,
				retainedStartFrame: clippedStart,
				retainedEndFrame: clippedEnd,
			});
	}
	const sampleOffset = scaleSampleFrame(clippedStart - range.startFrame, inputSampleRate, outputSampleRate, 'point');
	const outputEnd = scaleSampleFrame(clippedEnd - range.startFrame, inputSampleRate, outputSampleRate, 'point');
	if (sampleOffset > UINT32_MAX) return unrepresentableOffset(report, annotation.id);
	if (outputEnd <= sampleOffset) {
		addItem(report, 'RIFF_ANNOTATION_REGION_UNREPRESENTABLE', 'omitted', annotation.id,
			'A positive timeline region collapsed below one output sample and was omitted.', {});
		return null;
	}
	let sampleLength = outputEnd - sampleOffset;
	if (sampleLength > UINT32_MAX) {
		addItem(report, 'RIFF_ANNOTATION_REGION_LENGTH_CLIPPED', 'clipped', annotation.id,
			'A timeline region exceeded the RIFF uint32 length field and was clipped.', {
				requestedSampleLength: sampleLength,
				retainedSampleLength: UINT32_MAX,
			});
		sampleLength = UINT32_MAX;
	}
	reportAnnotationSemanticLosses(annotation, report);
	return Object.freeze({
		id,
		sampleOffset,
		sampleLength,
		label: annotation.name,
		note: riffNote(annotation),
	});
}

function reportAnnotationSemanticLosses(
	annotation: RuntimeTimelineAnnotationProjection,
	report: ReturnType<typeof createTimelineAnnotationInterchangeReport>,
): void {
	if (annotation.anchor === 'musical') addItem(
		report,
		'RIFF_ANNOTATION_MUSICAL_ANCHOR_PROJECTED',
		'converted',
		annotation.id,
		'RIFF stores sample offsets, so the musical annotation anchor was projected through the tempo map.',
		{},
	);
	if (annotation.batchId !== null) addItem(
		report,
		'RIFF_ANNOTATION_BATCH_ID_OMITTED',
		'omitted',
		annotation.id,
		'RIFF cue metadata cannot retain timeline annotation batch identity.',
		{ batchId: annotation.batchId },
	);
	if (annotation.color !== 'auto') addItem(
		report,
		'RIFF_ANNOTATION_COLOR_OMITTED',
		'omitted',
		annotation.id,
		'RIFF cue metadata cannot retain timeline annotation color.',
		{ color: annotation.color },
	);
	if (Object.keys(annotation.opaqueExtensions).length > 0) addItem(
		report,
		'RIFF_ANNOTATION_OPAQUE_EXTENSIONS_OMITTED',
		'omitted',
		annotation.id,
		'RIFF cue metadata cannot retain timeline annotation opaque extensions.',
		{},
	);
	addItem(
		report,
		'RIFF_ANNOTATION_STABLE_ID_OMITTED',
		'omitted',
		annotation.id,
		'RIFF cue IDs do not retain Soundscaper timeline annotation stable identities.',
		{},
	);
}

function labelTrackMarkers(
	project: DataRecord,
	range: Readonly<{ startFrame: number; endFrame: number }>,
	inputSampleRate: number,
	outputSampleRate: number,
	options: RiffAnnotationExportOptions,
	report: ReturnType<typeof createTimelineAnnotationInterchangeReport>,
): readonly RiffMarkerInput[] {
	const tracks = recordArray(project.tracks).filter((track) => track.type === 'label');
	const track = options.markerTrackId == null
		? tracks[0]
		: tracks.find((candidate) => candidate.id === options.markerTrackId);
	if (!track) return [];
	return recordArray(track.labels).flatMap((label, index) => {
		const startFrame = nonNegativeSafeInteger(label.startFrame, `label ${String(label.id ?? index)} startFrame`);
		const endFrame = nonNegativeSafeInteger(label.endFrame ?? startFrame, `label ${String(label.id ?? index)} endFrame`);
		if (endFrame < startFrame) throw new RangeError(`label ${String(label.id ?? index)} endFrame cannot precede startFrame.`);
		const outside = endFrame === startFrame
			? startFrame < range.startFrame || startFrame >= range.endFrame
			: endFrame <= range.startFrame || startFrame >= range.endFrame;
		if (outside) {
			addItem(report, 'RIFF_LABEL_OUTSIDE_EXPORT_RANGE', 'omitted', null,
				'A maintained label outside the half-open export range was omitted.', { labelId: String(label.id ?? '') });
			return [];
		}
		const clippedStart = Math.max(startFrame, range.startFrame);
		const clippedEnd = Math.min(endFrame, range.endFrame);
		if (clippedStart !== startFrame || clippedEnd !== endFrame) addItem(
			report,
			'RIFF_LABEL_REGION_CLIPPED',
			'clipped',
			null,
			'A maintained label crossing the export range was clipped to the exported audio.',
			{ labelId: String(label.id ?? '') },
		);
		const sampleOffset = scaleSampleFrame(clippedStart - range.startFrame, inputSampleRate, outputSampleRate, 'point');
		const outputEnd = scaleSampleFrame(clippedEnd - range.startFrame, inputSampleRate, outputSampleRate, 'point');
		if (sampleOffset > UINT32_MAX || outputEnd - sampleOffset > UINT32_MAX) {
			addItem(report, 'RIFF_LABEL_UNREPRESENTABLE', 'omitted', null,
				'A maintained label could not fit the RIFF uint32 cue fields and was omitted.', { labelId: String(label.id ?? '') });
			return [];
		}
		if (endFrame > startFrame && outputEnd <= sampleOffset) {
			addItem(report, 'RIFF_LABEL_UNREPRESENTABLE', 'omitted', null,
				'A positive maintained label region collapsed below one output sample and was omitted.', {
					labelId: String(label.id ?? ''),
				});
			return [];
		}
		return [Object.freeze({
			id: index + 1,
			sampleOffset,
			sampleLength: Math.max(0, outputEnd - sampleOffset),
			label: String(label.title ?? ''),
			note: labelNote(label),
		})];
	});
}

function markerSource(project: DataRecord, options: RiffAnnotationExportOptions): RiffMarkerExportSource {
	if (options.markerTrackId !== undefined && options.markerSource === 'timeline-annotations') {
		throw new TypeError('markerTrackId cannot select a label track while markerSource selects timeline annotations.');
	}
	if (options.markerSource !== undefined) {
		if (!['timeline-annotations', 'label-track', 'none'].includes(options.markerSource)) {
			throw new RangeError('markerSource must be timeline-annotations, label-track, or none.');
		}
		if (options.markerSource === 'timeline-annotations'
			&& !isTimelineAnnotationProjectSchema(project)) {
			throw new RangeError('Timeline annotation RIFF export requires a maintained timeline-annotation project schema.');
		}
		return options.markerSource;
	}
	if (options.markerTrackId !== undefined) return 'label-track';
	return isTimelineAnnotationProjectSchema(project)
		? 'timeline-annotations'
		: 'label-track';
}

function selectedLabelCount(project: DataRecord, requestedTrackId: string | undefined): number {
	const tracks = recordArray(project.tracks).filter((track) => track.type === 'label');
	const track = requestedTrackId === undefined
		? tracks[0]
		: tracks.find(({ id }) => id === requestedTrackId);
	return track ? recordArray(track.labels).length : 0;
}

function allocateCueId(annotationId: string, used: Set<number>): number {
	let id = fnv1a32(annotationId) || 1;
	while (used.has(id)) id = id === UINT32_MAX ? 1 : id + 1;
	used.add(id);
	return id;
}

function fnv1a32(value: string): number {
	let hash = 0x811c9dc5;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

function riffNote(annotation: RuntimeTimelineAnnotationProjection): string {
	const cue = recordOrNull(annotation.opaqueExtensions.riffCue);
	return typeof cue?.note === 'string' ? cue.note : '';
}

function labelNote(label: DataRecord): string {
	const extensions = recordOrNull(label.opaqueExtensions);
	return typeof extensions?.note === 'string' ? extensions.note : '';
}

function canonicalAnnotationName(value: string): string {
	return value.replace(INVALID_ANNOTATION_NAME_TEXT, ' ').trim()
		.slice(0, AUDIO_EDITOR_TIMELINE_ANNOTATION_LIMITS.maximumNameCodeUnits);
}

function unrepresentableOffset(
	report: ReturnType<typeof createTimelineAnnotationInterchangeReport>,
	annotationId: string,
): null {
	addItem(report, 'RIFF_ANNOTATION_OFFSET_UNREPRESENTABLE', 'omitted', annotationId,
		'A timeline annotation exceeded the RIFF uint32 sample-offset field and was omitted.', {});
	return null;
}

function addItem(
	report: ReturnType<typeof createTimelineAnnotationInterchangeReport>,
	code: string,
	disposition: 'preserved' | 'converted' | 'clipped' | 'omitted',
	annotationId: string | null,
	message: string,
	data: Readonly<Record<string, unknown>>,
): void {
	addTimelineAnnotationInterchangeItem(report, { code, disposition, annotationId, message, data });
}

function frozenExport(
	markers: readonly RiffMarkerInput[],
	report: ReturnType<typeof createTimelineAnnotationInterchangeReport>,
): RiffAnnotationExportResult {
	return Object.freeze({
		markers: Object.freeze([...markers]),
		report: finalizeTimelineAnnotationInterchangeReport(report),
	});
}

function riffMarker(value: RiffMarker, index: number): RiffMarker {
	if (!value || typeof value !== 'object') throw new TypeError(`RIFF marker ${String(index)} must be an object.`);
	return {
		id: uint32(value.id, `RIFF marker ${String(index)} id`),
		sampleOffset: uint32(value.sampleOffset, `RIFF marker ${String(index)} sampleOffset`),
		sampleLength: uint32(value.sampleLength, `RIFF marker ${String(index)} sampleLength`),
		label: text(value.label, `RIFF marker ${String(index)} label`),
		note: text(value.note, `RIFF marker ${String(index)} note`),
	};
}

function exportRange(value: RiffAnnotationExportOptions['range']): Readonly<{ startFrame: number; endFrame: number }> {
	if (!value || typeof value !== 'object') throw new TypeError('A RIFF annotation export range is required.');
	const startFrame = nonNegativeSafeInteger(value.startFrame, 'export range startFrame');
	const endFrame = nonNegativeSafeInteger(value.endFrame, 'export range endFrame');
	if (endFrame <= startFrame) throw new RangeError('The RIFF annotation export range must be positive.');
	return Object.freeze({ startFrame, endFrame });
}

function recordArray(value: unknown): DataRecord[] {
	return Array.isArray(value)
		? value.filter((candidate): candidate is DataRecord => Boolean(candidate) && typeof candidate === 'object' && !Array.isArray(candidate))
		: [];
}

function recordOrNull(value: unknown): DataRecord | null {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as DataRecord : null;
}

function canonicalId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value || value !== value.trim()) throw new TypeError(`${name} must be a canonical ID.`);
	return value;
}

function text(value: unknown, name: string): string {
	if (typeof value !== 'string') throw new TypeError(`${name} must be a string.`);
	return value;
}

function uint32(value: unknown, name: string): number {
	if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > UINT32_MAX) {
		throw new RangeError(`${name} must be an unsigned 32-bit integer.`);
	}
	return Number(value);
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be a non-negative safe integer.`);
	return Number(value);
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new RangeError(`${name} must be a positive safe integer.`);
	return Number(value);
}

function safeAdd(left: number, right: number, name: string): number {
	if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right) || right > Number.MAX_SAFE_INTEGER - left) {
		throw new RangeError(`${name} exceeds the safe integer range.`);
	}
	return left + right;
}
