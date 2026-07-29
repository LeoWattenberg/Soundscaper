/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import type { ProjectFeatureRequirementsReport } from '../src/common/editor/project-feature-requirements.ts';
import {
	PROJECT_FEATURE_VIDEO_EFFECT_BYPASS_LIMITS,
	projectFeatureVideoEffectPlaybackBypass,
} from '../src/common/editor/project-feature-video-effect-bypass.ts';

const VIDEO_EFFECTS = PROJECT_FEATURE_CAPABILITY_IDS.videoEffects;

function report(overrides: Record<string, unknown> = {}): ProjectFeatureRequirementsReport {
	return {
		schemaVersion: 1,
		format: 'soundscaper-project',
		compatible: false,
		counts: { available: 0, unavailable: 1, unknown: 0 },
		items: [{
			requirementId: 'soundscaper-video-effects',
			featureId: VIDEO_EFFECTS,
			displayName: 'Video effects',
			availability: 'unavailable',
			declaredDisposition: 'bypass',
			disposition: 'bypassed',
			fallback: null,
			message: 'Video effects are unavailable.',
			...overrides,
		}],
	};
}

function effect(
	id: string,
	type = 'pixelate',
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		id,
		type,
		enabled: true,
		params: { blockSize: 16 },
		state: { retained: new Uint8Array([1, 2, 3]) },
		...overrides,
	};
}

function project() {
	return {
		schemaVersion: 9,
		id: 'project',
		clips: [{
			id: 'video-clip',
			kind: 'video',
			videoEffects: [
				effect('active-effect'),
				effect('disabled-effect', 'glow', { enabled: false }),
				effect('foreign-effect', 'org.example.foreign'),
			],
		}, {
			id: 'audio-clip',
			kind: 'audio',
			videoEffects: [effect('forged-audio-effect')],
		}],
		projectBin: {
			clips: [{ id: 'bin-video-clip', kind: 'video', videoEffects: [effect('bin-effect')] }],
		},
	};
}

test('declared unavailable first-party video effects are bypassed only in a bounded playback projection', () => {
	const input = project();
	const before = structuredClone(input);
	const result = projectFeatureVideoEffectPlaybackBypass(input, report());

	assert.notStrictEqual(result.project, input);
	assert.deepEqual(input, before);
	assert.deepEqual(result.metadata, {
		schemaVersion: 1,
		featureId: VIDEO_EFFECTS,
		requirementIds: ['soundscaper-video-effects'],
		placeholders: [{
			location: 'timeline', clipId: 'video-clip', effectId: 'active-effect', effectType: 'pixelate',
		}, {
			location: 'project-bin', clipId: 'bin-video-clip', effectId: 'bin-effect', effectType: 'pixelate',
		}],
	});

	const projected = result.project as ReturnType<typeof project>;
	assert.equal(projected.clips[0]?.videoEffects[0]?.enabled, false);
	assert.deepEqual(projected.clips[0]?.videoEffects[0]?.params, {});
	assert.strictEqual(projected.clips[0]?.videoEffects[1], input.clips[0]?.videoEffects[1]);
	assert.strictEqual(projected.clips[0]?.videoEffects[2], input.clips[0]?.videoEffects[2]);
	assert.strictEqual(projected.clips[1], input.clips[1]);
	assert.notStrictEqual(projected.projectBin, input.projectBin);
	assert.equal(projected.projectBin.clips[0]?.videoEffects[0]?.enabled, false);
	assert.equal(Object.isFrozen(result), true);
	assert.equal(Object.isFrozen(result.metadata), true);
	assert.equal(Object.isFrozen(result.metadata?.placeholders), true);
	assert.equal(Object.isFrozen(result.metadata?.placeholders[0]), true);
});

test('the video projector ignores unsupported reports and returns before future-schema traversal', () => {
	const input = project();
	for (const candidate of [
		report({ availability: 'unknown' }),
		report({ declaredDisposition: 'rendered-fallback', disposition: 'rendered-fallback' }),
		report({ featureId: 'org.example.unregistered' }),
		null,
	]) {
		const result = projectFeatureVideoEffectPlaybackBypass(
			input,
			candidate as ProjectFeatureRequirementsReport | null,
		);
		assert.strictEqual(result.project, input);
		assert.equal(result.metadata, null);
	}

	const future = {
		...input,
		schemaVersion: 10,
		get clips(): never { throw new Error('future clips were traversed'); },
		get projectBin(): never { throw new Error('future Project Bin was traversed'); },
	};
	const result = projectFeatureVideoEffectPlaybackBypass(future, report());
	assert.strictEqual(result.project, future);
	assert.equal(result.metadata, null);
});

test('video placeholder inventory never reads effect payload state or silently truncates its bound', () => {
	let payloadReads = 0;
	const guardedEffect = effect('guarded-effect');
	for (const property of ['params', 'context', 'state', 'opaqueRendererNode']) {
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
		schemaVersion: 9,
		id: 'project',
		clips: [{ id: 'video-clip', kind: 'video', videoEffects: [guardedEffect] }],
		projectBin: { clips: [] },
	};
	const projected = projectFeatureVideoEffectPlaybackBypass(input, report());
	assert.equal(payloadReads, 0);
	assert.equal((projected.project as typeof input).clips[0]?.videoEffects[0]?.enabled, false);

	assert.throws(() => projectFeatureVideoEffectPlaybackBypass(input, report(), {
		maximumAffectedEffects: 0,
	}), /affected.*effect.*limit|too many.*effect/iu);
	assert.equal(payloadReads, 0);
	assert.throws(() => projectFeatureVideoEffectPlaybackBypass(input, report(), {
		maximumAffectedEffects: PROJECT_FEATURE_VIDEO_EFFECT_BYPASS_LIMITS.maximumAffectedEffects + 1,
	}), /lower|production.*limit|cannot.*raise/iu);

	let accessorReads = 0;
	const accessorProject = {
		...input,
		get projectBin(): never {
			accessorReads += 1;
			throw new Error('Project Bin accessor was invoked');
		},
	};
	assert.throws(
		() => projectFeatureVideoEffectPlaybackBypass(accessorProject, report()),
		/Project Bin|projectBin.*data property/iu,
	);
	assert.equal(accessorReads, 0);
});
