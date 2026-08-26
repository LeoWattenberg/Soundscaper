/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import { editorProjectFeatureCapabilityProfileDefinition } from '../src/common/editor/project-feature-capability-profile.ts';
import {
	FRAMESCAPER_PROJECT_V32_SCHEMA_VERSION,
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
import { FRAMESCAPER_V32_PROJECT_FEATURE_CAPABILITY_PROFILE } from '../src/framescaper/editor-project-feature-capability-profile-v32.ts';
import { FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v32.ts';
import {
	FramescaperProjectV32ReimportRequiredError,
	cloneFramescaperProjectV32,
	createFramescaperProjectV32,
	loadFramescaperProjectV32,
	reimportFramescaperProjectV32,
} from '../src/framescaper/editor-project-v32.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

test('V32 is the selected Framescaper image generation and carries inherited authority', () => {
	assert.equal(FRAMESCAPER_PROJECT_V32_SCHEMA_VERSION, 32);
	for (const predicate of [
		isProductionMixerProjectSchema,
		isFramescaperSequenceProjectSchema,
		isFramescaperVideoCompositionProjectSchema,
		isFramescaperVideoKeyframeProjectSchema,
		isFramescaperVideoRetimeProjectSchema,
		isTimelineAnnotationProjectSchema,
		isMaintainedProjectFeatureSchema,
		isMaintainedRenderedFallbackProjectSchema,
	]) assert.equal(predicate(32), true, predicate.name);

	const project = createFramescaperProjectV32(
		FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE,
		framescaperV20Options(),
	);
	assert.equal(project.schemaVersion, 32);
	assert.deepEqual(cloneFramescaperProjectV32(FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE, project), project);
	assert.equal(project.featureRequirements.requirements.some(
		({ featureId }) => featureId === PROJECT_FEATURE_CAPABILITY_IDS.timelineImages,
	), false, 'an empty project does not claim timeline-image state');
});

test('V32 capability truth derives from V28 and adds timeline images', () => {
	assert.equal(
		PROJECT_FEATURE_CAPABILITY_IDS.timelineImages,
		'org.soundscaper.capability.timeline-images-v1',
	);
	const registrations = editorProjectFeatureCapabilityProfileDefinition(
		FRAMESCAPER_V32_PROJECT_FEATURE_CAPABILITY_PROFILE,
	).registrations;
	assert.equal(registrations.find(({ key }) => key === 'timelineImages')?.available, true);
	assert.equal(registrations.filter(({ key }) => key === 'timelineImages').length, 1);
});

test('V32 explicitly reimports only selected V28 and preserves dormant custody', () => {
	const v28 = createFramescaperProjectV28(
		FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE,
		framescaperV20Options(),
	);
	const reimported = reimportFramescaperProjectV32(FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE, v28);
	assert.equal(reimported.schemaVersion, 32);
	assert.deepEqual(reimported.sources, v28.sources);
	assert.deepEqual(reimported.clips, v28.clips);

	assert.throws(
		() => loadFramescaperProjectV32(FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE, v28),
		(error: unknown) => error instanceof FramescaperProjectV32ReimportRequiredError
			&& error.code === 'REIMPORT_REQUIRED',
	);
	for (const schemaVersion of [25, 26]) {
		const opaque = { ...structuredClone(v28), schemaVersion, retainedOpaque: schemaVersion };
		const loaded = loadFramescaperProjectV32(FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE, opaque);
		assert.equal(loaded.readOnly, true);
		assert.equal(loaded.intrinsicReadOnly, true);
		assert.equal(loaded.reason, 'known-dormant-custody');
		assert.deepEqual(loaded.project, opaque);
	}
	const future = { ...structuredClone(v28), schemaVersion: 31, futureAuthority: true };
	const loaded = loadFramescaperProjectV32(FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE, future);
	assert.equal(loaded.reason, 'newer-schema');
	assert.deepEqual(loaded.project, future);
	for (const schemaVersion of [27, 29, 31, 32]) {
		if (schemaVersion === 32) continue;
		assert.throws(
			() => reimportFramescaperProjectV32(
				FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE,
				{ ...structuredClone(v28), schemaVersion },
			),
		);
	}
});
