/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { audacityXmlAttribute, audacityXmlChildren } from '../src/common/editor/audacity-binary-xml.js';
import { decodeAudacityProjectTree } from '../src/common/editor/aup4-conversion.js';
import { createAup4ExportPlan } from '../src/common/editor/aup4-export.js';
import { createAup4ProjectTree } from '../src/common/editor/aup4-profile.js';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { PROJECT_SCHEMA_VERSION } from '../src/common/editor/project-schema-version.ts';

const xmlChildren = audacityXmlChildren as unknown as (node: unknown, name: string) => unknown[];

test('AUP4 export projects musical clips and labels and reports the exact flattened map heads', () => {
	const project = createCurrentAudioEditorProject({
		id: 'musical-aup4-export', title: 'Musical AUP4 export', now: '2026-08-09T00:00:00.000Z',
		sampleRate: 48_000,
		tempoMap: { mode: 'musical', events: [
			{ id: 'tempo-0', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } },
			{ id: 'tempo-1', beat: { num: 4, den: 1 }, bpm: { num: 60, den: 1 } },
		] },
		signatureMap: { events: [
			{ id: 'signature-0', bar: 0, numerator: 4, denominator: 4 },
			{ id: 'signature-1', bar: 1, numerator: 3, denominator: 4 },
		] },
		sources: [{
			id: 'musical-source', name: 'source.wav', storageKey: 'musical-source', mimeType: 'audio/wav',
			sampleRate: 48_000, originalSampleRate: 48_000, channelCount: 1, frameCount: 48_000,
			sampleFormat: 'float32',
		}],
		clips: [{
			id: 'musical-clip', sourceId: 'musical-source', title: 'Musical clip',
			sourceStartFrame: 0, sourceDurationFrames: 48_000, durationFrames: 48_000,
			anchor: 'musical', musicalStartBeat: { num: 5, den: 1 }, musicalExtent: 'beat',
			musicalDurationBeats: { num: 1, den: 1 },
		}],
		tracks: [
			{ type: 'audio', id: 'musical-track', name: 'Audio', clipIds: ['musical-clip'], effects: [] },
			{
				type: 'label', id: 'musical-labels', name: 'Musical labels', labels: [{
					id: 'musical-label', title: 'After change', color: '#ffffff', anchor: 'musical',
					startBeat: { num: 5, den: 1 }, endBeat: { num: 6, den: 1 },
				}],
			},
		],
	});

	const plan = createAup4ExportPlan(project);
	const exportedClip = plan.project.clips.find(({ id }: { id?: string }) => id === 'musical-clip');
	const exportedLabel = plan.project.tracks
		.find(({ id }: { id?: string }) => id === 'musical-labels').labels[0];
	assert.deepEqual([exportedClip.timelineStartFrame, exportedClip.durationFrames], [144_000, 48_000]);
	assert.deepEqual([exportedLabel.startFrame, exportedLabel.endFrame], [144_000, 192_000]);
	assert.deepEqual(
		plan.compatibilityReport.items.find(({ code }: { code?: string }) => code === 'TEMPO_MAP_FLATTENED').data,
		{
			eventCount: 2,
			retainedEvent: { id: 'tempo-0', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } },
			mode: 'musical',
		},
	);
	assert.deepEqual(
		plan.compatibilityReport.items.find(({ code }: { code?: string }) => code === 'SIGNATURE_MAP_FLATTENED').data,
		{
			eventCount: 2,
			retainedEvent: { id: 'signature-0', bar: 0, numerator: 4, denominator: 4 },
		},
	);
	const tree = createAup4ProjectTree(plan.project);
	const waveClip = xmlChildren(xmlChildren(tree, 'wavetrack')[0], 'waveclip')[0];
	const label = xmlChildren(xmlChildren(tree, 'labeltrack')[0], 'label')[0];
	assert.equal(audacityXmlAttribute(waveClip, 'offset'), 3);
	assert.equal(audacityXmlAttribute(label, 't'), 3);
	assert.equal(audacityXmlAttribute(label, 't1'), 4);
	assert.equal(audacityXmlAttribute(tree, 'time_signature_tempo'), 120);
	assert.equal(audacityXmlAttribute(tree, 'time_signature_upper'), 4);
	const baselinePlan = createAup4ExportPlan({
		...project,
		schemaFamily: 'soundscaper',
		schemaVersion: PROJECT_SCHEMA_VERSION,
	});
	const baselineClip = baselinePlan.project.clips.find(({ id }: { id?: string }) => id === 'musical-clip');
	assert.deepEqual([baselineClip.timelineStartFrame, baselineClip.durationFrames], [144_000, 48_000]);
});

test('AUP4 round-trip recovers a bounded rational tempo from its native floating-point field', async () => {
	const project = createCurrentAudioEditorProject({
		id: 'rational-aup4-export', now: '2026-08-09T00:00:00.000Z',
		tempoMap: { mode: 'musical', events: [
			{ id: 'tempo-0', beat: { num: 0, den: 1 }, bpm: { num: 100, den: 3 } },
		] },
	});
	const tree = createAup4ProjectTree(createAup4ExportPlan(project).project);
	let stableId = 0;
	const decoded = await decodeAudacityProjectTree(tree, async () => null, {
		idFactory: (prefix: string) => `${prefix}-${String(++stableId)}`,
	});
	assert.deepEqual(decoded.project.tempoMap.events[0].bpm, { num: 100, den: 3 });
});

test('AUP4 export resolves inherited musical timing from exact Soundscaper v1', () => {
	const current = createCurrentAudioEditorProject({
		id: 'musical-baseline-aup4-export', now: '2026-08-09T00:00:00.000Z',
		tempoMap: { mode: 'musical', events: [
			{ id: 'tempo-0', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } },
			{ id: 'tempo-1', beat: { num: 4, den: 1 }, bpm: { num: 60, den: 1 } },
		] },
	});
	const plan = createAup4ExportPlan({
		...current,
		schemaFamily: 'soundscaper',
		schemaVersion: PROJECT_SCHEMA_VERSION,
	});
	assert.ok(plan.compatibilityReport.items.some(({ code }: { code?: string }) => code === 'TEMPO_MAP_FLATTENED'));
});

test('AUP4 export explicitly accounts for a root signature denominator outside its native range', () => {
	const project = createCurrentAudioEditorProject({
		id: 'signature-aup4-export', now: '2026-08-09T00:00:00.000Z',
		signatureMap: { events: [
			{ id: 'signature-0', bar: 0, numerator: 4, denominator: 2 ** 31 },
			{ id: 'signature-1', bar: 1, numerator: 3, denominator: 4 },
		] },
	});
	const plan = createAup4ExportPlan(project);
	assert.equal(plan.project.tempo.timeSignature.denominator, 4);
	assert.deepEqual(
		plan.compatibilityReport.items.find(({ code }: { code?: string }) => code === 'SIGNATURE_ROOT_DENOMINATOR_CONVERTED').data,
		{ sourceDenominator: 2 ** 31, retainedDenominator: 4 },
	);
	assert.equal(
		plan.compatibilityReport.items.find(({ code }: { code?: string }) => code === 'SIGNATURE_MAP_FLATTENED').data.retainedEvent.denominator,
		4,
	);
	assert.equal(audacityXmlAttribute(createAup4ProjectTree(plan.project), 'time_signature_lower'), 4);
});
