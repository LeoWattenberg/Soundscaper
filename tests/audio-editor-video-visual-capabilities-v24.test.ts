/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	PROJECT_FEATURE_AUDIO_CAPABILITY_IDS,
	PROJECT_FEATURE_CAPABILITY_IDS,
	PROJECT_FEATURE_VIDEO_CAPABILITY_IDS,
	isProjectFeatureCapabilityId,
} from '../src/common/editor/project-feature-capabilities.ts';
import { SOUNDSCAPER_PROFILE } from '../src/soundscaper/product.js';

const VISUAL_CAPABILITIES = Object.freeze({
	videoAdjustmentLayers: 'org.soundscaper.capability.video-adjustment-layers',
	videoFreeze: 'org.soundscaper.capability.video-freeze',
	videoGenerators: 'org.soundscaper.capability.video-generators',
	videoMasksMattes: 'org.soundscaper.capability.video-masks-mattes',
	videoStills: 'org.soundscaper.capability.video-stills',
} as const);

test('V24 visual capabilities are exact globally known identities without generic fallback authority', () => {
	for (const [key, featureId] of Object.entries(VISUAL_CAPABILITIES)) {
		assert.equal(PROJECT_FEATURE_CAPABILITY_IDS[key as keyof typeof VISUAL_CAPABILITIES], featureId);
		assert.equal(isProjectFeatureCapabilityId(featureId), true);
		assert.equal(PROJECT_FEATURE_AUDIO_CAPABILITY_IDS.includes(featureId as never), false);
		assert.equal(PROJECT_FEATURE_VIDEO_CAPABILITY_IDS.includes(featureId as never), false);
	}
});

test('shipped Soundscaper knows V24 visual state but cannot author it', () => {
	for (const key of Object.keys(VISUAL_CAPABILITIES) as Array<keyof typeof VISUAL_CAPABILITIES>) {
		assert.equal(SOUNDSCAPER_PROFILE.capabilities[key], false, `Soundscaper ${key}`);
	}
});
