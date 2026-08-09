/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	PROJECT_FEATURE_REQUIREMENTS_LIMITS,
	evaluateProjectFeatureRequirements,
	normalizeProjectFeatureRequirements,
	remapProjectFeatureRequirementSourceIds,
} from '../src/common/editor/project-feature-requirements.ts';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';

const AUDIO_DIGEST = 'ab'.repeat(32);
const VIDEO_DIGEST = 'cd'.repeat(32);
const SOURCES = Object.freeze([
	Object.freeze({ id: 'rendered-audio', name: 'Rendered audio' }),
	Object.freeze({ id: 'rendered-video', kind: 'video', name: 'Rendered video' }),
]);

function requirement(overrides: Record<string, unknown> = {}) {
	return {
		id: 'requirement-linear-phase-eq',
		featureId: 'org.soundscaper.native.linear-phase-eq',
		displayName: 'Linear phase EQ',
		disposition: 'bypass',
		fallback: null,
		...overrides,
	};
}

function manifest(requirements: readonly Record<string, unknown>[]) {
	return { schemaVersion: 1, requirements: [...requirements] };
}

function currentManifest(requirements: readonly Record<string, unknown>[]) {
	return { schemaVersion: 2, requirements: [...requirements] };
}

function clipFallbackFixture() {
	const targetSource = Object.freeze({
		id: 'original-video',
		kind: 'video',
		frameCount: 900,
		sampleRate: 48_000,
		width: 1_920,
		height: 1_080,
		frameRate: 30,
		hasAudio: true,
	});
	const fallbackSource = Object.freeze({
		id: 'rendered-clip',
		kind: 'video',
		frameCount: 120,
		sampleRate: 48_000,
		width: 1_920,
		height: 1_080,
		frameRate: 30,
		hasAudio: false,
	});
	const clip = Object.freeze({
		id: 'target-clip',
		kind: 'video',
		sourceId: targetSource.id,
		durationFrames: 120,
		videoEffects: Object.freeze([createVideoEffect('pixelate', { id: 'pixelate-target' })]),
	});
	const fallback = Object.freeze({
		role: 'video-clip-render-v1',
		kind: 'video',
		sourceId: fallbackSource.id,
		sha256: VIDEO_DIGEST,
		targetClipId: clip.id,
	});
	return { targetSource, fallbackSource, clip, fallback };
}

test('feature requirements normalize available, unavailable, and unknown native features', () => {
	const availableFeature = 'org.soundscaper.native.linear-phase-eq';
	const unavailableFeature = 'org.soundscaper.native.spectral-repair';
	const unknownFeature = 'com.example.native.future-processor';
	const normalized = normalizeProjectFeatureRequirements(manifest([
		requirement({ id: 'available', featureId: availableFeature, displayName: 'Linear phase EQ' }),
		requirement({ id: 'unavailable', featureId: unavailableFeature, displayName: 'Spectral repair' }),
		requirement({
			id: 'unknown',
			featureId: unknownFeature,
			displayName: 'Future processor',
			disposition: 'rendered-fallback',
			fallback: { kind: 'audio', sourceId: 'rendered-audio', sha256: AUDIO_DIGEST },
		}),
	]), { sources: SOURCES });

	const report = evaluateProjectFeatureRequirements(normalized, {
		knownFeatureIds: new Set([availableFeature, unavailableFeature]),
		availableFeatureIds: new Set([availableFeature]),
	});

	assert.equal(report.schemaVersion, 1);
	assert.equal(report.format, 'soundscaper-project');
	assert.equal(report.compatible, false);
	assert.deepEqual(report.counts, { available: 1, unavailable: 1, unknown: 1 });
	assert.deepEqual(report.items.map((item: {
		requirementId: string;
		availability: string;
		declaredDisposition: string;
		disposition: string;
	}) => ({
		requirementId: item.requirementId,
		availability: item.availability,
		declaredDisposition: item.declaredDisposition,
		disposition: item.disposition,
	})), [
		{ requirementId: 'available', availability: 'available', declaredDisposition: 'bypass', disposition: 'native' },
		{ requirementId: 'unavailable', availability: 'unavailable', declaredDisposition: 'bypass', disposition: 'bypassed' },
		{ requirementId: 'unknown', availability: 'unknown', declaredDisposition: 'rendered-fallback', disposition: 'rendered-fallback' },
	]);
	for (const item of report.items.filter((candidate: {
		availability: string;
		message: string;
	}) => candidate.availability !== 'available')) {
		assert.ok(item.message.trim().length > 0);
	}
});

test('normalization returns a deeply frozen clone of requirement and fallback state', () => {
	const input = manifest([requirement({
		disposition: 'rendered-fallback',
		fallback: { kind: 'video', sourceId: 'rendered-video', sha256: VIDEO_DIGEST },
	})]);
	const normalized = normalizeProjectFeatureRequirements(input, { sources: SOURCES });

	assert.notStrictEqual(normalized, input);
	assert.notStrictEqual(normalized.requirements, input.requirements);
	assert.notStrictEqual(normalized.requirements[0], input.requirements[0]);
	assert.notStrictEqual(normalized.requirements[0]?.fallback, input.requirements[0]?.fallback);
	assert.equal(Object.isFrozen(normalized), true);
	assert.equal(Object.isFrozen(normalized.requirements), true);
	assert.equal(Object.isFrozen(normalized.requirements[0]), true);
	assert.equal(Object.isFrozen(normalized.requirements[0]?.fallback), true);

	input.requirements[0]!.displayName = 'Changed after normalization';
	(input.requirements[0]!.fallback as Record<string, unknown>).sourceId = 'changed-source';
	assert.equal(normalized.requirements[0]?.displayName, 'Linear phase EQ');
	assert.equal(normalized.requirements[0]?.fallback?.sourceId, 'rendered-video');
});

test('legacy V1 fallback descriptors normalize deterministically to the closed V2 roles', () => {
	const normalized = normalizeProjectFeatureRequirements(manifest([
		requirement({
			id: 'audio-fallback',
			disposition: 'rendered-fallback',
			fallback: { kind: 'audio', sourceId: 'rendered-audio', sha256: AUDIO_DIGEST },
		}),
		requirement({
			id: 'video-fallback',
			disposition: 'rendered-fallback',
			fallback: { kind: 'video', sourceId: 'rendered-video', sha256: VIDEO_DIGEST },
		}),
	]), { sources: SOURCES });

	assert.equal(normalized.schemaVersion, 2);
	assert.deepEqual(normalized.requirements.map(({ fallback }) => fallback), [{
		role: 'project-audio-mix-v1',
		kind: 'audio',
		sourceId: 'rendered-audio',
		sha256: AUDIO_DIGEST,
	}, {
		role: 'project-video-render-v1',
		kind: 'video',
		sourceId: 'rendered-video',
		sha256: VIDEO_DIGEST,
	}]);
	for (const extra of [{ role: 'project-audio-mix-v1' }, { targetClipId: 'target-clip' }]) {
		assert.throws(() => normalizeProjectFeatureRequirements(manifest([requirement({
			disposition: 'rendered-fallback',
			fallback: {
				kind: 'audio', sourceId: 'rendered-audio', sha256: AUDIO_DIGEST, ...extra,
			},
		})]), { sources: SOURCES }), /unsupported field/iu);
	}
});

test('V2 fallback roles require their exact closed descriptor shapes', () => {
	const valid = [{
		role: 'project-audio-mix-v1', kind: 'audio', sourceId: 'rendered-audio', sha256: AUDIO_DIGEST,
	}, {
		role: 'project-video-render-v1', kind: 'video', sourceId: 'rendered-video', sha256: VIDEO_DIGEST,
	}];
	for (const fallback of valid) {
		const normalized = normalizeProjectFeatureRequirements(currentManifest([requirement({
			disposition: 'rendered-fallback', fallback,
		})]), { sources: SOURCES });
		assert.deepEqual(normalized.requirements[0]?.fallback, fallback);
	}

	for (const fallback of [{
		kind: 'audio', sourceId: 'rendered-audio', sha256: AUDIO_DIGEST,
	}, {
		role: 'future-role', kind: 'audio', sourceId: 'rendered-audio', sha256: AUDIO_DIGEST,
	}, {
		role: 'project-audio-mix-v1', kind: 'video', sourceId: 'rendered-video', sha256: VIDEO_DIGEST,
	}, {
		role: 'project-video-render-v1', kind: 'video', sourceId: 'rendered-video', sha256: VIDEO_DIGEST,
		targetClipId: 'target-clip',
	}]) {
		assert.throws(() => normalizeProjectFeatureRequirements(currentManifest([requirement({
			disposition: 'rendered-fallback', fallback,
		})]), { sources: SOURCES }), /role|kind|unsupported field/iu);
	}
	assert.throws(() => normalizeProjectFeatureRequirements({
		schemaVersion: 3,
		requirements: [],
	}, { sources: SOURCES }), /unsupported.*schema version/iu);
});

test('clip-local video fallback validates its exact target relationship and remaps only its source', () => {
	const fixture = clipFallbackFixture();
	const normalized = normalizeProjectFeatureRequirements(currentManifest([requirement({
		featureId: PROJECT_FEATURE_CAPABILITY_IDS.videoEffects,
		disposition: 'rendered-fallback',
		fallback: fixture.fallback,
	})]), {
		sources: [fixture.targetSource, fixture.fallbackSource],
		clips: [fixture.clip],
	});

	assert.deepEqual(normalized.requirements[0]?.fallback, fixture.fallback);
	assert.equal(Object.isFrozen(normalized.requirements[0]?.fallback), true);
	const copiedFallback = { ...fixture.fallbackSource, id: 'copied-rendered-clip' };
	const remapped = remapProjectFeatureRequirementSourceIds(
		normalized,
		new Map([[fixture.fallbackSource.id, copiedFallback.id], [fixture.clip.id, 'wrong-clip-id']]),
		{ sources: [fixture.targetSource, copiedFallback], clips: [fixture.clip] },
	);
	assert.deepEqual(remapped.requirements[0]?.fallback, {
		...fixture.fallback,
		sourceId: copiedFallback.id,
	});
});

test('clip-local video fallback rejects mismatched feature, clip, effects, and media geometry', async (context) => {
	const fixture = clipFallbackFixture();
	const normalize = (
		fallback: Readonly<Record<string, unknown>> = fixture.fallback,
		sources: readonly Readonly<Record<string, unknown>>[] = [fixture.targetSource, fixture.fallbackSource],
		clips: readonly Readonly<Record<string, unknown>>[] = [fixture.clip],
		featureId: string = PROJECT_FEATURE_CAPABILITY_IDS.videoEffects,
	) => normalizeProjectFeatureRequirements(currentManifest([requirement({
		featureId,
		disposition: 'rendered-fallback',
		fallback,
	})]), { sources, clips });
	const cases: Array<Readonly<{
		name: string;
		run: () => unknown;
		expected: RegExp;
	}>> = [{
		name: 'wrong feature',
		run: () => normalize(fixture.fallback, undefined, undefined, 'org.soundscaper.capability.video-export'),
		expected: /video-effects|feature/iu,
	}, {
		name: 'missing clip',
		run: () => normalize(fixture.fallback, undefined, []),
		expected: /target.*clip|timeline.*clip/iu,
	}, {
		name: 'duplicate clip',
		run: () => normalize(fixture.fallback, undefined, [fixture.clip, { ...fixture.clip }]),
		expected: /unique|duplicate|exactly one/iu,
	}, {
		name: 'audio clip',
		run: () => normalize(fixture.fallback, undefined, [{ ...fixture.clip, kind: 'audio' }]),
		expected: /video clip|clip.*video/iu,
	}, {
		name: 'disabled effects',
		run: () => normalize(fixture.fallback, undefined, [{
			...fixture.clip,
			videoEffects: [createVideoEffect('pixelate', { id: 'disabled', enabled: false })],
		}]),
		expected: /enabled.*video effect/iu,
	}, {
		name: 'same canonical source',
		run: () => normalize({ ...fixture.fallback, sourceId: fixture.targetSource.id }),
		expected: /differ|same.*source/iu,
	}, {
		name: 'fallback audio',
		run: () => normalize(fixture.fallback, [
			fixture.targetSource, { ...fixture.fallbackSource, hasAudio: true },
		]),
		expected: /hasAudio|audio/iu,
	}];
	for (const field of ['frameCount', 'sampleRate', 'width', 'height', 'frameRate'] as const) {
		cases.push({
			name: `mismatched ${field}`,
			run: () => normalize(fixture.fallback, [
				fixture.targetSource,
				{ ...fixture.fallbackSource, [field]: Number(fixture.fallbackSource[field]) + 1 },
			]),
			expected: new RegExp(field === 'frameCount' ? 'sample-frame count' : field, 'iu'),
		});
	}

	for (const scenario of cases) {
		await context.test(scenario.name, () => {
			assert.throws(scenario.run, scenario.expected);
		});
	}
});

test('inconsistent capability registries fail closed', () => {
	const featureId = 'com.example.native.unrecognized';
	const normalized = normalizeProjectFeatureRequirements(manifest([
		requirement({ id: 'unknown', featureId, displayName: 'Unrecognized processor' }),
	]), { sources: SOURCES });
	assert.throws(() => evaluateProjectFeatureRequirements(normalized, {
		knownFeatureIds: new Set(),
		availableFeatureIds: new Set([featureId]),
	}), /available.*not.*known|capability.*inconsistent/iu);
});

test('normalization rejects sparse requirement arrays', () => {
	assert.throws(() => normalizeProjectFeatureRequirements({
		schemaVersion: 1,
		requirements: new Array(1),
	}, { sources: SOURCES }), /requirement.*object/iu);
});

test('evaluation validates and defensively freezes its manifest input', () => {
	const input = manifest([requirement({
		disposition: 'rendered-fallback',
		fallback: { kind: 'audio', sourceId: 'rendered-audio', sha256: AUDIO_DIGEST },
	})]);
	const report = evaluateProjectFeatureRequirements(
		input as never,
		{
			knownFeatureIds: new Set(),
			availableFeatureIds: new Set(),
		},
	);
	(input.requirements[0]!.fallback as Record<string, unknown>).sourceId = 'changed-after-evaluation';
	assert.equal(report.items[0]?.fallback?.sourceId, 'rendered-audio');
	assert.equal(Object.isFrozen(report.items[0]?.fallback), true);
	assert.throws(() => evaluateProjectFeatureRequirements(manifest([
		requirement({ disposition: 'activate' }),
	]) as never, {
		knownFeatureIds: new Set(),
		availableFeatureIds: new Set(),
	}), /disposition/iu);
	assert.throws(() => evaluateProjectFeatureRequirements({
		schemaVersion: 1,
		requirements: new Array(PROJECT_FEATURE_REQUIREMENTS_LIMITS.maximumRequirements + 1),
	} as never, {
		knownFeatureIds: new Set(),
		availableFeatureIds: new Set(),
	}), /too many|maximum.*requirements|requirements.*limit/iu);
});

test('feature requirement IDs must be unique', () => {
	assert.throws(() => normalizeProjectFeatureRequirements(manifest([
		requirement({ id: 'duplicate' }),
		requirement({ id: 'duplicate', featureId: 'org.soundscaper.native.other' }),
	]), { sources: SOURCES }), /duplicate.*requirement.*id/iu);
});

test('fallback source remapping is pure, validated, and deeply frozen', () => {
	const normalized = normalizeProjectFeatureRequirements(manifest([requirement({
		disposition: 'rendered-fallback',
		fallback: { kind: 'audio', sourceId: 'rendered-audio', sha256: AUDIO_DIGEST },
	})]), { sources: SOURCES });
	const remapped = remapProjectFeatureRequirementSourceIds(
		normalized,
		new Map([['rendered-audio', 'copied-audio']]),
		{ sources: [{ id: 'copied-audio', kind: 'audio' }] },
	);

	assert.equal(normalized.requirements[0]?.fallback?.sourceId, 'rendered-audio');
	assert.equal(remapped.requirements[0]?.fallback?.sourceId, 'copied-audio');
	assert.equal(Object.isFrozen(remapped), true);
	assert.equal(Object.isFrozen(remapped.requirements[0]?.fallback), true);
});

test('feature IDs are canonical namespaced identifiers and dispositions are closed', () => {
	for (const featureId of [
		'',
		'linear-phase-eq',
		'org..linear-phase-eq',
		'org.soundscaper.native.bad feature',
		'org.soundscaper.native.bad\u0000feature',
	]) {
		assert.throws(
			() => normalizeProjectFeatureRequirements(manifest([requirement({ featureId })]), { sources: SOURCES }),
			/feature.*id/iu,
			featureId,
		);
	}
	assert.throws(() => normalizeProjectFeatureRequirements(manifest([
		requirement({ disposition: 'activate' }),
	]), { sources: SOURCES }), /disposition/iu);
	assert.throws(() => normalizeProjectFeatureRequirements(manifest([
		requirement({ disposition: 'rendered-fallback', fallback: null }),
	]), { sources: SOURCES }), /fallback/iu);
	assert.throws(() => normalizeProjectFeatureRequirements(manifest([
		requirement({ displayName: 'Spoofed\u202ename' }),
	]), { sources: SOURCES }), /control|format/iu);
	assert.throws(() => normalizeProjectFeatureRequirements(manifest([
		requirement({ fallback: { kind: 'audio', sourceId: 'rendered-audio', sha256: AUDIO_DIGEST } }),
	]), { sources: SOURCES }), /fallback.*disposition|disposition.*fallback/iu);
});

test('rendered fallbacks require a canonical digest and a matching project source', () => {
	for (const sha256 of ['ab', 'g'.repeat(64), 'AB'.repeat(32)]) {
		assert.throws(() => normalizeProjectFeatureRequirements(manifest([requirement({
			disposition: 'rendered-fallback',
			fallback: { kind: 'audio', sourceId: 'rendered-audio', sha256 },
		})]), { sources: SOURCES }), /SHA-256|digest/iu);
	}
	assert.throws(() => normalizeProjectFeatureRequirements(manifest([requirement({
		disposition: 'rendered-fallback',
		fallback: { kind: 'audio', sourceId: 'missing-source', sha256: AUDIO_DIGEST },
	})]), { sources: SOURCES }), /fallback.*source|missing-source/iu);
	assert.throws(() => normalizeProjectFeatureRequirements(manifest([requirement({
		disposition: 'rendered-fallback',
		fallback: { kind: 'audio', sourceId: 'rendered-video', sha256: VIDEO_DIGEST },
	})]), { sources: SOURCES }), /fallback.*kind|source.*kind/iu);
	assert.throws(() => normalizeProjectFeatureRequirements(manifest([requirement({
		disposition: 'rendered-fallback',
		fallback: { kind: 'video', sourceId: 'rendered-audio', sha256: AUDIO_DIGEST },
	})]), { sources: SOURCES }), /fallback.*kind|source.*kind/iu);
	assert.throws(() => normalizeProjectFeatureRequirements(manifest([requirement({
		disposition: 'rendered-fallback',
		fallback: { kind: 'audio', sourceId: 'duplicate', sha256: AUDIO_DIGEST },
	})]), { sources: [{ id: 'duplicate' }, { id: 'duplicate' }] }), /duplicate.*source.*id/iu);
	assert.throws(() => normalizeProjectFeatureRequirements(manifest([requirement({
		disposition: 'rendered-fallback',
		fallback: { kind: 'audio', sourceId: 'null-kind', sha256: AUDIO_DIGEST },
	})]), { sources: [{ id: 'null-kind', kind: null }] }), /fallback.*kind|source.*kind/iu);
});

test('feature requirement collection and strings enforce published non-raiseable bounds', () => {
	const limits = PROJECT_FEATURE_REQUIREMENTS_LIMITS;
	assert.ok(Number.isSafeInteger(limits.maximumRequirements));
	assert.ok(limits.maximumRequirements > 0 && limits.maximumRequirements <= 4_096);
	assert.ok(Number.isSafeInteger(limits.maximumRequirementIdLength));
	assert.ok(limits.maximumRequirementIdLength > 0 && limits.maximumRequirementIdLength <= 256);
	assert.ok(Number.isSafeInteger(limits.maximumFeatureIdLength));
	assert.ok(limits.maximumFeatureIdLength > 0 && limits.maximumFeatureIdLength <= 512);
	assert.ok(Number.isSafeInteger(limits.maximumDisplayNameLength));
	assert.ok(limits.maximumDisplayNameLength > 0 && limits.maximumDisplayNameLength <= 1_024);

	const tooMany = Array.from({ length: limits.maximumRequirements + 1 }, (_, index) => requirement({
		id: `requirement-${String(index)}`,
		featureId: `org.soundscaper.native.feature-${String(index)}`,
	}));
	assert.throws(
		() => normalizeProjectFeatureRequirements(manifest(tooMany), { sources: SOURCES }),
		/too many|maximum.*requirements|requirements.*limit/iu,
	);
	assert.throws(() => normalizeProjectFeatureRequirements(manifest([requirement({
		id: 'r'.repeat(limits.maximumRequirementIdLength + 1),
	})]), { sources: SOURCES }), /requirement.*id.*length|requirement.*id.*long/iu);
	assert.throws(() => normalizeProjectFeatureRequirements(manifest([requirement({
		featureId: `org.soundscaper.native.${'f'.repeat(limits.maximumFeatureIdLength)}`,
	})]), { sources: SOURCES }), /feature.*id.*length|feature.*id.*long/iu);
	assert.throws(() => normalizeProjectFeatureRequirements(manifest([requirement({
		displayName: 'N'.repeat(limits.maximumDisplayNameLength + 1),
	})]), { sources: SOURCES }), /display.*name.*length|display.*name.*long/iu);
});
