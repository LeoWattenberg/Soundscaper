/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	PROJECT_FEATURE_REQUIREMENTS_LIMITS,
	evaluateProjectFeatureRequirements,
	normalizeProjectFeatureRequirements,
} from '../src/common/editor/project-feature-requirements.ts';

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
		disposition: string;
	}) => ({
		requirementId: item.requirementId,
		availability: item.availability,
		disposition: item.disposition,
	})), [
		{ requirementId: 'available', availability: 'available', disposition: 'native' },
		{ requirementId: 'unavailable', availability: 'unavailable', disposition: 'bypassed' },
		{ requirementId: 'unknown', availability: 'unknown', disposition: 'rendered-fallback' },
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
