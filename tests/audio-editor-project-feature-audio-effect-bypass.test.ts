/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	PROJECT_FEATURE_AUDIO_EFFECT_BYPASS_LIMITS,
	projectFeatureAudioEffectPlaybackBypass,
} from '../src/common/editor/project-feature-audio-effect-bypass.ts';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import type { ProjectFeatureRequirementsReport } from '../src/common/editor/project-feature-requirements.ts';
import {
	AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
	FRAMESCAPER_PROJECT_V19_SCHEMA_VERSION,
	SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION,
} from '../src/common/editor/project-schema-version.ts';

const AUDIO_EFFECTS = PROJECT_FEATURE_CAPABILITY_IDS.audioEffects;

function report(overrides: Record<string, unknown> = {}): ProjectFeatureRequirementsReport {
	return {
		schemaVersion: 1,
		format: 'soundscaper-project',
		compatible: false,
		counts: { available: 0, unavailable: 1, unknown: 0 },
		items: [{
			requirementId: 'soundscaper-audio-effects',
			featureId: AUDIO_EFFECTS,
			displayName: 'Audio effects',
			availability: 'unavailable',
			declaredDisposition: 'bypass',
			disposition: 'bypassed',
			fallback: null,
			message: 'Audio effects are unavailable.',
			...overrides,
		}],
	};
}

function effect(
	id: string,
	type = 'compressor',
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		id,
		type,
		enabled: true,
		params: { threshold: -24 },
		state: { retained: new Uint8Array([1, 2, 3]) },
		...overrides,
	};
}

function project() {
	return {
		schemaVersion: AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
		id: 'project',
		tracks: [{
			id: 'track-a',
			type: 'audio',
			effectsActive: true,
			effects: [effect('track-effect'), effect('disabled-effect', 'delay', { enabled: false })],
		}, {
			id: 'label-a',
			type: 'label',
			effects: [effect('ignored-label-effect')],
		}],
		master: { effectsActive: true, effects: [effect('master-effect', 'limiter')] },
		mixer: {
			groups: [{ id: 'group-a', effectsActive: true, effects: [effect('group-effect', 'eq')] }],
			sends: [{ id: 'send-a', effectsActive: false, effects: [effect('inactive-send-effect', 'reverb')] }],
			routes: {},
		},
	};
}

test('declared unavailable first-party audio effects are bypassed only in a bounded playback projection', () => {
	const input = project();
	const before = structuredClone(input);
	const result = projectFeatureAudioEffectPlaybackBypass(input, report());

	assert.notStrictEqual(result.project, input);
	assert.deepEqual(input, before);
	assert.equal(result.metadata?.featureId, AUDIO_EFFECTS);
	assert.deepEqual(result.metadata?.requirementIds, ['soundscaper-audio-effects']);
	assert.deepEqual(result.metadata?.placeholders, [{
		scope: 'track', ownerId: 'track-a', effectId: 'track-effect', effectType: 'compressor',
	}, {
		scope: 'group', ownerId: 'group-a', effectId: 'group-effect', effectType: 'eq',
	}, {
		scope: 'master', ownerId: null, effectId: 'master-effect', effectType: 'limiter',
	}]);

	const projected = result.project as ReturnType<typeof project>;
	assert.equal(projected.tracks[0]?.effects[0]?.bypassed, true);
	assert.equal(projected.tracks[0]?.effects[0]?.enabled, true);
	assert.deepEqual(projected.tracks[0]?.effects[0]?.params, {});
	assert.strictEqual(projected.tracks[0]?.effects[1], input.tracks[0]?.effects[1]);
	assert.strictEqual(projected.tracks[1], input.tracks[1]);
	assert.equal(projected.mixer.groups[0]?.effects[0]?.bypassed, true);
	assert.strictEqual(projected.mixer.sends[0], input.mixer.sends[0]);
	assert.equal(projected.master.effects[0]?.bypassed, true);
	assert.equal(Object.isFrozen(result), true);
	assert.equal(Object.isFrozen(result.metadata), true);
	assert.equal(Object.isFrozen(result.metadata?.placeholders), true);
	assert.equal(Object.isFrozen(result.metadata?.placeholders[0]), true);
});

test('selected product schemas retain the inherited audio-effect playback projection', () => {
	for (const schemaVersion of [
		FRAMESCAPER_PROJECT_V19_SCHEMA_VERSION,
		SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION,
	]) {
		const input = { ...project(), schemaVersion };
		const result = projectFeatureAudioEffectPlaybackBypass(input, report());
		assert.equal(
			result.metadata?.placeholders.length,
			3,
			`schema ${String(schemaVersion)} must retain inherited audio-effect bypass`,
		);
		assert.equal(result.project.tracks[0]?.effects[0]?.bypassed, true);
	}
});

test('the projector ignores unsupported dispositions, unknown IDs, future schemas, and missing effects', () => {
	const input = project();
	input.tracks[0]!.effects = [effect('missing-effect', 'missing', { bypassed: true })];
	for (const candidate of [
		report({ availability: 'unknown' }),
		report({ declaredDisposition: 'rendered-fallback', disposition: 'rendered-fallback' }),
		report({ featureId: 'org.example.unregistered' }),
		null,
	]) {
		const result = projectFeatureAudioEffectPlaybackBypass(input, candidate as ProjectFeatureRequirementsReport | null);
		assert.strictEqual(result.project, input);
		assert.equal(result.metadata, null);
	}

	const future = {
		...input,
		schemaVersion: AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION + 1,
		get tracks(): never { throw new Error('future tracks were traversed'); },
	};
	const result = projectFeatureAudioEffectPlaybackBypass(future, report());
	assert.strictEqual(result.project, future);
	assert.equal(result.metadata, null);
});

test('placeholder inventory never reads effect payload state or silently truncates its bound', () => {
	let payloadReads = 0;
	const guardedEffect = effect('guarded-effect');
	for (const property of ['params', 'context', 'state', 'opaqueAudacityNode']) {
		Object.defineProperty(guardedEffect, property, {
			configurable: true,
			enumerable: true,
			get() {
				payloadReads += 1;
				throw new Error(`${property} was read`);
			},
		});
	}
	const input = {
		...project(),
		tracks: [{ id: 'track-a', type: 'audio', effects: [guardedEffect] }],
		master: { effects: [] },
		mixer: { groups: [], sends: [], routes: {} },
	};
	const projected = projectFeatureAudioEffectPlaybackBypass(input, report());
	assert.equal(payloadReads, 0);
	assert.equal((projected.project as typeof input).tracks[0]?.effects[0]?.bypassed, true);

	assert.throws(() => projectFeatureAudioEffectPlaybackBypass(input, report(), {
		maximumAffectedEffects: 0,
	}), /affected.*effect.*limit|too many.*effect/iu);
	assert.equal(payloadReads, 0);
	assert.throws(() => projectFeatureAudioEffectPlaybackBypass(input, report(), {
		maximumAffectedEffects: PROJECT_FEATURE_AUDIO_EFFECT_BYPASS_LIMITS.maximumAffectedEffects + 1,
	}), /lower|production.*limit|cannot.*raise/iu);
});
