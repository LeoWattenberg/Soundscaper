/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	editorProjectFeatureCapabilityProfileDefinition,
} from '../src/common/editor/project-feature-capability-profile.ts';
import { editorProjectRuntimeProfileDefinition } from '../src/common/editor/project-runtime-profile.ts';
import {
	editorProjectRuntimeProfilePrerequisiteDefinition,
} from '../src/common/editor/project-runtime-profile-prerequisite.ts';
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
import {
	FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE,
} from '../src/framescaper/editor-project-runtime-profile-v20.ts';

const VIDEO_KEYFRAMES_ID = 'org.soundscaper.capability.video-keyframes';

test('video keyframes are globally registered and available only in selected V20', () => {
	assert.equal(PROJECT_FEATURE_CAPABILITY_IDS.videoKeyframes, VIDEO_KEYFRAMES_ID);
	for (const [profile, available] of [
		[FRAMESCAPER_V19_PROJECT_FEATURE_CAPABILITY_PROFILE, false],
		[FRAMESCAPER_V20_PROJECT_FEATURE_CAPABILITY_PROFILE, true],
	] as const) {
		const registrations = editorProjectFeatureCapabilityProfileDefinition(profile).registrations;
		assert.deepEqual(registrations.find(({ key }) => key === 'videoKeyframes'), {
			key: 'videoKeyframes', featureId: VIDEO_KEYFRAMES_ID, available,
		});
	}
});

test('V20 authority is an authenticated selected runtime with the exact desktop generation', () => {
	assert.equal(FRAMESCAPER_V20_PROJECT_MODEL_PROFILE, FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE);
	assert.equal(Object.isFrozen(FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE), true);
	assert.equal(Object.getPrototypeOf(FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE), null);
	assert.deepEqual(Reflect.ownKeys(FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE), []);
	const definition = editorProjectRuntimeProfileDefinition(FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE);
	assert.equal(definition.capabilityProfile, FRAMESCAPER_V20_PROJECT_FEATURE_CAPABILITY_PROFILE);
	assert.deepEqual(editorProjectRuntimeProfilePrerequisiteDefinition(definition.prerequisite), {
		owner: 'framescaper',
		projectSchemaVersion: 20,
		storageProfile: editorProjectRuntimeProfilePrerequisiteDefinition(definition.prerequisite).storageProfile,
		priorSchemaPolicy: 'reimport-required',
		futureSchemaPolicy: 'opaque-read-only',
		scapeFormatVersions: [1, 2],
		attachedScapeFormatVersion: 2,
		desktopLibrarySchemaVersion: 12,
		desktopProjectSchemaVersion: 20,
		desktopDatabaseUserVersion: 14,
		desktopLibraryScope: ['kw.media', 'scape-project-library', 'v12'],
	});
	assert.doesNotThrow(() => assertFramescaperProjectV20Profile(
		FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE,
	));
	for (const forgery of [{}, Object.create(null), structuredClone(
		FRAMESCAPER_V20_PROJECT_MODEL_PROFILE,
	)]) assert.throws(() => assertFramescaperProjectV20Profile(forgery), /exact Framescaper V20/iu);
});
