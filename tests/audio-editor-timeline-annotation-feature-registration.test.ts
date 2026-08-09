/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectFeatureCompatibilityService } from '../src/common/editor/controller/project-feature-compatibility-service.ts';
import {
	PROJECT_FEATURE_AUDIO_CAPABILITY_IDS,
	PROJECT_FEATURE_CAPABILITY_IDS,
	PROJECT_FEATURE_VIDEO_CAPABILITY_IDS,
} from '../src/common/editor/project-feature-capabilities.ts';
import {
	PROJECT_OWNED_FEATURE_REQUIREMENT_IDS,
	reconcileProjectOwnedFeatureRequirements,
} from '../src/common/editor/project-owned-feature-requirements.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION } from '../src/common/editor/project-schema-version.ts';
import { PRODUCT_PROFILES } from '../src/common/products.js';

const EMPTY_MANIFEST = Object.freeze({ schemaVersion: 2 as const, requirements: Object.freeze([]) });

test('timeline annotations have one registered but unavailable structural capability', () => {
	assert.equal(
		PROJECT_FEATURE_CAPABILITY_IDS.timelineAnnotations,
		'org.soundscaper.capability.timeline-annotations',
	);
	assert.equal(PRODUCT_PROFILES.soundscaper.capabilities.timelineAnnotations, false);
	assert.equal(PRODUCT_PROFILES.framescaper.capabilities.timelineAnnotations, false);
	assert.equal(
		PROJECT_FEATURE_AUDIO_CAPABILITY_IDS.includes(PROJECT_FEATURE_CAPABILITY_IDS.timelineAnnotations as never),
		false,
		'structural annotations must not qualify for an audio rendered fallback',
	);
	assert.equal(
		PROJECT_FEATURE_VIDEO_CAPABILITY_IDS.includes(PROJECT_FEATURE_CAPABILITY_IDS.timelineAnnotations as never),
		false,
		'structural annotations must not qualify for a video rendered fallback',
	);
});

test('known structural annotations cannot claim a rendered media fallback', () => {
	assert.throws(() => createCurrentAudioEditorProject({
		id: 'annotation-rendered-fallback',
		now: '2026-08-09T00:00:00.000Z',
		sources: [{
			kind: 'audio', id: 'fallback-source', name: 'Fallback', storageKey: 'fallback-source',
			mimeType: 'audio/wav', frameCount: 48_000, channelCount: 1, sampleRate: 48_000,
			originalSampleRate: 48_000,
		}],
		timelineAnnotations: [{
			id: 'annotation-a', sequenceId: 'main-sequence', name: 'Cue', color: 'auto',
			batchId: null, opaqueExtensions: {}, kind: 'marker', anchor: 'sample', positionFrame: 0,
		}],
		featureRequirements: {
			schemaVersion: 2,
			requirements: [{
				id: 'publisher.annotation-render',
				featureId: PROJECT_FEATURE_CAPABILITY_IDS.timelineAnnotations,
				displayName: 'Rendered annotations',
				disposition: 'rendered-fallback',
				fallback: {
					role: 'project-audio-mix-v1', kind: 'audio', sourceId: 'fallback-source',
					sha256: 'a'.repeat(64),
				},
			}],
		},
	}), /timeline-annotations.*audio rendered fallback|audio rendered fallback.*timeline-annotations/iu);
});

test('non-empty timeline annotation state reconciles one bypass-only owned requirement', () => {
	const manifest = reconcileProjectOwnedFeatureRequirements({
		timelineAnnotations: [{ id: 'annotation-a' }],
	}, EMPTY_MANIFEST);
	assert.deepEqual(manifest.requirements, [{
		id: PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.timelineAnnotations,
		featureId: PROJECT_FEATURE_CAPABILITY_IDS.timelineAnnotations,
		displayName: 'Timeline markers and regions',
		disposition: 'bypass',
		fallback: null,
	}]);
	assert.equal(Object.isFrozen(manifest), true);
	assert.equal(Object.isFrozen(manifest.requirements), true);

	assert.strictEqual(
		reconcileProjectOwnedFeatureRequirements({ timelineAnnotations: [] }, EMPTY_MANIFEST),
		EMPTY_MANIFEST,
	);
	assert.strictEqual(reconcileProjectOwnedFeatureRequirements({}, EMPTY_MANIFEST), EMPTY_MANIFEST);
});

test('same-schema timeline annotation state is known unavailable in both products', () => {
	const featureRequirements = reconcileProjectOwnedFeatureRequirements({
		timelineAnnotations: [{ id: 'annotation-a' }],
	}, EMPTY_MANIFEST);
	const project = {
		schemaVersion: AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
		featureRequirements,
	};
	for (const profile of [PRODUCT_PROFILES.soundscaper, PRODUCT_PROFILES.framescaper]) {
		const report = createProjectFeatureCompatibilityService(profile.capabilities).evaluate(project);
		assert.equal(report?.compatible, false, profile.id);
		assert.deepEqual(report?.items.map(({ requirementId, featureId, availability, disposition }) => ({
			requirementId, featureId, availability, disposition,
		})), [{
			requirementId: PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.timelineAnnotations,
			featureId: PROJECT_FEATURE_CAPABILITY_IDS.timelineAnnotations,
			availability: 'unavailable',
			disposition: 'bypassed',
		}], profile.id);
	}
});
