/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createExportPlan } from '../src/common/editor/export.js';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import {
	createLabelTrack,
} from '../src/common/editor/project-media-factory.ts';
import { PROJECT_SCHEMA_VERSION } from '../src/common/editor/project-schema-version.ts';
import { createRiffMarkerChunks, parseRiffMarkers } from '../src/common/editor/riff-markers.ts';
import {
	createRiffAnnotationExport,
	createRiffAnnotationImport,
} from '../src/common/editor/timeline-annotation-riff-interchange.ts';

const NOW = '2026-08-09T00:00:00.000Z';

test('RIFF annotation export projects, clips, omits, and assigns deterministic uint32 cue IDs', () => {
	const project = annotationProject([
		annotation({
			id: 'marker', kind: 'marker', anchor: 'sample', positionFrame: 120,
			opaqueExtensions: { private: true },
		}),
		annotation({ id: 'region', kind: 'region', anchor: 'sample', startFrame: 80, endFrame: 180, color: 'red', batchId: 'batch' }),
		annotation({ id: 'musical', kind: 'marker', anchor: 'musical', positionBeat: { num: 1, den: 1 } }),
	]);
	const options = { range: { startFrame: 100, endFrame: 160 }, outputSampleRate: 48_000 } as const;
	const first = createRiffAnnotationExport(project, options);
	const second = createRiffAnnotationExport(project, options);

	assert.deepEqual(first.markers, second.markers);
	assert.equal(first.markers.length, 2);
	assert.deepEqual(first.markers.map(({ sampleOffset, sampleLength, label }) => ({ sampleOffset, sampleLength, label })), [
		{ sampleOffset: 0, sampleLength: 60, label: 'region' },
		{ sampleOffset: 20, sampleLength: 0, label: 'marker' },
	]);
	assert.ok(first.markers.every(({ id }) => Number.isInteger(id) && Number(id) > 0 && Number(id) <= 0xffff_ffff));
	assert.equal(new Set(first.markers.map(({ id }) => id)).size, 2);
	assert.deepEqual(new Set(first.report.items.map(({ code }) => code)), new Set([
		'RIFF_ANNOTATION_REGION_CLIPPED',
		'RIFF_ANNOTATION_BATCH_ID_OMITTED',
		'RIFF_ANNOTATION_COLOR_OMITTED',
		'RIFF_ANNOTATION_OPAQUE_EXTENSIONS_OMITTED',
		'RIFF_ANNOTATION_STABLE_ID_OMITTED',
		'RIFF_ANNOTATION_OUTSIDE_EXPORT_RANGE',
	]));
	assert.equal(first.report.counts.clipped, 1);
	assert.equal(first.report.counts.omitted, 6);
	assert.ok(Object.isFrozen(first.report));
});

test('RIFF import creates fresh primary-sequence markers and positive regions with opaque cue evidence', () => {
	const project = annotationProject([]);
	let nextId = 0;
	const parsed = parseRiffMarkersFromChunks(createRiffMarkerChunks([
		{ id: 77, sampleOffset: 20, label: 'Point', note: 'point note' },
		{ id: 88, sampleOffset: 40, sampleLength: 1, label: 'Tiny region', note: 'region note' },
	]));
	const result = createRiffAnnotationImport(project, parsed, {
		sourceSampleRate: 96_000,
		timelineStartFrame: 1_000,
		idFactory: (prefix) => `${prefix}-${String(++nextId)}`,
	});

	assert.deepEqual(result.annotations.map(({ id, sequenceId, kind, anchor }) => ({ id, sequenceId, kind, anchor })), [
		{ id: 'annotation-1', sequenceId: 'main-sequence', kind: 'marker', anchor: 'sample' },
		{ id: 'annotation-2', sequenceId: 'main-sequence', kind: 'region', anchor: 'sample' },
	]);
	if (result.annotations[0]?.kind !== 'marker' || result.annotations[0].anchor !== 'sample') assert.fail('Expected a sample marker.');
	assert.equal(result.annotations[0].positionFrame, 1_010);
	if (result.annotations[1]?.kind !== 'region' || result.annotations[1].anchor !== 'sample') assert.fail('Expected a sample region.');
	assert.equal(result.annotations[1].startFrame, 1_020);
	assert.equal(result.annotations[1].endFrame, 1_021);
	assert.deepEqual(result.annotations[1].opaqueExtensions.riffCue, {
		id: 88,
		label: 'Tiny region',
		note: 'region note',
		sampleOffset: 40,
		sampleLength: 1,
	});
	assert.equal(result.report.items.length, 0);
});

test('RIFF annotation interchange retains the inherited annotation authority on exact Soundscaper v1', () => {
	const current = annotationProject([
		annotation({ id: 'baseline-marker', kind: 'marker', anchor: 'sample', positionFrame: 120 }),
	]);
	const project = {
		...current,
		schemaFamily: 'soundscaper' as const,
		schemaVersion: PROJECT_SCHEMA_VERSION,
	};
	const exported = createRiffAnnotationExport(project, {
		range: { startFrame: 0, endFrame: 200 },
		outputSampleRate: 48_000,
	});
	assert.deepEqual(exported.markers.map(({ sampleOffset, label }) => ({ sampleOffset, label })), [
		{ sampleOffset: 120, label: 'baseline-marker' },
	]);
	const imported = createRiffAnnotationImport(project, parseRiffMarkersFromChunks(createRiffMarkerChunks([
		{ id: 21, sampleOffset: 160, label: 'Imported baseline marker' },
	])), {
		sourceSampleRate: 48_000,
		timelineStartFrame: 0,
		idFactory: () => 'baseline-imported-marker',
	});
	assert.equal(imported.annotations[0]?.id, 'baseline-imported-marker');
	assert.equal(imported.annotations[0]?.sequenceId, current.primarySequenceId);
});

test('RIFF import loss-accounts sub-sample region expansion and rejects unsafe expansion', () => {
	const project = annotationProject([]);
	const marker = parseRiffMarkersFromChunks(createRiffMarkerChunks([
		{ id: 9, sampleOffset: 0, sampleLength: 1, label: 'Sub-sample region' },
	]));
	const expanded = createRiffAnnotationImport(project, marker, {
		sourceSampleRate: 192_000,
		timelineStartFrame: 0,
		idFactory: () => 'expanded-region',
	});
	if (expanded.annotations[0]?.kind !== 'region' || expanded.annotations[0].anchor !== 'sample') {
		assert.fail('Expected a sample region.');
	}
	assert.deepEqual([expanded.annotations[0].startFrame, expanded.annotations[0].endFrame], [0, 1]);
	assert.equal(expanded.report.items[0]?.code, 'RIFF_ANNOTATION_REGION_EXPANDED_TO_MINIMUM_SAMPLE');
	assert.throws(() => createRiffAnnotationImport(project, marker, {
		sourceSampleRate: 192_000,
		timelineStartFrame: Number.MAX_SAFE_INTEGER,
		idFactory: () => 'unsafe-region',
	}), /safe integer range/iu);
});

test('WAV planning keeps annotations and maintained label tracks explicitly selectable and distinct', () => {
	const labelTrack = createLabelTrack({
		id: 'labels',
		name: 'Internal labels',
		labels: [
			{ id: 'label', title: 'Internal', startFrame: 10, endFrame: 10, color: 'auto', opaqueExtensions: {} },
			{ id: 'ending-at-range', title: 'Before', startFrame: 5, endFrame: 10, color: 'auto', opaqueExtensions: {} },
		],
	});
	const project = createCurrentAudioEditorProject({
		id: 'distinct-riff-sources',
		title: 'Distinct RIFF sources',
		now: NOW,
		tracks: [labelTrack],
		timelineAnnotations: [annotation({ id: 'annotation', kind: 'marker', anchor: 'sample', positionFrame: 20 })],
	});
	const annotations = createExportPlan(project, {
		format: 'wav',
		range: { startFrame: 0, endFrame: 100 },
		includeTail: false,
	});
	const labels = createExportPlan(project, {
		format: 'wav',
		range: { startFrame: 10, endFrame: 100 },
		includeTail: false,
		markerSource: 'label-track',
		markerTrackId: 'labels',
	});

	assert.deepEqual(annotations.markers.map(({ label }) => label), ['annotation']);
	assert.equal(annotations.markerInterchangeReport.source, 'timeline-annotations');
	assert.deepEqual(labels.markers.map(({ label }) => label), ['Internal']);
	assert.equal(labels.markerInterchangeReport.source, 'label-track');
	assert.equal(labels.markerInterchangeReport.items[0]?.code, 'RIFF_LABEL_OUTSIDE_EXPORT_RANGE');
	assert.throws(() => createExportPlan(project, {
		format: 'wav',
		range: { startFrame: 0, endFrame: 100 },
		markerSource: 'timeline-annotations',
		markerTrackId: 'labels',
	}), /cannot select/iu);
	assert.throws(() => createRiffAnnotationExport({
		...structuredClone(project),
		schemaVersion: 10,
	} as never, {
		range: { startFrame: 0, endFrame: 1 },
		outputSampleRate: 48_000,
		markerSource: 'timeline-annotations',
	}), /timeline-annotation project schema/iu);
});

test('RIFF label export reports a positive region that collapses below one output sample', () => {
	const project = createCurrentAudioEditorProject({
		id: 'collapsed-riff-label', title: 'Collapsed RIFF label', now: NOW,
		sampleRate: 96_000,
		tracks: [createLabelTrack({
			id: 'labels',
			labels: [{ id: 'tiny', title: 'Tiny', startFrame: 2, endFrame: 4 }],
		})],
	});

	const result = createRiffAnnotationExport(project, {
		range: { startFrame: 0, endFrame: 100 },
		outputSampleRate: 8_000,
		markerSource: 'label-track',
		markerTrackId: 'labels',
	});

	assert.deepEqual(result.markers, []);
	assert.equal(result.report.items[0]?.code, 'RIFF_LABEL_UNREPRESENTABLE');
	assert.equal(result.report.items[0]?.disposition, 'omitted');
});

function annotation(overrides: Record<string, unknown>): Record<string, unknown> {
	return {
		id: 'annotation',
		sequenceId: 'main-sequence',
		name: String(overrides.id ?? 'annotation'),
		color: 'auto',
		batchId: null,
		opaqueExtensions: {},
		...overrides,
	};
}

function annotationProject(timelineAnnotations: readonly Record<string, unknown>[]) {
	return createCurrentAudioEditorProject({
		id: 'riff-annotations',
		title: 'RIFF annotations',
		now: NOW,
		timelineAnnotations,
	});
}

function parseRiffMarkersFromChunks(chunks: Uint8Array) {
	let cue: Uint8Array | null = null;
	const adtl: Uint8Array[] = [];
	for (let offset = 0; offset < chunks.byteLength;) {
		const id = String.fromCharCode(...chunks.subarray(offset, offset + 4));
		const size = new DataView(chunks.buffer, chunks.byteOffset + offset + 4, 4).getUint32(0, true);
		const payload = chunks.subarray(offset + 8, offset + 8 + size);
		if (id === 'cue ') cue = payload;
		if (id === 'LIST' && String.fromCharCode(...payload.subarray(0, 4)) === 'adtl') adtl.push(payload.subarray(4));
		offset += 8 + size + (size & 1);
	}
	return parseRiffMarkers(cue, adtl);
}
