/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import { editorProjectFeatureCapabilityProfileDefinition } from '../src/common/editor/project-feature-capability-profile.ts';
import {
	FRAMESCAPER_PROJECT_V30_SCHEMA_VERSION,
	isFramescaperSequenceProjectSchema,
	isFramescaperVideoCompositionProjectSchema,
	isFramescaperVideoKeyframeProjectSchema,
	isFramescaperVideoRetimeProjectSchema,
	isMaintainedProjectFeatureSchema,
	isMaintainedRenderedFallbackProjectSchema,
	isProductionMixerProjectSchema,
	isTimelineAnnotationProjectSchema,
} from '../src/common/editor/project-schema-version.ts';
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v28.ts';
import { createFramescaperProjectV28 } from '../src/framescaper/editor-project-v28.ts';
import { FRAMESCAPER_V30_PROJECT_FEATURE_CAPABILITY_PROFILE } from '../src/framescaper/editor-project-feature-capability-profile-v30.ts';
import { FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v30.ts';
import {
	FramescaperProjectV30ReimportRequiredError,
	cloneFramescaperProjectV30,
	createFramescaperProjectV30,
	loadFramescaperProjectV30,
	reimportFramescaperProjectV30,
} from '../src/framescaper/editor-project-v30.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

test('V30 is the selected Framescaper image generation and carries inherited authority', () => {
	assert.equal(FRAMESCAPER_PROJECT_V30_SCHEMA_VERSION, 30);
	for (const predicate of [
		isProductionMixerProjectSchema,
		isFramescaperSequenceProjectSchema,
		isFramescaperVideoCompositionProjectSchema,
		isFramescaperVideoKeyframeProjectSchema,
		isFramescaperVideoRetimeProjectSchema,
		isTimelineAnnotationProjectSchema,
		isMaintainedProjectFeatureSchema,
		isMaintainedRenderedFallbackProjectSchema,
	]) assert.equal(predicate(30), true, predicate.name);

	const project = createFramescaperProjectV30(
		FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE,
		framescaperV20Options(),
	);
	assert.equal(project.schemaVersion, 30);
	assert.deepEqual(cloneFramescaperProjectV30(FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE, project), project);
	assert.equal(project.featureRequirements.requirements.some(
		({ featureId }) => featureId === PROJECT_FEATURE_CAPABILITY_IDS.timelineImages,
	), false, 'an empty project does not claim timeline-image state');
});

test('V30 capability truth derives from V28 and adds timeline images', () => {
	assert.equal(
		PROJECT_FEATURE_CAPABILITY_IDS.timelineImages,
		'org.soundscaper.capability.timeline-images-v1',
	);
	const registrations = editorProjectFeatureCapabilityProfileDefinition(
		FRAMESCAPER_V30_PROJECT_FEATURE_CAPABILITY_PROFILE,
	).registrations;
	assert.equal(registrations.find(({ key }) => key === 'timelineImages')?.available, true);
	assert.equal(registrations.filter(({ key }) => key === 'timelineImages').length, 1);
});

test('V30 explicitly reimports only selected V28 and preserves dormant custody', () => {
	const v28 = createFramescaperProjectV28(
		FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE,
		framescaperV20Options(),
	);
	const reimported = reimportFramescaperProjectV30(FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE, v28);
	assert.equal(reimported.schemaVersion, 30);
	assert.deepEqual(reimported.sources, v28.sources);
	assert.deepEqual(reimported.clips, v28.clips);

	assert.throws(
		() => loadFramescaperProjectV30(FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE, v28),
		(error: unknown) => error instanceof FramescaperProjectV30ReimportRequiredError
			&& error.code === 'REIMPORT_REQUIRED',
	);
	for (const schemaVersion of [25, 26]) {
		const opaque = { ...structuredClone(v28), schemaVersion, retainedOpaque: schemaVersion };
		const loaded = loadFramescaperProjectV30(FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE, opaque);
		assert.equal(loaded.readOnly, true);
		assert.equal(loaded.intrinsicReadOnly, true);
		assert.equal(loaded.reason, 'known-dormant-custody');
		assert.deepEqual(loaded.project, opaque);
	}
	const future = { ...structuredClone(v28), schemaVersion: 31, futureAuthority: true };
	const loaded = loadFramescaperProjectV30(FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE, future);
	assert.equal(loaded.reason, 'newer-schema');
	assert.deepEqual(loaded.project, future);
	for (const schemaVersion of [27, 29, 30, 31]) {
		if (schemaVersion === 30) continue;
		assert.throws(
			() => reimportFramescaperProjectV30(
				FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE,
				{ ...structuredClone(v28), schemaVersion },
			),
		);
	}
});
