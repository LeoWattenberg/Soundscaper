/* SPDX-License-Identifier: AGPL-3.0-only */

import { addAup4CompatibilityItem } from './aup4-profile.js';
import { projectForRuntimeConsumers } from './project-current-runtime.ts';
import { isTimelineAnnotationProjectSchema } from './project-schema-version.ts';
import type { RuntimeClipProject } from './runtime-clip-projection.ts';
import {
	resolveRuntimeTimelineAnnotationsProjection,
	type RuntimeTimelineAnnotationProjection,
} from './runtime-timeline-annotation-projection.ts';

type DataRecord = Record<string, unknown>;

/** Flatten current timeline annotations into one additional Audacity label track. */
export function flattenAup4TimelineAnnotations(
	projectValue: RuntimeClipProject,
	normalizedProject: DataRecord,
	compatibilityReport: DataRecord,
): void {
	const project = projectForRuntimeConsumers(projectValue) as RuntimeClipProject & DataRecord;
	if (!isTimelineAnnotationProjectSchema(project.schemaVersion)) return;
	const projected = resolveRuntimeTimelineAnnotationsProjection(
		project as unknown as Parameters<typeof resolveRuntimeTimelineAnnotationsProjection>[0],
	);
	if (!projected.length) return;
	const primarySequenceId = canonicalId(project.primarySequenceId, 'project.primarySequenceId');
	const retained = projected.filter(({ sequenceId }) => sequenceId === primarySequenceId);
	const omittedSequenceCount = projected.length - retained.length;
	if (omittedSequenceCount) addItem(compatibilityReport, {
		code: 'TIMELINE_ANNOTATION_NON_PRIMARY_SEQUENCE_OMITTED',
		severity: 'warning',
		disposition: 'omitted',
		message: 'AUP4 has one flat timeline; annotations outside the primary sequence were omitted.',
		scope: { kind: 'project' },
		data: { count: omittedSequenceCount },
	});
	if (!retained.length) {
		clearNormalizedAnnotations(normalizedProject);
		return;
	}
	const selectedIds = new Set(stringArray(recordOrNull(project.selection)?.annotationIds));
	const labels = retained.map((annotation) => ({
		id: `aup4-annotation-${annotation.id}`,
		title: annotation.name,
		startFrame: annotation.timelineStartFrame,
		endFrame: annotation.timelineEndFrame,
		color: 'auto',
		selected: selectedIds.has(annotation.id),
		opaqueExtensions: {},
	}));
	const tracks = recordArray(normalizedProject.tracks, 'normalizedProject.tracks');
	tracks.push({
		schemaVersion: 2,
		type: 'label',
		id: uniqueTrackId(tracks, 'soundscaper-timeline-annotations'),
		name: 'Timeline annotations',
		labels,
		color: 'auto',
		collapsed: false,
		height: 96,
		opaqueExtensions: {},
	});
	normalizedProject.tracks = tracks;
	addItem(compatibilityReport, {
		code: 'TIMELINE_ANNOTATIONS_FLATTENED_TO_AUDACITY_LABEL_TRACK',
		severity: 'info',
		disposition: 'converted',
		message: 'Timeline annotations were flattened in projected order to a distinct Audacity label track.',
		scope: { kind: 'project' },
		data: { count: retained.length, trackName: 'Timeline annotations' },
	});
	reportLosses(retained, compatibilityReport);
	clearNormalizedAnnotations(normalizedProject);
}

function reportLosses(
	annotations: readonly RuntimeTimelineAnnotationProjection[],
	report: DataRecord,
): void {
	const musicalAnchorCount = annotations.filter(({ anchor }) => anchor === 'musical').length;
	const batchIdentityCount = annotations.filter(({ batchId }) => batchId !== null).length;
	const colorCount = annotations.filter(({ color }) => color !== 'auto').length;
	const opaqueCount = annotations.filter(({ opaqueExtensions }) => Object.keys(opaqueExtensions).length > 0).length;
	if (musicalAnchorCount) addItem(report, {
		code: 'TIMELINE_ANNOTATION_MUSICAL_ANCHOR_PROJECTED',
		severity: 'warning',
		disposition: 'converted',
		message: 'Audacity labels store seconds, so musical annotation authority was projected through the tempo map.',
		scope: { kind: 'project' },
		data: { count: musicalAnchorCount },
	});
	if (batchIdentityCount) addItem(report, {
		code: 'TIMELINE_ANNOTATION_BATCH_ID_OMITTED',
		severity: 'warning',
		disposition: 'omitted',
		message: 'Audacity labels cannot retain timeline annotation batch identities.',
		scope: { kind: 'project' },
		data: { count: batchIdentityCount },
	});
	if (colorCount) addItem(report, {
		code: 'TIMELINE_ANNOTATION_COLOR_OMITTED',
		severity: 'warning',
		disposition: 'omitted',
		message: 'Audacity labels cannot retain per-annotation colors.',
		scope: { kind: 'project' },
		data: { count: colorCount },
	});
	if (opaqueCount) addItem(report, {
		code: 'TIMELINE_ANNOTATION_OPAQUE_EXTENSIONS_OMITTED',
		severity: 'warning',
		disposition: 'omitted',
		message: 'Audacity labels cannot retain Soundscaper timeline annotation opaque extensions.',
		scope: { kind: 'project' },
		data: { count: opaqueCount },
	});
	addItem(report, {
		code: 'TIMELINE_ANNOTATION_STABLE_IDS_OMITTED',
		severity: 'warning',
		disposition: 'omitted',
		message: 'Audacity labels do not retain Soundscaper timeline annotation stable identities.',
		scope: { kind: 'project' },
		data: { count: annotations.length },
	});
}

function clearNormalizedAnnotations(project: DataRecord): void {
	project.timelineAnnotations = [];
	const selection = recordOrNull(project.selection);
	if (selection) selection.annotationIds = [];
}

function uniqueTrackId(tracks: readonly DataRecord[], base: string): string {
	const used = new Set(tracks.map(({ id }) => String(id)));
	let id = base;
	let suffix = 1;
	while (used.has(id)) id = `${base}-${String(++suffix)}`;
	return id;
}

function addItem(report: DataRecord, item: DataRecord): void {
	addAup4CompatibilityItem(report, item);
}

function recordArray(value: unknown, name: string): DataRecord[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((candidate, index) => {
		if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
			throw new TypeError(`${name}[${String(index)}] must be an object.`);
		}
		return candidate as DataRecord;
	});
}

function recordOrNull(value: unknown): DataRecord | null {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as DataRecord : null;
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.map(String) : [];
}

function canonicalId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value || value !== value.trim()) throw new TypeError(`${name} must be a canonical ID.`);
	return value;
}
