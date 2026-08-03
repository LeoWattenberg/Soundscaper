/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	admitAudioRenderedFallbackExport,
	assertAudioRenderedFallbackExportSettings,
	projectForAudioRenderedFallbackExport,
} from '../src/common/editor/controller/audio-rendered-fallback-export.ts';
import {
	createPlaybackProjectService,
	type AudioRenderedFallbackDeliveryProjection,
} from '../src/common/editor/controller/playback-project-service.ts';
import type { EngineChunkSource } from '../src/common/editor/engine/types.ts';
import {
	PROJECT_FEATURE_CAPABILITY_IDS,
	type ProjectFeatureAudioCapabilityId,
} from '../src/common/editor/project-feature-capabilities.ts';
import type { ProjectAudioFallbackIntegritySelector } from '../src/common/editor/project-fallback-integrity.ts';
import {
	createAudioClipV9,
	createAudioEditorProjectV9,
	createAudioSourceV9,
	createAudioTrackV9,
} from '../src/common/editor/project-v9.ts';

const FALLBACK_SOURCE_ID = 'fallback-audio';
const DIGEST = 'ef'.repeat(32);

test('audio fallback export selection is inert without a delivery service', async () => {
	const canonical = canonicalProject();
	const projection = projectForAudioRenderedFallbackExport(canonical);

	assert.strictEqual(projection.project, canonical);
	assert.equal(projection.featureRequirementsReport, null);
	assert.equal(projection.audioRenderedFallback, null);
	assert.deepEqual(projection.requiredAudioSourceIds, []);
	assert.equal(Object.isFrozen(projection), true);
	assert.equal(Object.isFrozen(projection.requiredAudioSourceIds), true);
	assert.doesNotThrow(() => assertAudioRenderedFallbackExportSettings(projection, {
		mode: 'stems', format: 'bw64', adm: { mode: 'authored' },
	}));
	assert.equal(await admitAudioRenderedFallbackExport(canonical, projection, { store: null }, {
		assertCurrent() { throw new Error('inactive admission asserted currentness'); },
	}), null);
});

test('audio fallback export admits and returns only the selected private chunk provider', async () => {
	const featureId = PROJECT_FEATURE_CAPABILITY_IDS.audioSpectralEditing;
	const canonical = canonicalProject(featureId);
	const projection = projectForAudioRenderedFallbackExport(
		canonical,
		createPlaybackProjectService({ audioSpectralEditing: false }),
	);
	const events: string[] = [];
	const store = Object.freeze({ id: 'project-store' });
	const controller = new AbortController();
	const channels = Object.freeze([
		Float32Array.of(0.25, -0.25),
		Float32Array.of(-0.25, 0.25),
	]);
	const provider: EngineChunkSource = Object.freeze({
		channelCount: 2,
		frameCount: 12,
		chunkFrames: 4,
		sampleRate: 48_000,
		async readStorageChunk() { return channels; },
	});
	const assertCurrent = () => { events.push('task-current'); };

	assertAudioRenderedFallbackExportSettings(projection, { mode: 'mix', format: 'wav' });
	const admitted = await admitAudioRenderedFallbackExport(canonical, projection, {
		store,
		verifyProjectFallbackIntegrity(project, candidateStore, options) {
			events.push('integrity');
			assert.strictEqual(project, canonical);
			assert.strictEqual(candidateStore, store);
			assert.strictEqual(options.signal, controller.signal);
			assert.strictEqual(options.assertCurrent, assertCurrent);
			assert.deepEqual(options.audioFallback, expectedSelector(featureId));
			return Object.freeze({
				assertCurrent(candidate: unknown) {
					events.push('admission-current');
					assert.strictEqual(candidate, canonical);
				},
				getVerifiedAudioChunkProvider(selector: ProjectAudioFallbackIntegritySelector) {
					events.push('provider');
					assert.deepEqual(selector, expectedSelector(featureId));
					return provider;
				},
			});
		},
	}, {
		signal: controller.signal,
		assertCurrent,
	});

	assert.strictEqual(admitted, provider);
	assert.deepEqual(events, [
		'task-current',
		'integrity',
		'admission-current',
		'provider',
		'task-current',
	]);
	assert.strictEqual(await admitted?.readStorageChunk(0, { signal: controller.signal }), channels);
});

test('audio fallback export selection rejects malformed or ambiguous delivery projections', () => {
	const canonical = canonicalProject();
	const valid = projectForAudioRenderedFallbackExport(
		canonical,
		createPlaybackProjectService({ audioEffects: false }),
	);
	const metadata = valid.audioRenderedFallback!;
	const malformed: readonly unknown[] = [
		null,
		{ ...valid, project: null },
		{ ...valid, requiredAudioSourceIds: FALLBACK_SOURCE_ID },
		{ ...valid, audioRenderedFallback: undefined },
		{ ...valid, audioRenderedFallback: null, requiredAudioSourceIds: [FALLBACK_SOURCE_ID] },
		{ ...valid, audioRenderedFallback: { ...metadata, schemaVersion: 2 } },
		{ ...valid, audioRenderedFallback: { ...metadata, role: 'project-video-render-v1' } },
		{ ...valid, audioRenderedFallback: {
			...metadata, featureId: PROJECT_FEATURE_CAPABILITY_IDS.videoEffects,
		} },
		{ ...valid, audioRenderedFallback: {
			...metadata, featureId: PROJECT_FEATURE_CAPABILITY_IDS.audioSpectralEditing,
		} },
		{ ...valid, requiredAudioSourceIds: ['some-other-source'] },
		{ ...valid, featureRequirementsReport: null },
	];
	for (const candidate of malformed) {
		assert.throws(
			() => projectForAudioRenderedFallbackExport(canonical, serviceReturning(candidate)),
			/invalid|unavailable|metadata|source|report|project/iu,
		);
	}

	const audioItem = valid.featureRequirementsReport!.items[0]!;
	const simultaneous = {
		...valid,
		featureRequirementsReport: {
			...valid.featureRequirementsReport!,
			items: [audioItem, {
				...audioItem,
				requirementId: 'publisher-video-render',
				featureId: PROJECT_FEATURE_CAPABILITY_IDS.videoEffects,
				fallback: {
					role: 'project-video-render-v1', kind: 'video',
					sourceId: 'fallback-video', sha256: 'ad'.repeat(32),
				},
			}],
		},
	};
	assert.throws(
		() => projectForAudioRenderedFallbackExport(canonical, serviceReturning(simultaneous)),
		/simultaneous|multiple|exactly one|ambiguous/iu,
	);
});

test('active audio fallback settings reject stems and BW64 or ADM before export work', () => {
	const projection = projectForAudioRenderedFallbackExport(
		canonicalProject(),
		createPlaybackProjectService({ audioEffects: false }),
	);
	assert.doesNotThrow(() => assertAudioRenderedFallbackExportSettings(
		projection,
		{ mode: 'mix', format: 'wav' },
	));

	for (const [name, settings, pattern] of [
		['unnormalized mode', { format: 'wav' }, /normalized|mix|mode/iu],
		['stems', { mode: 'stems', format: 'wav' }, /mix|stem/iu],
		['BW64', { mode: 'mix', format: 'bw64' }, /BW64|ADM/iu],
		['ADM', { mode: 'mix', format: 'wav', adm: { mode: 'authored' } }, /BW64|ADM/iu],
	] as const) {
		const events: string[] = [];
		assert.throws(() => {
			assertAudioRenderedFallbackExportSettings(projection, settings);
			events.push('integrity', 'plan', 'destination', 'render');
		}, pattern, name);
		assert.deepEqual(events, [], `${name} must fail before export work`);
	}
});

test('audio fallback integrity admission fails closed before exposing invalid media', async () => {
	const canonical = canonicalProject();
	const projection = projectForAudioRenderedFallbackExport(
		canonical,
		createPlaybackProjectService({ audioEffects: false }),
	);
	await assert.rejects(
		admitAudioRenderedFallbackExport(canonical, projection, { store: null }, { assertCurrent() {} }),
		/integrity.*unavailable|verification.*unavailable/iu,
	);
	await assert.rejects(
		admitAudioRenderedFallbackExport(canonical, projection, {
			store: null,
			verifyProjectFallbackIntegrity: () => Object.freeze({}) as never,
		}, { assertCurrent() {} }),
		/integrity.*invalid|admission.*invalid/iu,
	);
	await assert.rejects(
		admitAudioRenderedFallbackExport(canonical, projection, {
			store: null,
			verifyProjectFallbackIntegrity: () => Object.freeze({
				assertCurrent() {},
				getVerifiedAudioChunkProvider: () => Object.freeze({
					channelCount: 2,
					frameCount: 11,
					chunkFrames: 4,
					sampleRate: 48_000,
					async readStorageChunk() { return Object.freeze([Float32Array.of(0)]); },
				}),
			}),
		}, { assertCurrent() {} }),
		/invalid.*(?:audio|media|chunk|provider)|(?:audio|chunk|provider).*invalid/iu,
		'positive but mismatched provider geometry must be refused',
	);
	await assert.rejects(
		admitAudioRenderedFallbackExport(canonical, projection, {
			store: null,
			verifyProjectFallbackIntegrity: () => Object.freeze({
				assertCurrent() {},
				getVerifiedAudioChunkProvider: () => Object.freeze({
					channelCount: 0,
					frameCount: 12,
					chunkFrames: 4,
					sampleRate: 48_000,
					async readStorageChunk() { return Object.freeze([Float32Array.of(0)]); },
				}),
			}),
		}, { assertCurrent() {} }),
		/invalid.*(?:audio|media|chunk|provider)|(?:audio|chunk|provider).*invalid/iu,
	);

	let verificationCalls = 0;
	const stale = new DOMException('stale export', 'AbortError');
	await assert.rejects(
		admitAudioRenderedFallbackExport(canonical, projection, {
			store: null,
			verifyProjectFallbackIntegrity() {
				verificationCalls += 1;
				throw new Error('integrity should not start');
			},
		}, { assertCurrent() { throw stale; } }),
		(error: unknown) => error === stale,
	);
	assert.equal(verificationCalls, 0);

	const controller = new AbortController();
	const cancellation = new DOMException('export cancelled', 'AbortError');
	controller.abort(cancellation);
	await assert.rejects(
		admitAudioRenderedFallbackExport(canonical, projection, {
			store: null,
			verifyProjectFallbackIntegrity() {
				verificationCalls += 1;
				throw new Error('integrity should not start');
			},
		}, { signal: controller.signal, assertCurrent() {} }),
		(error: unknown) => error === cancellation,
	);
	assert.equal(verificationCalls, 0);
});

function canonicalProject(
	featureId: ProjectFeatureAudioCapabilityId = PROJECT_FEATURE_CAPABILITY_IDS.audioEffects,
) {
	const original = createAudioSourceV9({
		id: 'canonical-audio', storageKey: 'canonical-audio', frameCount: 8,
		channelCount: 2, sampleRate: 48_000,
	});
	const fallback = createAudioSourceV9({
		id: FALLBACK_SOURCE_ID, storageKey: FALLBACK_SOURCE_ID, frameCount: 12,
		channelCount: 2, sampleRate: 48_000, chunkFrames: 4,
	});
	const clip = createAudioClipV9({
		id: 'canonical-clip', sourceId: original.id, durationFrames: original.frameCount,
	});
	return createAudioEditorProjectV9({
		id: 'audio-fallback-export', now: '2026-08-02T12:00:00.000Z',
		sources: [original, fallback], clips: [clip],
		tracks: [createAudioTrackV9({ id: 'canonical-track', clipIds: [clip.id] })],
		featureRequirements: { schemaVersion: 1, requirements: [{
			id: 'publisher-audio-render',
			featureId,
			displayName: 'Publisher audio render',
			disposition: 'rendered-fallback',
			fallback: { kind: 'audio', sourceId: FALLBACK_SOURCE_ID, sha256: DIGEST },
		}] },
	});
}

function expectedSelector(
	featureId: ProjectFeatureAudioCapabilityId = PROJECT_FEATURE_CAPABILITY_IDS.audioEffects,
): ProjectAudioFallbackIntegritySelector {
	return Object.freeze({
		requirementId: 'publisher-audio-render',
		featureId,
		role: 'project-audio-mix-v1',
		kind: 'audio',
		sourceId: FALLBACK_SOURCE_ID,
		sha256: DIGEST,
	});
}

function serviceReturning(value: unknown) {
	return Object.freeze({
		projectForAudioRenderedFallbackDelivery<Project extends object>(
			_project: Project,
		): AudioRenderedFallbackDeliveryProjection<Project> {
			return value as AudioRenderedFallbackDeliveryProjection<Project>;
		},
	});
}
