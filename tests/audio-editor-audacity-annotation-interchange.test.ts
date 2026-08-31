/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudacityAnnotationImport } from '../src/common/editor/audacity-annotation-interchange.ts';
import {
	audacityXmlAttribute,
	audacityXmlChildren,
	createAudacityXmlNode,
} from '../src/common/editor/audacity-binary-xml.js';
import { convertLegacyAupToProject } from '../src/common/editor/aup-legacy-conversion.js';
import { decodeAudacityProjectTree } from '../src/common/editor/aup4-conversion.js';
import { createAup4ExportPlan } from '../src/common/editor/aup4-export.js';
import { createAup4ProjectTree } from '../src/common/editor/aup4-profile.js';
import { parseAudioEditorLabels } from '../src/common/editor/label-io.js';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import {
	AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
	PROJECT_SCHEMA_VERSION,
} from '../src/common/editor/project-schema-version.ts';
import {
	createLabelTrack,
} from '../src/common/editor/project-media-factory.ts';

const NOW = '2026-08-09T00:00:00.000Z';
const MUSICAL_ROOT = Object.freeze({
	mode: 'musical' as const,
	events: Object.freeze([{ id: 'tempo-1', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }]),
});

test('Audacity label peers become fresh batch-associated markers and regions', () => {
	let nextId = 0;
	const result = createAudacityAnnotationImport([{
		name: 'Chapter labels',
		selected: true,
		labels: [
			{ title: 'Point\nname', startSeconds: 0.5, endSeconds: 0.5, opaqueExtensions: { native: 1 } },
			{ title: 'Region', startSeconds: 1, endSeconds: 2, opaqueExtensions: { native: 2 } },
		],
		opaqueExtensions: { trackNative: true },
	}], {
		sampleRate: 48_000,
		tempoMap: MUSICAL_ROOT,
		sequenceId: 'main-sequence',
		idFactory: (prefix) => `${prefix}-${String(++nextId)}`,
	});

	assert.deepEqual(result.annotations.map(({ id, kind, batchId, name }) => ({ id, kind, batchId, name })), [
		{ id: 'annotation-2', kind: 'marker', batchId: 'annotation-batch-1', name: 'Point name' },
		{ id: 'annotation-3', kind: 'region', batchId: 'annotation-batch-1', name: 'Region' },
	]);
	assert.deepEqual(result.selectedAnnotationIds, ['annotation-2', 'annotation-3']);
	const point = result.annotations[0];
	const region = result.annotations[1];
	if (point?.kind !== 'marker' || point.anchor !== 'sample') assert.fail('Expected a sample marker.');
	if (region?.kind !== 'region' || region.anchor !== 'sample') assert.fail('Expected a sample region.');
	assert.equal(point.positionFrame, 24_000);
	assert.equal(region.endFrame, 96_000);
	assert.deepEqual(result.annotations[0]?.opaqueExtensions.audacityLabel, {
		trackName: 'Chapter labels',
		trackIndex: 0,
		labelIndex: 0,
		originalTitle: 'Point\nname',
		label: { native: 1 },
		track: { trackNative: true },
	});
});

test('a positive Audacity label region remains a region below one destination sample', () => {
	const result = createAudacityAnnotationImport([{
		name: 'Short region',
		labels: [{
			title: 'Sub-sample region',
			startSeconds: 0,
			endSeconds: 1 / (48_000 * 4),
		}],
	}], {
		sampleRate: 48_000,
		tempoMap: MUSICAL_ROOT,
		sequenceId: 'main-sequence',
		idFactory: (prefix) => `${prefix}-1`,
	});

	assert.equal(result.annotations.length, 1);
	assert.deepEqual(result.annotations[0], annotation({
		id: 'annotation-1',
		name: 'Sub-sample region',
		kind: 'region',
		anchor: 'sample',
		startFrame: 0,
		endFrame: 1,
		opaqueExtensions: {
			audacityLabel: {
				trackName: 'Short region',
				trackIndex: 0,
				labelIndex: 0,
				originalTitle: 'Sub-sample region',
				label: {},
				track: {},
			},
		},
	}));
});

test('overlong Audacity label names remain canonical at the annotation limit', () => {
	let nextId = 0;
	const result = createAudacityAnnotationImport([{
		name: 'Long labels',
		labels: [
			{ title: `${'a'.repeat(4_095)} b`, startSeconds: 0, endSeconds: 0 },
			{ title: `${'a'.repeat(4_095)}😀`, startSeconds: 1, endSeconds: 1 },
		],
	}], {
		sampleRate: 48_000,
		tempoMap: MUSICAL_ROOT,
		sequenceId: 'main-sequence',
		idFactory: (prefix) => `${prefix}-${String(++nextId)}`,
	});

	assert.equal(result.annotations[0]?.name.length, 4_095);
	assert.equal(result.annotations[0]?.name.endsWith(' '), false);
	assert.equal(result.annotations[1]?.name.length, 4_095);
	assert.equal(result.annotations[1]?.name.charCodeAt(4_094), 'a'.charCodeAt(0));
});

test('legacy XML AUP labels import as current annotations instead of internal label-track objects', () => {
	let nextId = 0;
	const decoded = convertLegacyAupToProject({
		sampleRate: 48_000,
		tracks: [{
			type: 'label',
			name: 'Legacy labels',
			labels: [
				{ title: 'Point', startSeconds: 0.25, endSeconds: 0.25, opaqueExtensions: { legacy: 'point' } },
				{ title: 'Region', startSeconds: 1, endSeconds: 1.5, opaqueExtensions: { legacy: 'region' } },
			],
		}],
		warnings: [],
	}, {
		now: NOW,
		projectId: 'legacy-label-project',
		idFactory: (prefix: string) => `${prefix}-${String(++nextId)}`,
	});

	assert.equal(decoded.project.schemaVersion, AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION);
	assert.equal(decoded.project.tracks.some(({ type }: { type?: string }) => type === 'label'), false);
	assert.deepEqual(decoded.project.timelineAnnotations.map(({ kind }: { kind: string }) => kind), ['marker', 'region']);
	assert.equal((decoded.project.timelineAnnotations[0] as { positionFrame: number }).positionFrame, 12_000);
	assert.equal((decoded.project.timelineAnnotations[1] as { endFrame: number }).endFrame, 72_000);
});

test('AUP4 label tracks import as selected annotations with explicit compatibility accounting', async () => {
	let nextId = 0;
	const labelTrack = createAudacityXmlNode('labeltrack', [], [
		attribute('name', 'AUP4 labels'),
		{ kind: 'attribute', name: 'isSelected', type: 'bool', value: true },
		{ kind: 'node', node: createAudacityXmlNode('label', [
			{ kind: 'attribute', name: 't', type: 'double', value: 0.5 },
			{ kind: 'attribute', name: 't1', type: 'double', value: 1 },
			attribute('title', 'Imported region'),
		]) },
	]);
	const root = createAudacityXmlNode('project', [
		{ kind: 'attribute', name: 'rate', type: 'double', value: 48_000 },
	], [{ kind: 'node', node: labelTrack }]);
	const decoded = await decodeAudacityProjectTree(root, async () => null, {
		projectId: 'aup4-label-project',
		idFactory: (prefix: string) => `${prefix}-${String(++nextId)}`,
	});

	assert.equal(decoded.project.tracks.some(({ type }: { type?: string }) => type === 'label'), false);
	assert.equal(decoded.project.timelineAnnotations.length, 1);
	assert.deepEqual(decoded.project.selection.annotationIds, [decoded.project.timelineAnnotations[0].id]);
	assert.ok(decoded.compatibilityReport.items.some(({ code }: { code: string }) => (
		code === 'AUDACITY_LABEL_TRACK_CONVERTED_TO_TIMELINE_ANNOTATIONS'
	)));
});

test('AUP4 export adds a distinct projected annotation label track and reports semantic losses', () => {
	const internalLabels = createLabelTrack({
		id: 'internal-labels',
		name: 'Internal labels',
		labels: [{ id: 'internal', title: 'Internal', startFrame: 5, endFrame: 5, color: 'auto', opaqueExtensions: {} }],
	});
	const project = createCurrentAudioEditorProject({
		id: 'aup4-annotation-export',
		title: 'AUP4 annotation export',
		now: NOW,
		tracks: [internalLabels],
		timelineAnnotations: [
			annotation({
				id: 'later', name: 'Later', kind: 'marker', anchor: 'sample', positionFrame: 48_000,
				batchId: 'batch', color: 'red', opaqueExtensions: { private: true },
			}),
			annotation({
				id: 'earlier', name: 'Earlier', kind: 'region', anchor: 'musical',
				startBeat: { num: 1, den: 1 }, endBeat: { num: 2, den: 1 },
			}),
		],
	});
	const plan = createAup4ExportPlan(project);
	const labelTracks = plan.project.tracks.filter(({ type }: { type?: string }) => type === 'label');

	assert.equal(labelTracks.length, 2);
	assert.equal(labelTracks[0].name, 'Internal labels');
	assert.equal(labelTracks[1].name, 'Timeline annotations');
	assert.deepEqual(labelTracks[1].labels.map(({ title }: { title: string }) => title), ['Earlier', 'Later']);
	const codes = new Set(plan.compatibilityReport.items.map(({ code }: { code: string }) => code));
	for (const code of [
		'TIMELINE_ANNOTATIONS_FLATTENED_TO_AUDACITY_LABEL_TRACK',
		'TIMELINE_ANNOTATION_MUSICAL_ANCHOR_PROJECTED',
		'TIMELINE_ANNOTATION_BATCH_ID_OMITTED',
		'TIMELINE_ANNOTATION_COLOR_OMITTED',
		'TIMELINE_ANNOTATION_OPAQUE_EXTENSIONS_OMITTED',
		'TIMELINE_ANNOTATION_STABLE_IDS_OMITTED',
	]) assert.ok(codes.has(code), `Missing ${code}`);
	const tree = createAup4ProjectTree(plan.project);
	const xmlChildren = audacityXmlChildren as unknown as (node: unknown, name: string) => unknown[];
	const xmlAttribute = audacityXmlAttribute as unknown as (node: unknown, name: string, fallback: unknown) => unknown;
	assert.deepEqual(xmlChildren(tree, 'labeltrack').map((node) => (
		String(xmlAttribute(node, 'name', ''))
	)), ['Internal labels', 'Timeline annotations']);
});

test('AUP4 export projects inherited timeline annotations from exact Soundscaper v1', () => {
	const current = createCurrentAudioEditorProject({
		id: 'aup4-baseline-annotation-export',
		title: 'AUP4 baseline annotation export',
		now: NOW,
		timelineAnnotations: [annotation({
			id: 'baseline-annotation', name: 'Baseline marker', kind: 'marker', anchor: 'sample', positionFrame: 24_000,
		})],
	});
	const plan = createAup4ExportPlan({
		...current,
		schemaFamily: 'soundscaper',
		schemaVersion: PROJECT_SCHEMA_VERSION,
	});
	const projected = plan.project.tracks.find(({ name }: { name?: string }) => name === 'Timeline annotations');
	assert.deepEqual(projected?.labels.map(({ title }: { title: string }) => title), ['Baseline marker']);
});

test('maintained TXT/SRT/VTT label parsing remains an explicitly distinct internal-label path', () => {
	const parsed = parseAudioEditorLabels('0\t1\tInternal label', { format: 'txt', sampleRate: 48_000 });
	assert.equal(parsed.format, 'txt');
	assert.deepEqual(parsed.labels.map(({ title, startFrame, endFrame }: { title: string; startFrame: number; endFrame: number }) => ({
		title, startFrame, endFrame,
	})), [{ title: 'Internal label', startFrame: 0, endFrame: 48_000 }]);
	assert.equal(Object.hasOwn(parsed.labels[0], 'anchor'), false);
	assert.equal(Object.hasOwn(parsed, 'timelineAnnotations'), false);
});

function annotation(overrides: Record<string, unknown>) {
	return {
		id: 'annotation',
		sequenceId: 'main-sequence',
		name: 'Annotation',
		color: 'auto',
		batchId: null,
		opaqueExtensions: {},
		...overrides,
	};
}

function attribute(name: string, value: string) {
	return { kind: 'attribute' as const, name, type: 'string' as const, value };
}
