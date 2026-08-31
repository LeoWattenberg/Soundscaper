/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import { FRAMESCAPER_COMPOSITION_PROJECT_RUNTIME_PROFILE as COMPOSITION_PROFILE,
	FRAMESCAPER_SEQUENCE_PROJECT_RUNTIME_PROFILE as SEQUENCE_PROFILE } from
	'../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectComposition } from '../src/framescaper/editor-project-composition.ts';
import { createFramescaperProjectFeatureCompatibilityServiceComposition } from
	'../src/framescaper/editor-project-feature-requirements-composition.ts';
import { createFramescaperProjectFeatureCompatibilityServiceSequence } from
	'../src/framescaper/editor-project-feature-requirements-sequence.ts';
import { createFramescaperProjectSequence } from '../src/framescaper/editor-project-sequence.ts';

const REQUIREMENT = Object.freeze({
	id: 'test.video-keyframes',
	featureId: PROJECT_FEATURE_CAPABILITY_IDS.videoKeyframes,
	displayName: 'Video keyframes',
	disposition: 'bypass',
	fallback: null,
});

test('sequence and composition compatibility use their layer capability profiles', () => {
	const cases = [
		[createFramescaperProjectSequence(SEQUENCE_PROFILE),
			createFramescaperProjectFeatureCompatibilityServiceSequence(SEQUENCE_PROFILE)],
		[createFramescaperProjectComposition(COMPOSITION_PROFILE),
			createFramescaperProjectFeatureCompatibilityServiceComposition(COMPOSITION_PROFILE)],
	] as const;
	for (const [projectValue, service] of cases) {
		const project = structuredClone(projectValue) as Record<string, unknown>;
		const manifest = project.featureRequirements as Record<string, unknown>;
		project.featureRequirements = {
			...manifest,
			requirements: [...manifest.requirements as unknown[], REQUIREMENT],
		};
		const item = service.evaluate(project)?.items.find(({ requirementId }) => requirementId === REQUIREMENT.id);
		assert.equal(item?.availability, 'unavailable');
		assert.equal(item?.disposition, 'bypassed');
	}
});
