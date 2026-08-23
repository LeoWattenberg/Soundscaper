/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import { FRAMESCAPER_PROFILE } from '../src/framescaper/product.js';

const V27_OWNED = Object.freeze([
	'videoCaptions',
	'videoColorManagement',
	'videoDenoise',
	'videoGrading',
	'videoMotionTracking',
	'videoStabilization',
] as const);

test('the selected Framescaper product activates only the maintained V27 finishing consumers', () => {
	const ids = PROJECT_FEATURE_CAPABILITY_IDS as Readonly<Record<string, string>>;
	const availability = FRAMESCAPER_PROFILE.capabilities as Readonly<Record<string, unknown>>;

	for (const key of V27_OWNED) {
		assert.equal(typeof ids[key], 'string', key);
		assert.equal(availability[key], true, key);
	}
	assert.deepEqual(Object.keys(ids).sort(), Object.keys(availability).sort());
	assert.deepEqual([availability.videoKeyframes, availability.videoRetime], [true, true]);
	assert.equal(availability.audioEffects, false,
		'the bounded V27 dialogue command must not activate generic audio-effect workflows');
	assert.equal(availability.ofxEffects, false);
});
