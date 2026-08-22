/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	editorProjectFeatureCapabilityProfileDefinition,
} from '../src/common/editor/project-feature-capability-profile.ts';
import {
	FRAMESCAPER_V19_PROJECT_FEATURE_CAPABILITY_PROFILE,
} from '../src/framescaper/editor-project-feature-capability-profile-v19.ts';

const V24_VISUAL_ROWS = Object.freeze([
	row('videoAdjustmentLayers', 'org.soundscaper.capability.video-adjustment-layers'),
	row('videoFreeze', 'org.soundscaper.capability.video-freeze'),
	row('videoGenerators', 'org.soundscaper.capability.video-generators'),
	row('videoMasksMattes', 'org.soundscaper.capability.video-masks-mattes'),
	row('videoStills', 'org.soundscaper.capability.video-stills'),
]);

test('dormant V19 knows every V24 visual capability but cannot author it', () => {
	const registrations = editorProjectFeatureCapabilityProfileDefinition(
		FRAMESCAPER_V19_PROJECT_FEATURE_CAPABILITY_PROFILE,
	).registrations;
	assert.deepEqual(
		V24_VISUAL_ROWS.map((expected) => registrations.find(({ key }) => key === expected.key)),
		V24_VISUAL_ROWS,
	);
});

function row(key: string, featureId: string): Readonly<{
	readonly key: string;
	readonly featureId: string;
	readonly available: false;
}> {
	return Object.freeze({ key, featureId, available: false });
}
