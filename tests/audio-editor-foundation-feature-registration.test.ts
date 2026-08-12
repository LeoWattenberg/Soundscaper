/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectFeatureCompatibilityService } from '../src/common/editor/controller/project-feature-compatibility-service.ts';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import {
	PROJECT_OWNED_FEATURE_REQUIREMENT_IDS,
	reconcileProjectOwnedFeatureRequirements,
} from '../src/common/editor/project-owned-feature-requirements.ts';
import { AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION } from '../src/common/editor/project-schema-version.ts';
import { PRODUCT_PROFILES } from '../src/common/products.js';

const EMPTY_MANIFEST = Object.freeze({ schemaVersion: 2 as const, requirements: Object.freeze([]) });

const FOUNDATION_FIXTURES = Object.freeze([
	Object.freeze({
		id: PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.musicalTimeline,
		featureId: PROJECT_FEATURE_CAPABILITY_IDS.musicalTimeline,
		project: { tempoMap: { mode: 'musical', events: [
			{ id: 'tempo-1', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } },
			{ id: 'tempo-2', beat: { num: 4, den: 1 }, bpm: { num: 90, den: 1 } },
		] } },
	}),
	Object.freeze({
		id: PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.audioWarp,
		featureId: PROJECT_FEATURE_CAPABILITY_IDS.audioWarp,
		project: { clips: [{ kind: 'audio', warpMap: { feature: 'audio-warp' } }] },
	}),
	Object.freeze({
		id: PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.takeComp,
		featureId: PROJECT_FEATURE_CAPABILITY_IDS.takeComp,
		project: { takeGroups: [{ id: 'take-group' }] },
	}),
	Object.freeze({
		id: PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.sequenceTiming,
		featureId: PROJECT_FEATURE_CAPABILITY_IDS.sequenceTiming,
		project: { sequences: [{ rate: { num: 24, den: 1 }, dropFrame: false }] },
	}),
	Object.freeze({
		id: PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.videoRetime,
		featureId: PROJECT_FEATURE_CAPABILITY_IDS.videoRetime,
		project: { clips: [{ kind: 'video', retimeMap: { feature: 'video-retime' } }] },
	}),
	Object.freeze({
		id: PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.videoTimingAssets,
		featureId: PROJECT_FEATURE_CAPABILITY_IDS.videoTimingAssets,
		project: { sources: [{ kind: 'video', timingAsset: { storageKey: 'timing' } }] },
	}),
	Object.freeze({
		id: PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.sourceCharacteristics,
		featureId: PROJECT_FEATURE_CAPABILITY_IDS.sourceCharacteristics,
		project: { sources: [{ kind: 'video', characteristics: { backend: 'ffmpeg', rotationDegrees: 90 } }] },
	}),
]);

test('every foundation document type has one owned capability predicate', () => {
	for (const fixture of FOUNDATION_FIXTURES) {
		const manifest = reconcileProjectOwnedFeatureRequirements(fixture.project, EMPTY_MANIFEST);
		assert.deepEqual(manifest.requirements.map(({ id, featureId }) => ({ id, featureId })), [{
			id: fixture.id,
			featureId: fixture.featureId,
		}], fixture.id);
	}
	assert.deepEqual(
		reconcileProjectOwnedFeatureRequirements({}, EMPTY_MANIFEST),
		EMPTY_MANIFEST,
		'the default foundation does not invent optional feature state',
	);
});

test('foundation registry and both profiles stay equal and classify unavailable state', () => {
	const registry = Object.keys(PROJECT_FEATURE_CAPABILITY_IDS).sort();
	assert.deepEqual(Object.keys(PRODUCT_PROFILES.soundscaper.capabilities).sort(), registry);
	assert.deepEqual(Object.keys(PRODUCT_PROFILES.framescaper.capabilities).sort(), registry);
	const manifest = reconcileProjectOwnedFeatureRequirements(FOUNDATION_FIXTURES[1].project, EMPTY_MANIFEST);
	const project = { schemaVersion: AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION, featureRequirements: manifest };
	for (const profile of [PRODUCT_PROFILES.soundscaper, PRODUCT_PROFILES.framescaper]) {
		const report = createProjectFeatureCompatibilityService(profile.capabilities).evaluate(project);
		assert.equal(report?.items[0]?.availability, 'unavailable');
		assert.equal(report?.compatible, false);
	}
});

test('V17 take/comp state is known but read-only in both product profiles', () => {
	const takeComp = FOUNDATION_FIXTURES.find(
		({ id }) => id === PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.takeComp,
	);
	assert.ok(takeComp);
	const featureRequirements = reconcileProjectOwnedFeatureRequirements(
		takeComp.project,
		EMPTY_MANIFEST,
	);
	const project = {
		schemaVersion: AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
		featureRequirements,
	};
	for (const profile of [PRODUCT_PROFILES.soundscaper, PRODUCT_PROFILES.framescaper]) {
		assert.equal(profile.capabilities.takeComp, false, profile.id);
		const report = createProjectFeatureCompatibilityService(profile.capabilities).evaluate(project);
		assert.deepEqual({
			compatible: report?.compatible,
			requirementId: report?.items[0]?.requirementId,
			featureId: report?.items[0]?.featureId,
			availability: report?.items[0]?.availability,
			declaredDisposition: report?.items[0]?.declaredDisposition,
			disposition: report?.items[0]?.disposition,
			fallback: report?.items[0]?.fallback,
		}, {
			compatible: false,
			requirementId: PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.takeComp,
			featureId: PROJECT_FEATURE_CAPABILITY_IDS.takeComp,
			availability: 'unavailable',
			declaredDisposition: 'bypass',
			disposition: 'bypassed',
			fallback: null,
		}, profile.id);
	}
});

test('a deliberately unregistered same-schema feature reports read-only incompatibility', () => {
	const project = {
		schemaVersion: AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
		featureRequirements: {
			schemaVersion: 2,
			requirements: [{
				id: 'fixture.unregistered',
				featureId: 'org.example.unregistered-foundation-state',
				displayName: 'Unregistered fixture',
				disposition: 'bypass',
				fallback: null,
			}],
		},
	};
	const report = createProjectFeatureCompatibilityService(PRODUCT_PROFILES.soundscaper.capabilities).evaluate(project);
	assert.equal(report?.compatible, false);
	assert.equal(report?.items[0]?.availability, 'unknown');
	assert.equal(report?.items[0]?.disposition, 'bypassed');
});
