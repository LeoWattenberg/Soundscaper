/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	editorProjectFeatureCapabilityProfileDefinition,
} from '../src/common/editor/project-feature-capability-profile.ts';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import {
	FRAMESCAPER_V19_PROJECT_FEATURE_CAPABILITY_PROFILE,
} from '../src/framescaper/editor-project-feature-capability-profile-v19.ts';
import {
	FRAMESCAPER_V20_PROJECT_FEATURE_CAPABILITY_PROFILE,
} from '../src/framescaper/editor-project-feature-capability-profile-v20.ts';
import {
	FRAMESCAPER_V20_PROJECT_MODEL_PROFILE,
	assertFramescaperProjectV20Profile,
} from '../src/framescaper/editor-project-v20-profile.ts';

const VIDEO_KEYFRAMES_ID = 'org.soundscaper.capability.video-keyframes';

test('video keyframes are globally registered but remain unavailable in the unselected V20 model slice', () => {
	assert.equal(PROJECT_FEATURE_CAPABILITY_IDS.videoKeyframes, VIDEO_KEYFRAMES_ID);
	for (const [profile, available] of [
		[FRAMESCAPER_V19_PROJECT_FEATURE_CAPABILITY_PROFILE, false],
		[FRAMESCAPER_V20_PROJECT_FEATURE_CAPABILITY_PROFILE, false],
	] as const) {
		const registrations = editorProjectFeatureCapabilityProfileDefinition(profile).registrations;
		assert.deepEqual(registrations.find(({ key }) => key === 'videoKeyframes'), {
			key: 'videoKeyframes', featureId: VIDEO_KEYFRAMES_ID, available,
		});
	}
});

test('V20 model authority is exact and does not claim a runtime or desktop route', () => {
	assert.equal(Object.isFrozen(FRAMESCAPER_V20_PROJECT_MODEL_PROFILE), true);
	assert.equal(Object.getPrototypeOf(FRAMESCAPER_V20_PROJECT_MODEL_PROFILE), null);
	assert.deepEqual(Reflect.ownKeys(FRAMESCAPER_V20_PROJECT_MODEL_PROFILE), []);
	assert.doesNotThrow(() => assertFramescaperProjectV20Profile(
		FRAMESCAPER_V20_PROJECT_MODEL_PROFILE,
	));
	for (const forgery of [{}, Object.create(null), structuredClone(
		FRAMESCAPER_V20_PROJECT_MODEL_PROFILE,
	)]) assert.throws(() => assertFramescaperProjectV20Profile(forgery), /exact Framescaper V20/iu);
});
