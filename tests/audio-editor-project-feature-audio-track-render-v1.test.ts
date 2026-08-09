/* SPDX-License-Identifier: AGPL-3.0-only */

import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';

import assert from 'node:assert/strict';
import test from 'node:test';

import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import { projectFeatureAffectedObjects } from '../src/common/editor/project-feature-affected-objects.ts';
import { projectFeatureAudioRenderedFallbackPlayback } from '../src/common/editor/project-feature-audio-rendered-fallback.ts';
import { PROJECT_FEATURE_AUDIO_TRACK_RENDER_IDS } from '../src/common/editor/project-feature-audio-track-render-v1.ts';
import {
	captureProjectFallbackIntegrity,
	sameCapturedProjectFallbackIntegrity,
} from '../src/common/editor/project-fallback-integrity-snapshot.ts';
import {
	normalizeProjectFeatureRequirements,
	type ProjectFeatureRequirementsReport,
} from '../src/common/editor/project-feature-requirements.ts';
import {
	createAudioClipV9,
	createAudioSourceV9,
	createAudioTrackV9,
} from '../src/common/editor/project-v9.ts';

const AUDIO_EFFECTS = PROJECT_FEATURE_CAPABILITY_IDS.audioEffects;
const DIGEST = 'ab'.repeat(32);
const RESERVED_CLIP = PROJECT_FEATURE_AUDIO_TRACK_RENDER_IDS.clip;

function manifest(overrides: Record<string, unknown> = {}, fallbackOverrides: Record<string, unknown> = {}) {
	return {
		schemaVersion: 2,
		requirements: [{
			id: 'publisher-track-render',
			featureId: AUDIO_EFFECTS,
			displayName: 'Publisher track render',
			disposition: 'rendered-fallback',
			fallback: {
				role: 'audio-track-render-v1', kind: 'audio', sourceId: 'fallback-track-render',
				sha256: DIGEST, targetTrackId: 'fx-track',
				...fallbackOverrides,
			},
			...overrides,
		}],
	};
}

function fixture(requirements: unknown = manifest()) {
	const laneSource = createAudioSourceV9({
		id: 'lane-source', storageKey: 'lane-source', frameCount: 500, channelCount: 2,
	});
	const drySource = createAudioSourceV9({
		id: 'dry-source', storageKey: 'dry-source', frameCount: 300, channelCount: 2,
	});
	const fallbackSource = createAudioSourceV9({
		id: 'fallback-track-render', storageKey: 'fallback-track-render', frameCount: 500, channelCount: 2,
	});
	const laneClipA = createAudioClipV9({
		id: 'lane-clip-a', sourceId: laneSource.id, timelineStartFrame: 0, durationFrames: 200,
	});
	const laneClipB = createAudioClipV9({
		id: 'lane-clip-b', sourceId: laneSource.id, timelineStartFrame: 300, durationFrames: 200,
	});
	const dryClip = createAudioClipV9({
		id: 'dry-clip', sourceId: drySource.id, timelineStartFrame: 0, durationFrames: 300,
	});
	const project = createCurrentAudioEditorProject({
		id: 'track-fallback-project', now: '2026-08-08T10:00:00.000Z', sampleRate: 48_000,
		sources: [laneSource, drySource, fallbackSource],
		clips: [laneClipA, dryClip, laneClipB],
		tracks: [
			createAudioTrackV9({
				id: 'fx-track', name: 'Saturated lane', clipIds: [laneClipA.id, laneClipB.id],
				gain: 0.5, pan: -0.5,
				effects: [{ id: 'foreign-fx', type: 'com.example.saturator', enabled: true, params: {} }],
			}),
			createAudioTrackV9({ id: 'dry-track', name: 'Dry lane', clipIds: [dryClip.id] }),
		],
		featureRequirements: requirements,
	});
	const report: ProjectFeatureRequirementsReport = {
		schemaVersion: 1,
		format: 'soundscaper-project',
		compatible: false,
		counts: { available: 0, unavailable: 1, unknown: 0 },
		items: [{
			requirementId: 'publisher-track-render',
			featureId: AUDIO_EFFECTS,
			displayName: 'Publisher track render',
			availability: 'unavailable',
			declaredDisposition: 'rendered-fallback',
			disposition: 'rendered-fallback',
			fallback: {
				role: 'audio-track-render-v1', kind: 'audio', sourceId: 'fallback-track-render',
				sha256: DIGEST, targetTrackId: 'fx-track',
			},
			message: 'Audio effects are unavailable.',
		}],
	};
	return { project, report };
}

test('a track-local audio render replaces only its target lane in a transient projection', () => {
	const { project, report } = fixture();
	const before = structuredClone(project);
	const result = projectFeatureAudioRenderedFallbackPlayback(project, report);
	const projected = result.project as typeof project;

	assert.notStrictEqual(projected, project);
	assert.deepEqual(project, before, 'the canonical project must remain unchanged');
	assert.strictEqual(projected.sources, project.sources);
	assert.strictEqual(projected.mixer, project.mixer);
	assert.strictEqual(projected.master, project.master);
	assert.strictEqual(projected.projectBin, project.projectBin);
	assert.strictEqual(projected.tracks[1], project.tracks[1], 'the dry lane must stay canonical');
	assert.deepEqual(result.metadata, {
		schemaVersion: 1,
		role: 'audio-track-render-v1',
		featureId: AUDIO_EFFECTS,
		requirementId: 'publisher-track-render',
		sourceId: 'fallback-track-render',
		targetTrackId: 'fx-track',
		clipId: RESERVED_CLIP,
	});

	const target = projected.tracks[0] as Readonly<Record<string, unknown>>;
	assert.deepEqual(target.clipIds, [RESERVED_CLIP]);
	assert.equal(target.effectsActive, false);
	assert.deepEqual(target.effects, []);
	for (const key of ['id', 'name', 'gain', 'pan', 'mute', 'solo', 'envelope', 'color']) {
		assert.strictEqual(target[key], (project.tracks[0] as Readonly<Record<string, unknown>>)[key]);
	}

	const projectedClipIds = (projected.clips as ReadonlyArray<{ id: string }>).map((clip) => clip.id);
	assert.deepEqual(projectedClipIds, [RESERVED_CLIP, 'dry-clip']);
	assert.strictEqual(projected.clips[1], project.clips[1], 'the dry clip must stay canonical');
	const rendered = projected.clips[0] as Readonly<Record<string, unknown>>;
	assert.equal(rendered.sourceId, 'fallback-track-render');
	assert.equal(rendered.timelineStartFrame, 0);
	assert.equal(rendered.durationFrames, 500);
	assert.equal(rendered.kind, 'audio');
	assert.equal(Object.isFrozen(result), true);
	assert.equal(Object.isFrozen(result.metadata), true);
	assert.equal(Object.isFrozen(projected), true);
	assert.equal(Object.isFrozen(projected.tracks), true);
	assert.equal(Object.isFrozen(projected.clips), true);
});

test('track-render manifests reject targets that cannot carry the relationship', () => {
	const cases: ReadonlyArray<readonly [unknown, RegExp]> = [
		[manifest({ featureId: PROJECT_FEATURE_CAPABILITY_IDS.audioMixing }),
			/requires the maintained audio-effects feature/iu],
		[manifest({}, { targetTrackId: 'missing-track' }), /exactly one target track/iu],
		[manifest({}, { targetTrackId: 'dry-track' }), /at least one enabled audio effect/iu],
		[manifest({}, { kind: 'video' }), /does not match its kind/iu],
		[manifest({}, { targetClipId: 'lane-clip-a' }), /unsupported field/iu],
		[manifest({}, { sourceId: 'lane-source' }),
			/must differ from its target canonical sources|frameCount must equal/iu],
	];
	for (const [requirements, message] of cases) {
		assert.throws(() => fixture(requirements), message);
	}

	assert.throws(() => {
		const requirements = manifest();
		(requirements.requirements[0]!.fallback as Record<string, unknown>).sourceId = 'dry-source';
		fixture(requirements);
	}, /frameCount must equal the target track extent/iu);

	assert.throws(() => fixture({
		schemaVersion: 1,
		requirements: [{
			id: 'legacy', featureId: AUDIO_EFFECTS, displayName: 'Legacy',
			disposition: 'rendered-fallback',
			fallback: { kind: 'audio', sourceId: 'fallback-track-render', sha256: DIGEST, targetTrackId: 'fx-track' },
		}],
	}), /unsupported field/iu, 'a schema-1 manifest cannot express the track role');
});

test('an inert rack or an empty lane refuses the track-render relationship', () => {
	const { project } = fixture();
	const context = (tracks: readonly unknown[]) => ({
		sources: project.sources as readonly Readonly<Record<string, unknown>>[],
		clips: project.clips as readonly Readonly<Record<string, unknown>>[],
		tracks: tracks as readonly Readonly<Record<string, unknown>>[],
	});
	const canonical = project.tracks as ReadonlyArray<Record<string, unknown>>;
	assert.ok(normalizeProjectFeatureRequirements(manifest(), context(canonical)));

	assert.throws(
		() => normalizeProjectFeatureRequirements(
			manifest(),
			context([{ ...canonical[0], effectsActive: false }, canonical[1]]),
		),
		/active effect rack/iu,
	);
	assert.throws(
		() => normalizeProjectFeatureRequirements(
			manifest(),
			context([{ ...canonical[0], clipIds: [] }, canonical[1]]),
		),
		/at least one timeline clip/iu,
	);
	assert.throws(
		() => normalizeProjectFeatureRequirements(
			manifest(),
			context([{
				...canonical[0],
				effects: [{ id: 'foreign-fx', type: 'com.example.saturator', enabled: false, params: {} }],
			}, canonical[1]]),
		),
		/at least one enabled audio effect/iu,
	);
	assert.throws(
		() => normalizeProjectFeatureRequirements(manifest(), {
			...context(canonical),
			tracks: undefined,
		}),
		/exactly one target track/iu,
		'a caller that cannot supply tracks must fail closed for the track role',
	);
});

test('the projection rechecks source geometry and reserved identity', () => {
	const { project, report } = fixture();
	const cases: ReadonlyArray<readonly [Record<string, unknown>, RegExp]> = [
		[{ frameCount: 499 }, /frame count must equal the target track extent/iu],
		[{ sampleRate: 44_100 }, /sample rate must match the project sample rate/iu],
		[{ channelCount: 6 }, /mono or stereo, not surround/iu],
		[{ kind: 'video' }, /must be audio/iu],
	];
	for (const [changes, message] of cases) {
		const candidate = structuredClone(project) as Record<string, unknown>;
		const sources = candidate.sources as Array<Record<string, unknown>>;
		sources[2] = { ...sources[2], ...changes };
		assert.throws(() => projectFeatureAudioRenderedFallbackPlayback(candidate, report), message);
	}

	const collided = structuredClone(project) as Record<string, unknown>;
	(collided.clips as Array<Record<string, unknown>>).push({
		...(collided.clips as Array<Record<string, unknown>>)[1],
		id: RESERVED_CLIP,
	});
	assert.throws(
		() => projectFeatureAudioRenderedFallbackPlayback(collided, report),
		/reserved rendered-fallback clip ID collides/iu,
	);

	const admRouted = structuredClone(project) as Record<string, unknown>;
	(admRouted.metadata as Record<string, unknown>).adm = { profile: 'adm' };
	assert.throws(
		() => projectFeatureAudioRenderedFallbackPlayback(admRouted, report),
		/does not support ADM project routing/iu,
	);
});

test('the umbrella refuses ambiguity and manifest drift, and gates on availability', () => {
	const { project, report } = fixture();
	const item = report.items[0]!;
	assert.throws(
		() => projectFeatureAudioRenderedFallbackPlayback(project, {
			...report,
			items: [item, {
				...item,
				requirementId: 'publisher-whole-mix',
				fallback: {
					role: 'project-audio-mix-v1', kind: 'audio', sourceId: 'fallback-track-render', sha256: DIGEST,
				},
			}],
		}),
		/ambiguous/iu,
	);
	for (const fallback of [
		{ ...item.fallback!, targetTrackId: 'dry-track' },
		{ ...item.fallback!, sha256: '4d'.repeat(32) },
	]) {
		assert.throws(
			() => projectFeatureAudioRenderedFallbackPlayback(project, {
				...report,
				items: [{ ...item, fallback }],
			} as ProjectFeatureRequirementsReport),
			/does not match the project manifest/iu,
		);
	}

	const unknownAvailability = projectFeatureAudioRenderedFallbackPlayback(project, {
		...report,
		counts: { available: 0, unavailable: 0, unknown: 1 },
		items: [{ ...item, availability: 'unknown' }],
	});
	assert.strictEqual(unknownAvailability.project, project);
	assert.equal(unknownAvailability.metadata, null);

	const foreignFeature = projectFeatureAudioRenderedFallbackPlayback(project, {
		...report,
		items: [{ ...item, featureId: PROJECT_FEATURE_CAPABILITY_IDS.audioMixing }],
	});
	assert.strictEqual(foreignFeature.project, project);
	assert.equal(foreignFeature.metadata, null);
});

test('the integrity snapshot binds the target rack, lane, and claim identity', () => {
	const { project } = fixture();
	const captured = captureProjectFallbackIntegrity(project);
	assert.equal(captured.claims.length, 1);
	assert.deepEqual(captured.claims[0], {
		role: 'audio-track-render-v1', kind: 'audio', sourceId: 'fallback-track-render',
		sha256: DIGEST, targetTrackId: 'fx-track',
	});
	assert.equal(
		sameCapturedProjectFallbackIntegrity(captured, captureProjectFallbackIntegrity(structuredClone(project))),
		true,
	);

	// A manifest-preserving rack change must still change the admission identity.
	const rackGrew = structuredClone(project) as Record<string, unknown>;
	const grownTracks = rackGrew.tracks as Array<Record<string, unknown>>;
	grownTracks[0] = {
		...grownTracks[0],
		effects: [
			...(grownTracks[0]!.effects as readonly unknown[]),
			{ id: 'second-fx', type: 'compressor', enabled: false, params: {} },
		],
	};
	assert.equal(
		sameCapturedProjectFallbackIntegrity(captured, captureProjectFallbackIntegrity(rackGrew)),
		false,
		'a rack membership change must invalidate the admission identity',
	);

	const laneReordered = structuredClone(project) as Record<string, unknown>;
	const reorderedTracks = laneReordered.tracks as Array<Record<string, unknown>>;
	reorderedTracks[0] = {
		...reorderedTracks[0],
		clipIds: [...(reorderedTracks[0]!.clipIds as readonly string[])].reverse(),
	};
	assert.equal(
		sameCapturedProjectFallbackIntegrity(captured, captureProjectFallbackIntegrity(laneReordered)),
		false,
		'a lane membership change must invalidate the admission identity',
	);

	// A change that breaks the declared geometry fails capture itself; the
	// admission layer maps that throw to its admission-changed refusal.
	const laneMoved = structuredClone(project) as Record<string, unknown>;
	const movedClips = laneMoved.clips as Array<Record<string, unknown>>;
	movedClips[2] = { ...movedClips[2], timelineStartFrame: 250 };
	assert.throws(
		() => captureProjectFallbackIntegrity(laneMoved),
		/frameCount must equal the target track extent/iu,
	);
});

test('affected-object visibility names the replaced track and its lane clips only', () => {
	const { project, report } = fixture();
	const index = projectFeatureAffectedObjects(project, report);
	assert.ok(index);
	const [requirement] = index.requirements;
	assert.equal(requirement.attributable, true);
	assert.ok(requirement.objects.every((item) => item.channel === 'rendered-fallback-replaced'));
	assert.deepEqual(
		requirement.objects.map((item) => [item.scope, item.objectId]),
		[['track', 'fx-track'], ['clip', 'lane-clip-a'], ['clip', 'lane-clip-b']],
	);
	assert.ok(
		!requirement.objects.some((item) => item.objectId === 'dry-clip' || item.objectId === 'dry-track'),
		'untouched lanes must not be named',
	);
});
