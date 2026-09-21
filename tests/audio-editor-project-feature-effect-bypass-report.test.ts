import test from 'node:test';
import assert from 'node:assert/strict';

import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import { qualifyingProjectFeatureEffectBypassRequirementIds } from '../src/common/editor/project-feature-effect-bypass-report.ts';
import type { ProjectFeatureRequirementsReport } from '../src/common/editor/project-feature-requirements.ts';

function report(items: ProjectFeatureRequirementsReport['items']): ProjectFeatureRequirementsReport {
	return Object.freeze({
		schemaVersion: 1,
		format: 'soundscaper-project',
		compatible: false,
		counts: Object.freeze({ available: 0, unavailable: items.length, unknown: 0 }),
		items,
	});
}

function item(
	requirementId: string,
	featureId: string,
	overrides: Partial<ProjectFeatureRequirementsReport['items'][number]> = {},
): ProjectFeatureRequirementsReport['items'][number] {
	return Object.freeze({
		requirementId,
		featureId,
		displayName: requirementId,
		availability: 'unavailable',
		declaredDisposition: 'bypass',
		disposition: 'bypassed',
		fallback: null,
		message: '',
		...overrides,
	});
}

test('effect bypass qualification is identical for audio and video reports', () => {
	for (const featureId of [
		PROJECT_FEATURE_CAPABILITY_IDS.audioEffects,
		PROJECT_FEATURE_CAPABILITY_IDS.videoEffects,
	]) {
		const input = report([
			item('first', featureId),
			item('other-feature', 'org.example.other'),
			item('available', featureId, { availability: 'available' }),
			item('fallback', featureId, { declaredDisposition: 'rendered-fallback' }),
			item('native', featureId, { disposition: 'native' }),
			item('second', featureId),
		]);
		assert.deepEqual(
			qualifyingProjectFeatureEffectBypassRequirementIds(input, featureId),
			['first', 'second'],
		);
	}
});

test('effect bypass qualification rejects non-report states and invalid qualifying IDs', () => {
	const featureId = PROJECT_FEATURE_CAPABILITY_IDS.audioEffects;
	assert.deepEqual(qualifyingProjectFeatureEffectBypassRequirementIds(null, featureId), []);
	assert.deepEqual(qualifyingProjectFeatureEffectBypassRequirementIds({
		...report([item('ignored', featureId)]), compatible: true,
	}, featureId), []);
	assert.throws(
		() => qualifyingProjectFeatureEffectBypassRequirementIds(
			report([item('x'.repeat(257), featureId)]), featureId,
		),
		/feature requirement ID must be a non-empty bounded string/u,
	);
});
