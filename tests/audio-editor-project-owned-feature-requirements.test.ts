/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEffect } from '../src/common/editor/effects.js';
import { commitProject } from '../src/common/editor/project.js';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import {
	PROJECT_OWNED_FEATURE_REQUIREMENT_IDS,
	reconcileProjectOwnedFeatureRequirements,
} from '../src/common/editor/project-owned-feature-requirements.ts';
import {
	createAudioEditorProjectV9,
	createAudioTrackV9,
} from '../src/common/editor/project-v9.ts';

const EMPTY_MANIFEST = Object.freeze({ schemaVersion: 1 as const, requirements: Object.freeze([]) });

interface MutableRackProject {
	readonly tracks: Array<{ effects: unknown[] }>;
	readonly master: { effects: unknown[] };
}

function audioTrackWithEffect(id = 'effect-a') {
	return createAudioTrackV9({
		id: 'track-a',
		name: 'Track A',
		effects: [createEffect('compressor', { id })],
	});
}

test('owned audio-effect requirements follow maintained rack state across create and commit', () => {
	const project = createAudioEditorProjectV9({ tracks: [audioTrackWithEffect()] });
	assert.deepEqual(project.featureRequirements.requirements, [{
		id: PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.audioEffects,
		featureId: PROJECT_FEATURE_CAPABILITY_IDS.audioEffects,
		displayName: 'Audio effects',
		disposition: 'bypass',
		fallback: null,
	}]);

	const removed = commitProject(project, (draft: MutableRackProject) => {
		draft.tracks[0]!.effects = [];
	}) as unknown as typeof project;
	assert.deepEqual(removed.featureRequirements.requirements, []);

	const restored = commitProject(removed, (draft: MutableRackProject) => {
		draft.master.effects = [createEffect('limiter', { id: 'master-effect' })];
	}) as unknown as typeof project;
	assert.deepEqual(restored.featureRequirements.requirements.map(({ id }) => id), [
		PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.audioEffects,
	]);
});

test('disabled and inactive maintained effects still declare preservation requirements, while missing effects do not', () => {
	for (const project of [{
		tracks: [{ ...audioTrackWithEffect(), effectsActive: false }],
	}, {
		tracks: [{ ...audioTrackWithEffect(), effects: [createEffect('delay', { id: 'disabled', enabled: false })] }],
	}, {
		mixer: { groups: [{ id: 'group-a', effects: [createEffect('eq', { id: 'group-effect' })] }], sends: [], routes: {} },
	}, {
		mixer: { groups: [], sends: [{ id: 'send-a', effects: [createEffect('reverb', { id: 'send-effect' })] }], routes: {} },
	}]) {
		const created = createAudioEditorProjectV9(project);
		assert.equal(created.featureRequirements.requirements[0]?.featureId, PROJECT_FEATURE_CAPABILITY_IDS.audioEffects);
	}

	const missing = createAudioEditorProjectV9({
		tracks: [createAudioTrackV9({
			id: 'missing-track',
			effects: [createEffect('missing', {
				id: 'missing-effect',
				missing: { name: 'Foreign effect', nativeId: 'foreign', reason: 'not-installed', source: 'aup4' },
			})],
		})],
	});
	assert.deepEqual(missing.featureRequirements.requirements, []);
});

test('explicit audio-effect requirements win without being overwritten or duplicated', () => {
	const explicit = {
		id: 'publisher-audio-render',
		featureId: PROJECT_FEATURE_CAPABILITY_IDS.audioEffects,
		displayName: 'Publisher audio render',
		disposition: 'rendered-fallback' as const,
		fallback: { kind: 'audio' as const, sourceId: 'rendered-source', sha256: 'ab'.repeat(32) },
	};
	const source = {
		id: 'rendered-source', name: 'Render', mimeType: 'audio/wav', storageKey: 'rendered-source',
		frameCount: 1, channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: 65_536, opaqueExtensions: {},
	};
	const project = createAudioEditorProjectV9({
		sources: [source],
		tracks: [audioTrackWithEffect()],
		featureRequirements: { schemaVersion: 1, requirements: [explicit] },
	});
	assert.deepEqual(project.featureRequirements.requirements, [explicit]);

	const owned = {
		id: PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.audioEffects,
		featureId: PROJECT_FEATURE_CAPABILITY_IDS.audioEffects,
		displayName: 'Audio effects',
		disposition: 'bypass' as const,
		fallback: null,
	};
	const reconciled = reconcileProjectOwnedFeatureRequirements(
		{ tracks: [audioTrackWithEffect()] },
		{ schemaVersion: 1, requirements: Object.freeze([owned, explicit]) },
	);
	assert.deepEqual(reconciled.requirements, [explicit]);
});

test('the reserved owned ID fails closed on a conflicting publisher declaration', () => {
	assert.throws(() => reconcileProjectOwnedFeatureRequirements(
		{ tracks: [audioTrackWithEffect()] },
		{
			...EMPTY_MANIFEST,
			requirements: [{
				id: PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.audioEffects,
				featureId: 'org.example.conflict',
				displayName: 'Conflicting requirement',
				disposition: 'bypass',
				fallback: null,
			}],
		},
	), /reserved.*audio.*requirement|owned.*requirement.*conflict/iu);
});
