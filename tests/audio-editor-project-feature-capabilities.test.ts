/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { PRODUCT_PROFILES } from '../src/common/products.js';
import { audioEffectTypes } from '../src/common/editor/effects.js';
import {
	PROJECT_FEATURE_AUDIO_EFFECT_TYPES,
	PROJECT_FEATURE_CAPABILITY_IDS,
} from '../src/common/editor/project-feature-capabilities.ts';
import {
	createProjectFeatureCompatibilityService,
} from '../src/common/editor/controller/project-feature-compatibility-service.ts';
import {
	AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
	FRAMESCAPER_PROJECT_V19_SCHEMA_VERSION,
	FRAMESCAPER_PROJECT_V20_SCHEMA_VERSION,
	SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION,
	SOUNDSCAPER_PROJECT_V23_SCHEMA_VERSION,
} from '../src/common/editor/project-schema-version.ts';

type Requirement = Readonly<{
	id: string;
	featureId: string;
	displayName: string;
	disposition: 'bypass';
	fallback: null;
}>;

test('the project registry covers project capabilities without absorbing application capabilities', () => {
	const registryKeys = Object.keys(PROJECT_FEATURE_CAPABILITY_IDS).sort();
	for (const productId of ['soundscaper', 'framescaper'] as const) {
		const profile = PRODUCT_PROFILES[productId];
		assert.deepEqual(registryKeys, Object.keys(profile.capabilities).sort(), profile.id);
	}
	assert.equal(PRODUCT_PROFILES.framescaper.applicationFeatures.framescaperCapture, true);
	assert.equal(PRODUCT_PROFILES.framescaper.applicationFeatures.framescaperWebVcr, false);
	assert.equal(Object.hasOwn(PRODUCT_PROFILES.soundscaper.applicationFeatures, 'framescaperCapture'), false);
	const featureIds = Object.values(PROJECT_FEATURE_CAPABILITY_IDS);
	assert.equal(new Set(featureIds).size, featureIds.length);
	for (const featureId of featureIds) {
		assert.match(
			featureId,
			/^org\.soundscaper\.capability\.[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*$/u,
		);
	}
	assert.equal(Object.isFrozen(PROJECT_FEATURE_CAPABILITY_IDS), true);
	assert.deepEqual([...PROJECT_FEATURE_AUDIO_EFFECT_TYPES].sort(), audioEffectTypes().sort());
	assert.equal(Object.isFrozen(PROJECT_FEATURE_AUDIO_EFFECT_TYPES), true);
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

test('dormant and future project schemas remain opaque to feature compatibility evaluation', () => {
	const service = createProjectFeatureCompatibilityService(PRODUCT_PROFILES.soundscaper.capabilities);
	for (const schemaVersion of [
		FRAMESCAPER_PROJECT_V20_SCHEMA_VERSION + 2,
		SOUNDSCAPER_PROJECT_V23_SCHEMA_VERSION + 1,
	]) {
		const unsupportedProject = {
			schemaVersion,
			get featureRequirements(): never {
				throw new Error('unsupported feature metadata was traversed');
			},
		};
		assert.equal(service.evaluate(unsupportedProject), null);
	}
});

test('selected product schemas retain feature compatibility evaluation after activation', () => {
	const service = createProjectFeatureCompatibilityService(PRODUCT_PROFILES.soundscaper.capabilities);
	for (const schemaVersion of [
		FRAMESCAPER_PROJECT_V19_SCHEMA_VERSION,
		FRAMESCAPER_PROJECT_V20_SCHEMA_VERSION,
		SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION,
		SOUNDSCAPER_PROJECT_V23_SCHEMA_VERSION,
	]) {
		const report = service.evaluate({
			...featureProject([
				requirement('video-effects', PROJECT_FEATURE_CAPABILITY_IDS.videoEffects, 'Video effects'),
			]),
			schemaVersion,
		});
		assert.equal(report?.items[0]?.availability, 'unavailable');
	}
});

function featureProject(requirements: readonly Requirement[]) {
	return {
		schemaVersion: AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
		featureRequirements: { schemaVersion: 1, requirements },
	};
}

function requirement(id: string, featureId: string, displayName: string): Requirement {
	return { id, featureId, displayName, disposition: 'bypass', fallback: null };
}
