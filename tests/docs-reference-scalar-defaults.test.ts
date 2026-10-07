/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { renderAudioEffectReference } from '../scripts/lib/docs-reference/audio-effects.mjs';

function renderDefaults(defaults: Record<string, unknown>, bandDefaults: Record<string, unknown>): string {
	return renderAudioEffectReference({
		products: [{ id: 'soundscaper', name: 'Soundscaper', capabilities: { audioEffects: true } }],
		audacitySource: { commit: 'a'.repeat(40), version: '1', url: 'https://example.test/audacity' },
		staffPadSource: { commit: 'b'.repeat(40), version: '1', url: 'https://example.test/staffpad' },
		factoryPresetSource: { commit: 'c'.repeat(40), version: '1', url: 'https://example.test/presets' },
		audacityDefinitions: {},
		localDefinitions: {
			compressor: {
				defaults,
				bandDefaults,
				ranges: Object.fromEntries(Object.keys(defaults).map((key) => [key, [0, 10]])),
			},
		},
		factoryPresets: {},
		rackEffectTypes: ['compressor'],
		selectionEffectTypes: [],
		staffPadEffectTypes: [],
		liveCapability: () => null,
		effectLabel: () => 'Compressor',
		parameterLabel: (_type: string, name: string) => name,
		optionLabel: () => null,
		formatCurve: () => '',
	});
}

void test('local effect reference retains zero, false, empty and null scalar defaults', () => {
	const rendered = renderDefaults({ zero: 0, disabled: false, empty: '', nullable: null }, {
		zero: 5, disabled: 5, empty: 5, nullable: 5,
	});
	assert.match(rendered, /\| zero \| 0 \| 0 to 10 \|/u);
	assert.match(rendered, /\| disabled \| Off \| 0 to 10 \|/u);
	assert.match(rendered, /\| empty \| {2}\| 0 to 10 \|/u);
	assert.match(rendered, /\| nullable \| {2}\| 0 to 10 \|/u);
});

void test('local effect reference falls back for missing and structured defaults', () => {
	const rendered = renderDefaults({ missing: undefined, structured: [], absent: undefined }, {
		missing: 2, structured: 3,
	});
	assert.match(rendered, /\| missing \| 2 \| 0 to 10 \|/u);
	assert.match(rendered, /\| structured \| 3 \| 0 to 10 \|/u);
	assert.match(rendered, /\| absent \| — \| 0 to 10 \|/u);
});

void test('local effect reference only reads a band default when the own default needs fallback', () => {
	let reads = 0;
	const bandDefaults = Object.defineProperty({}, 'ratio', {
		enumerable: true,
		get: () => { reads += 1; return 5; },
	}) as Record<string, unknown>;
	renderDefaults({ ratio: 0 }, bandDefaults);
	assert.equal(reads, 0);
	renderDefaults({ ratio: undefined }, bandDefaults);
	assert.equal(reads, 1);
});
