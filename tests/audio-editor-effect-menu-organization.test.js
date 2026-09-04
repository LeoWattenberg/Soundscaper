/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { EFFECT_MENU_GROUPS } from '../src/common/editor/ui/application-menu-model.js';
import { createEffectMenuEntries } from '../src/common/editor/ui/effect-menu-organization.js';

const LABELS = new Map([
	['audacity-amplify', 'Amplify'],
	['audacity-normalize', 'Normalize'],
	['audacity-reverb', 'Reverb'],
	['audacity-echo', 'Echo'],
	['reviewed-utility-gain', 'Gain'],
]);

function entries(organization, productId = 'soundscaper') {
	return createEffectMenuEntries({
		organization,
		copy: Object.fromEntries(EFFECT_MENU_GROUPS.map(([key]) => [key, key])),
		effectLabels: LABELS,
		productId,
		disabled: false,
		locale: 'en',
	}, () => undefined);
}

test('the Effect menu groups by category the way Audacity defaults to', () => {
	const grouped = entries('default');
	assert.deepEqual(grouped.map((group) => group.id), ['volumeCompression', 'delayReverb', 'specialEffects']);
	assert.deepEqual(grouped[0].items.map((item) => item.label), ['Amplify', 'Normalize']);
	// An unknown organization is Audacity's default rather than an empty menu.
	assert.deepEqual(entries(undefined).map((group) => group.id), grouped.map((group) => group.id));
	assert.deepEqual(entries('groupby:publisher').map((group) => group.id), grouped.map((group) => group.id));
});

test('sorting by effect name flattens the categories into one alphabetical list', () => {
	assert.deepEqual(entries('sortby:name').map((item) => item.label), [
		'Amplify', 'Echo', 'Gain', 'Normalize', 'Reverb',
	]);
	for (const item of entries('sortby:name')) assert.equal(item.items, undefined);
});

test('the Soundscaper-only gain effect stays out of the other product either way', () => {
	assert.deepEqual(
		entries('sortby:name', 'framescaper').map((item) => item.label),
		['Amplify', 'Echo', 'Normalize', 'Reverb'],
	);
	assert.equal(
		entries('default', 'framescaper').some((group) => group.items.some((item) => item.label === 'Gain')),
		false,
	);
});
