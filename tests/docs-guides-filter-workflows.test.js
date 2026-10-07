/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { GUIDE_FIXTURES } from '../handbook/guides/fixtures.mjs';
import { describeStep, effect as effectStep } from '../handbook/guides/steps.mjs';
import { FILTER_WORKFLOW_GUIDES } from '../handbook/guides/soundscaper/filter-workflows.mjs';
import { renderGuidePages } from '../scripts/lib/docs-reference/guides.mjs';

const commands = new Map([
	['apply-a-low-pass-filter', '**Effect → EQ and filters → Low-pass filter**'],
	['shape-tone-with-parametric-eq', '**Effect → EQ and filters → Parametric EQ**'],
	['shape-tone-with-graphic-eq', '**Effect → EQ and filters → Graphic EQ**'],
	['draw-a-filter-curve', '**Effect → EQ and filters → Filter Curve EQ**'],
	['boost-or-cut-a-frequency-shelf', '**Effect → EQ and filters → Shelf filter**'],
	['choose-a-classic-filter', '**Effect → Legacy effects → Classic Filters**'],
]);

const pages = renderGuidePages({
	groups: [{ slug: 'filter-workflows', title: 'Filter workflows', description: 'Practical equalization and filter recipes.', guides: FILTER_WORKFLOW_GUIDES }],
	describeStep,
	fixture: (id) => GUIDE_FIXTURES[id],
});

for (const [id, command] of commands) {
	test(`the ${id} guide has a replayable recipe and reader-facing result`, () => {
		const guide = FILTER_WORKFLOW_GUIDES.find((entry) => entry.id === id);
		assert.ok(guide, `missing filter workflow: ${id}`);
		const page = pages.get(`filter-workflows/${id}.md`);
		assert.ok(page.includes(command), 'publish the menu path the recipe replays');
		assert.equal(guide.steps[0].kind, 'open');
		assert.ok(guide.steps.some((entry) => entry.kind === 'import'));
		assert.ok(guide.steps.some((entry) => entry.kind === 'effect'));
		assert.equal(guide.steps.at(-1).kind, 'play');
		assert.ok(guide.steps.at(-1).see);
		assert.equal(guide.tips.length, 2);
		assert.doesNotMatch(page, /guide-[a-z-]+\.wav|quarter point|halfway point/u);
	});
}

test('low-pass values identify the cutoff and slope without removing the wanted band', () => {
	const effect = FILTER_WORKFLOW_GUIDES.find((guide) => guide.id === 'apply-a-low-pass-filter').steps.find((entry) => entry.kind === 'effect');
	assert.equal(effect.group, 'EQ and filters');
	assert.deepEqual(effect.settings, [
		{ label: 'Cutoff frequency', value: '5000' },
		{ label: 'Rolloff', option: '12 dB/octave' },
	]);
});

test('the shelf workflow couples its side, frequency and modest gain', () => {
	const effect = FILTER_WORKFLOW_GUIDES.find((guide) => guide.id === 'boost-or-cut-a-frequency-shelf').steps.find((entry) => entry.kind === 'effect');
	assert.deepEqual(effect.settings, [
		{ label: 'Filter type', option: 'High shelf' },
		{ label: 'Shelf frequency', value: '6000' },
		{ label: 'Gain', value: '2' },
	]);
});

test('Classic Filters chooses a low-pass Butterworth and states its cutoff and order', () => {
	const effect = FILTER_WORKFLOW_GUIDES.find((guide) => guide.id === 'choose-a-classic-filter').steps.find((entry) => entry.kind === 'effect');
	assert.equal(effect.group, 'Legacy effects');
	assert.deepEqual(effect.settings, [
		{ label: 'Filter family', option: 'Butterworth' },
		{ label: 'Filter type', option: 'Low-pass' },
		{ label: 'Order', value: '4' },
		{ label: 'Cutoff frequency', value: '5000' },
	]);
});

test('each graphical EQ recipe changes a named control and describes the resulting tone', () => {
	const cases = [
		{
			id: 'shape-tone-with-parametric-eq',
			settings: [
				{ label: 'Frequency (Hz)', value: '500' },
				{ label: 'Gain (dB)', value: '-3' },
				{ label: 'Q', value: '1.2' },
			],
			result: /focused cut around 500 Hz/u,
		},
		{
			id: 'shape-tone-with-graphic-eq',
			settings: [{ label: '1000 Hz', value: '4' }],
			result: /presence lift around 1 kHz/u,
		},
		{
			id: 'draw-a-filter-curve',
			settings: [{ label: 'Curve points (Hz:dB)', value: '20:-12, 60:-12, 100:0, 1000:0, 8000:-3, 20000:-3', expand: true }],
			result: /Low rumble and the highest frequencies are reduced/u,
		},
	];
	for (const { id, settings, result } of cases) {
		const guide = FILTER_WORKFLOW_GUIDES.find((entry) => entry.id === id);
		const effect = guide.steps.find((entry) => entry.kind === 'effect');
		assert.deepEqual(effect.settings, settings);
		assert.match(guide.steps.at(-1).see, result);
	}
	assert.ok(pages.get('filter-workflows/draw-a-filter-curve.md')
		.includes('**Curve points (Hz:dB)** to `20:-12, 60:-12, 100:0, 1000:0, 8000:-3, 20000:-3`'));
});

test('a collapsed effect setting tells the reader to expand its labelled section', () => {
	const recipe = FILTER_WORKFLOW_GUIDES.find((entry) => entry.id === 'draw-a-filter-curve');
	assert.match(describeStep(recipe.steps[3], { facet: 'howto', fixture: (id) => GUIDE_FIXTURES[id] }), /expand \*\*Curve points \(Hz:dB\)\*\* and set/u);
	assert.throws(() => effectStep({ group: 'EQ and filters', name: 'Filter Curve EQ', settings: [{ label: 'Curve points', value: '20:0', expand: 'yes' }] }), /expand/u);
});
