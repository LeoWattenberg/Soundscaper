/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import { editorProjectFeatureCapabilityProfileDefinition } from '../src/common/editor/project-feature-capability-profile.ts';
import { FRAMESCAPER_V18_PROJECT_FEATURE_CAPABILITY_PROFILE } from '../src/framescaper/editor-project-feature-capability-profile-v18.ts';
import { FRAMESCAPER_V19_PROJECT_FEATURE_CAPABILITY_PROFILE } from '../src/framescaper/editor-project-feature-capability-profile-v19.ts';
import { FRAMESCAPER_V20_PROJECT_FEATURE_CAPABILITY_PROFILE } from '../src/framescaper/editor-project-feature-capability-profile-v20.ts';
import { SOUNDSCAPER_V21_PROJECT_FEATURE_CAPABILITY_PROFILE } from '../src/soundscaper/editor-project-feature-capability-profile-v21.ts';
import { FRAMESCAPER_PROFILE } from '../src/framescaper/product.js';
import { SOUNDSCAPER_PROFILE } from '../src/soundscaper/product.js';

const FEATURE_ID = 'org.soundscaper.capability.mastering-sequences';

test('the mastering-sequence capability is registered in the global registry', () => {
	assert.equal(PROJECT_FEATURE_CAPABILITY_IDS.masteringSequences, FEATURE_ID);
});

test('it is registered and unavailable in every product profile', () => {
	// The revision registers its capability with both product profiles initially
	// unavailable: the document type may exist and be validated long before
	// either product offers it, and "absent" and "present but off" are different
	// answers to a project that demands it.
	for (const [name, profile] of [
		['Soundscaper V21', SOUNDSCAPER_V21_PROJECT_FEATURE_CAPABILITY_PROFILE],
		['Framescaper V18', FRAMESCAPER_V18_PROJECT_FEATURE_CAPABILITY_PROFILE],
		['Framescaper V19', FRAMESCAPER_V19_PROJECT_FEATURE_CAPABILITY_PROFILE],
		['Framescaper V20', FRAMESCAPER_V20_PROJECT_FEATURE_CAPABILITY_PROFILE],
	] as const) {
		const registration = editorProjectFeatureCapabilityProfileDefinition(profile)
			.registrations.find((entry) => entry.key === 'masteringSequences');
		assert.ok(registration, `${name} must register the capability, not omit it`);
		assert.equal(registration.featureId, FEATURE_ID, `${name} feature id`);
		assert.equal(registration.available, false, `${name} must report it unavailable`);
	}
});

test('both products declare it false rather than leaving it out', () => {
	// An omitted key already reads as unavailable at runtime, but the
	// exhaustiveness checks compare key sets rather than values, and a capability
	// nobody declared is one nobody decided about.
	assert.equal(SOUNDSCAPER_PROFILE.capabilities.masteringSequences, false);
	assert.equal(FRAMESCAPER_PROFILE.capabilities.masteringSequences, false);
	assert.equal(Object.hasOwn(SOUNDSCAPER_PROFILE.capabilities, 'masteringSequences'), true);
	assert.equal(Object.hasOwn(FRAMESCAPER_PROFILE.capabilities, 'masteringSequences'), true);
});

test('the production capability inventory agrees with both products', () => {
	const inventory = JSON.parse(readFileSync('config/production-capabilities.json', 'utf8'));
	for (const product of ['soundscaper', 'framescaper']) {
		assert.equal(
			inventory.products[product].projectFeatures.masteringSequences,
			false,
			`${product} inventory must carry the capability as unavailable`,
		);
	}
});

test('the hand-written profiles keep their registrations in raw ascending order', () => {
	// The profile validator compares keys with `<`, not localeCompare, and throws
	// at module load rather than at an assertion — so an out-of-order insert
	// surfaces as a mass import failure with no obvious cause.
	for (const [name, profile] of [
		['Framescaper V18', FRAMESCAPER_V18_PROJECT_FEATURE_CAPABILITY_PROFILE],
		['Framescaper V19', FRAMESCAPER_V19_PROJECT_FEATURE_CAPABILITY_PROFILE],
		['Framescaper V20', FRAMESCAPER_V20_PROJECT_FEATURE_CAPABILITY_PROFILE],
		['Soundscaper V21', SOUNDSCAPER_V21_PROJECT_FEATURE_CAPABILITY_PROFILE],
	] as const) {
		const keys = editorProjectFeatureCapabilityProfileDefinition(profile)
			.registrations.map((entry) => entry.key);
		assert.deepEqual([...keys].sort(), keys, `${name} registrations must be raw-sorted`);
	}
});
