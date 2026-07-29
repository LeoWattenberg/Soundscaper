/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { PRODUCT_PROFILES } from '../src/common/products.js';
import {
	PROJECT_FEATURE_CAPABILITY_IDS,
} from '../src/common/editor/project-feature-capabilities.ts';
import {
	createProjectFeatureCompatibilityService,
} from '../src/common/editor/controller/project-feature-compatibility-service.ts';

type Requirement = Readonly<{
	id: string;
	featureId: string;
	displayName: string;
	disposition: 'bypass';
	fallback: null;
}>;

test('the feature registry explicitly covers every maintained product capability', () => {
	const registryKeys = Object.keys(PROJECT_FEATURE_CAPABILITY_IDS).sort();
	for (const productId of ['soundscaper', 'framescaper'] as const) {
		const profile = PRODUCT_PROFILES[productId];
		assert.deepEqual(registryKeys, Object.keys(profile.capabilities).sort(), profile.id);
	}
	const featureIds = Object.values(PROJECT_FEATURE_CAPABILITY_IDS);
	assert.equal(new Set(featureIds).size, featureIds.length);
	for (const featureId of featureIds) {
		assert.match(featureId, /^org\.soundscaper\.capability\.[a-z0-9]+(?:-[a-z0-9]+)*$/u);
	}
	assert.equal(Object.isFrozen(PROJECT_FEATURE_CAPABILITY_IDS), true);
});

test('product capability reports distinguish available, unavailable, and unregistered features', () => {
	const input = featureProject([
		requirement('audio-effects', PROJECT_FEATURE_CAPABILITY_IDS.audioEffects, 'Audio effects'),
		requirement('video-effects', PROJECT_FEATURE_CAPABILITY_IDS.videoEffects, 'Video effects'),
		requirement('native-effect', 'org.soundscaper.native.spectral-repair', 'Spectral repair'),
	]);
	const original = structuredClone(input);
	const soundscaper = createProjectFeatureCompatibilityService(PRODUCT_PROFILES.soundscaper.capabilities);
	const framescaper = createProjectFeatureCompatibilityService(PRODUCT_PROFILES.framescaper.capabilities);

	const soundReport = soundscaper.evaluate(input);
	const frameReport = framescaper.evaluate(input);
	assert.ok(soundReport && frameReport);
	assert.deepEqual(soundReport.items.map(({ availability }) => availability), [
		'available', 'unavailable', 'unknown',
	]);
	assert.deepEqual(frameReport.items.map(({ availability }) => availability), [
		'unavailable', 'available', 'unknown',
	]);
	assert.equal(soundReport.compatible, false);
	assert.equal(Object.isFrozen(soundReport), true);
	assert.equal(Object.isFrozen(soundReport.items), true);
	assert.deepEqual(input, original);
});

test('capability availability is a strict immutable construction-time snapshot', () => {
	const capabilities: Record<string, unknown> = { audioEffects: true };
	const service = createProjectFeatureCompatibilityService(capabilities);
	capabilities.audioEffects = false;
	const available = service.evaluate(featureProject([
		requirement('audio-effects', PROJECT_FEATURE_CAPABILITY_IDS.audioEffects, 'Audio effects'),
	]));
	const forged = createProjectFeatureCompatibilityService({ audioEffects: 1 }).evaluate(featureProject([
		requirement('audio-effects', PROJECT_FEATURE_CAPABILITY_IDS.audioEffects, 'Audio effects'),
	]));

	assert.equal(available?.items[0]?.availability, 'available');
	assert.equal(forged?.items[0]?.availability, 'unavailable');
	assert.equal(Object.isFrozen(service), true);
});

test('future project schemas remain opaque to feature compatibility evaluation', () => {
	const service = createProjectFeatureCompatibilityService(PRODUCT_PROFILES.soundscaper.capabilities);
	const futureProject = {
		schemaVersion: 10,
		get featureRequirements(): never {
			throw new Error('future feature metadata was traversed');
		},
	};

	assert.equal(service.evaluate(futureProject), null);
});

function featureProject(requirements: readonly Requirement[]) {
	return {
		schemaVersion: 9,
		featureRequirements: { schemaVersion: 1, requirements },
	};
}

function requirement(id: string, featureId: string, displayName: string): Requirement {
	return { id, featureId, displayName, disposition: 'bypass', fallback: null };
}
