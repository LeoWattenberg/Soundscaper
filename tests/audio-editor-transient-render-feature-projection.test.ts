/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	projectTransientRenderFeatures,
} from '../src/common/editor/controller/transient-render-feature-projection.ts';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import {
	PROJECT_OWNED_FEATURE_REQUIREMENT_IDS,
} from '../src/common/editor/project-owned-feature-requirements.ts';
import type {
	ProjectFeatureRequirement,
	ProjectFeatureRequirementsManifest,
} from '../src/common/editor/project-feature-requirements.ts';

test('transient renders remove freeze authority without discarding unrelated publisher requirements', () => {
	const publisherRequirement = Object.freeze({
		id: 'publisher.future-audio',
		featureId: 'org.example.capability.future-audio',
		displayName: 'Publisher future audio',
		disposition: 'bypass',
		fallback: null,
	} satisfies ProjectFeatureRequirement);
	const freezeRequirement = Object.freeze({
		id: 'publisher.freeze.voice',
		featureId: PROJECT_FEATURE_CAPABILITY_IDS.audioTrackFreeze,
		displayName: 'Rendered voice freeze',
		disposition: 'rendered-fallback',
		fallback: Object.freeze({
			role: 'audio-track-render-v1',
			kind: 'audio',
			sourceId: 'voice-freeze',
			sha256: 'a'.repeat(64),
			targetTrackId: 'voice',
		}),
	} satisfies ProjectFeatureRequirement);
	const authoredTrack = Object.freeze({
		id: 'voice',
		type: 'audio',
		clipIds: Object.freeze(['voice-clip']),
		audioFreeze: Object.freeze({ schemaVersion: 1, derivedSourceId: 'voice-freeze' }),
	});
	const project: {
		tracks: Readonly<Record<string, unknown>>[];
		automationLanes: readonly unknown[];
		featureRequirements: ProjectFeatureRequirementsManifest;
	} = {
		tracks: [authoredTrack],
		automationLanes: Object.freeze([{ id: 'voice-gain' }]),
		featureRequirements: Object.freeze({
			schemaVersion: 2,
			requirements: Object.freeze([freezeRequirement, publisherRequirement]),
		}),
	};

	projectTransientRenderFeatures(project);

	assert.equal(Object.hasOwn(project.tracks[0]!, 'audioFreeze'), false);
	assert.equal(Object.hasOwn(authoredTrack, 'audioFreeze'), true, 'shared authored tracks remain untouched');
	assert.equal(project.featureRequirements.schemaVersion, 2);
	assert.equal(
		project.featureRequirements.requirements.some(
			({ featureId }) => featureId === PROJECT_FEATURE_CAPABILITY_IDS.audioTrackFreeze,
		),
		false,
	);
	assert.strictEqual(project.featureRequirements.requirements[0], publisherRequirement);
	assert.deepEqual(
		project.featureRequirements.requirements.map(({ id, featureId }) => ({ id, featureId })),
		[{
			id: publisherRequirement.id,
			featureId: publisherRequirement.featureId,
		}, {
			id: PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.audioAutomation,
			featureId: PROJECT_FEATURE_CAPABILITY_IDS.audioAutomation,
		}],
	);
});
