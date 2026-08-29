/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The order a capability profile registers its keys in.
 *
 * The profile builder admits registrations only in strict code-unit order and
 * throws otherwise, so a producer that sorts by anything else is a module-level
 * crash waiting for the right key set. Host collation is exactly that: it
 * compares letters case-insensitively first, so `audioX` sorts before `audiob`
 * by code unit and after it by locale. Every profile therefore orders its keys
 * with the shared code-unit comparator rather than `localeCompare`.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { compareCodeUnits } from '../src/common/editor/code-unit-order.ts';
import {
	createEditorProjectFeatureCapabilityProfile,
	editorProjectFeatureCapabilityProfileDefinition,
} from '../src/common/editor/project-feature-capability-profile.ts';
import {
	SOUNDSCAPER_PROJECT_FEATURE_CAPABILITY_PROFILE,
} from '../src/soundscaper/editor-project-feature-capability-profile.ts';

const DIVERGENT_KEYS = ['audioX', 'audiob'] as const;

function registration(key: string, index: number) {
	return { key, featureId: `example.key${String(index)}`, available: true };
}

test('host collation and code-unit order genuinely disagree on camelCase keys', () => {
	const [first, second] = DIVERGENT_KEYS;
	assert.equal(compareCodeUnits(first, second), -1);
	assert.equal(Math.sign(first.localeCompare(second)), 1,
		'if this ever agrees the hazard is gone, not the requirement');
});

test('the profile builder refuses a locale-ordered registration list', () => {
	const localeOrdered = [...DIVERGENT_KEYS]
		.sort((left, right) => left.localeCompare(right))
		.map(registration);
	assert.throws(
		() => createEditorProjectFeatureCapabilityProfile({ owner: 'example', registrations: localeOrdered }),
		/sorted and unique/u,
	);

	const codeUnitOrdered = [...DIVERGENT_KEYS].sort(compareCodeUnits).map(registration);
	assert.doesNotThrow(
		() => createEditorProjectFeatureCapabilityProfile({ owner: 'example', registrations: codeUnitOrdered }),
	);
});

test('the Soundscaper profile registers every key in code-unit order', () => {
	const { registrations } = editorProjectFeatureCapabilityProfileDefinition(
		SOUNDSCAPER_PROJECT_FEATURE_CAPABILITY_PROFILE,
	);
	const keys = registrations.map(({ key }) => key);
	assert.ok(keys.length > 0);
	assert.deepEqual(keys, [...keys].sort(compareCodeUnits));
});

test('the Soundscaper profile is sorted by the shared comparator, not host collation', async () => {
	const source = await readSource('src/soundscaper/editor-project-feature-capability-profile.ts');
	assert.doesNotMatch(source, /localeCompare/u,
		'host collation cannot decide an order the builder validates by code unit');
	assert.match(source, /compareCodeUnits/u);
});

async function readSource(relativePath: string): Promise<string> {
	const { readFile } = await import('node:fs/promises');
	return readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}
