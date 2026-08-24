/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { editorProjectFeatureCapabilityProfileDefinition } from '../src/common/editor/project-feature-capability-profile.ts';
import { FRAMESCAPER_V27_PROJECT_FEATURE_CAPABILITY_PROFILE } from '../src/framescaper/editor-project-feature-capability-profile-v27.ts';
import { FRAMESCAPER_V28_PROJECT_FEATURE_CAPABILITY_PROFILE } from '../src/framescaper/editor-project-feature-capability-profile-v28.ts';

test('selected V28 owns OpenFX project state without claiming native runtime availability', () => {
	const prior = editorProjectFeatureCapabilityProfileDefinition(
		FRAMESCAPER_V27_PROJECT_FEATURE_CAPABILITY_PROFILE,
	).registrations;
	const selected = editorProjectFeatureCapabilityProfileDefinition(
		FRAMESCAPER_V28_PROJECT_FEATURE_CAPABILITY_PROFILE,
	).registrations;
	assert.deepEqual(selected, prior.map((registration) => ({
		...registration,
		available: registration.key === 'ofxEffects' ? true : registration.available,
	})));
	assert.equal(selected.find(({ key }) => key === 'ofxEffects')?.available, true);
});
