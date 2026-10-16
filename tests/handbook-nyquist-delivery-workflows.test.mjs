import test from 'node:test';
import assert from 'node:assert/strict';

import { GUIDE_FIXTURES } from '../handbook/guides/fixtures.mjs';
import { validateGuide } from '../handbook/guides/steps.mjs';
import {
	ANALYSIS_WORKFLOW_GUIDES,
	DELIVERY_WORKFLOW_GUIDES,
	GENERATOR_WORKFLOW_GUIDES,
} from '../handbook/guides/soundscaper/nyquist-and-delivery-workflows.mjs';

const expectedIds = [
	'generate-a-rhythm-track', 'generate-a-risset-drum', 'generate-a-plucked-tone',
	'measure-rms-level', 'label-sounds-separated-by-silence',
	'export-clips-as-an-archive', 'export-an-aiff',
];

test('seven Nyquist and delivery workflow guides validate and have unique ids', () => {
	const guides = [...GENERATOR_WORKFLOW_GUIDES, ...ANALYSIS_WORKFLOW_GUIDES, ...DELIVERY_WORKFLOW_GUIDES];
	assert.deepEqual(guides.map(({ id }) => id), expectedIds);
	assert.equal(new Set(guides.map(({ id }) => id)).size, guides.length);
	for (const guide of guides) validateGuide(guide, GUIDE_FIXTURES);
});

test('Nyquist recipes keep their exact bundled plugin names and control labels', () => {
	const [rhythm, drum, pluck] = GENERATOR_WORKFLOW_GUIDES;
	const rhythmStep = rhythm.steps.find(({ kind }) => kind === 'nyquist');
	assert.ok(rhythmStep);
	assert.deepEqual(rhythmStep.fields.map(({ label, value }) => [label, value]), [
		['Tempo (bpm)', '120'], ['Beats per bar', '4'], ['Number of bars', '4'],
	]);
	assert.equal(rhythmStep.name, 'Rhythm Track');
	assert.equal(rhythmStep.menu, 'Generate');
	assert.equal(drum.steps.find(({ kind }) => kind === 'nyquist').name, 'Risset Drum');
	assert.equal(pluck.steps.find(({ kind }) => kind === 'nyquist').name, 'Pluck');
	assert.equal(rhythm.steps.at(-1).clips, 1);
	assert.equal(drum.steps.at(-1).clips, 1);
	assert.equal(pluck.steps.at(-1).clips, 1);
});

test('analysis guides use bundled analyzers and explain the evidence they produce', () => {
	const [rms, labels] = ANALYSIS_WORKFLOW_GUIDES;
	const rmsStep = rms.steps.find(({ kind }) => kind === 'nyquist');
	assert.ok(rmsStep);
	assert.deepEqual([rmsStep.menu, rmsStep.name, rmsStep.fields], ['Analyze', 'Measure RMS', []]);
	assert.equal(labels.steps.find(({ kind }) => kind === 'nyquist').name, 'Label Sounds');
	assert.deepEqual(labels.steps.find(({ kind }) => kind === 'nyquist').fields.map(({ label }) => label), [
		'Threshold level (dB)', 'Minimum silence duration', 'Minimum label interval',
	]);
	assert.ok(rmsStep.see.includes('RMS level'));
	assert.equal(labels.steps.at(-2).kind, 'nyquist');
	assert.equal(labels.steps.at(-1).track, 'Label Sounds');
});

test('delivery guides name the browser-supported archive mode and AIFF format', () => {
	const [clips, aiff] = DELIVERY_WORKFLOW_GUIDES;
	const archive = clips.steps.find(({ kind }) => kind === 'export');
	assert.deepEqual([archive.format, archive.extension, archive.mode], [
		'WAV', 'zip', 'Individual clips (split by clips)',
	]);
	const aiffExport = aiff.steps.find(({ kind }) => kind === 'export');
	assert.deepEqual([aiffExport.format, aiffExport.extension], ['AIFF', 'aiff']);
	assert.match(aiffExport.see, /downloadable/u);
});
