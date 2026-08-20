/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createCurrentAudioEditorProject,
} from '../src/common/editor/project-current.ts';

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
	createAudioTrack,
	createVideoClip,
	createVideoSource,
	createVideoTrack,
} from '../src/common/editor/project-media-factory.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';

const EMPTY_MANIFEST = Object.freeze({ schemaVersion: 2 as const, requirements: Object.freeze([]) });

interface MutableRackProject {
	readonly tracks: Array<{ effects: unknown[] }>;
	readonly master: { effects: unknown[] };
}

interface MutableVideoEffectProject {
	readonly clips: Array<{ videoEffects: unknown[] }>;
}

function audioTrackWithEffect(id = 'effect-a') {
	return createAudioTrack({
		id: 'track-a',
		name: 'Track A',
		effects: [createEffect('compressor', { id })],
	});
}

function videoSource() {
	return createVideoSource({
		id: 'video-source',
		frameCount: 1,
		width: 16,
		height: 16,
		frameRate: 30,
		videoCodec: 'vp9',
	});
}

function videoClipWithEffect(id = 'video-effect-a', enabled = true) {
	return createVideoClip({
		id: 'video-clip',
		sourceId: 'video-source',
		durationFrames: 1,
		sourceDurationFrames: 1,
		videoEffects: [createVideoEffect('pixelate', { id, enabled })],
	});
}

test('owned audio-effect requirements follow maintained rack state across create and commit', () => {
	const project = createCurrentAudioEditorProject({ tracks: [audioTrackWithEffect()] });
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

test('owned video-effect requirements follow maintained timeline state across create and commit', () => {
	const project = createCurrentAudioEditorProject({
		sources: [videoSource()],
		clips: [videoClipWithEffect()],
		tracks: [createVideoTrack({ id: 'video-track', clipIds: ['video-clip'] })],
	});
	assert.deepEqual(project.featureRequirements.requirements, [{
		id: PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.videoEffects,
		featureId: PROJECT_FEATURE_CAPABILITY_IDS.videoEffects,
		displayName: 'Video effects',
		disposition: 'bypass',
		fallback: null,
	}]);

	const removed = commitProject(project, (draft: MutableVideoEffectProject) => {
		draft.clips[0]!.videoEffects = [];
	}) as unknown as typeof project;
	assert.deepEqual(removed.featureRequirements.requirements, []);

	const restored = commitProject(removed, (draft: MutableVideoEffectProject) => {
		draft.clips[0]!.videoEffects = [createVideoEffect('glow', { id: 'restored-video-effect' })];
	}) as unknown as typeof project;
	assert.deepEqual(restored.featureRequirements.requirements.map(({ id }) => id), [
		PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.videoEffects,
	]);
});

test('disabled and Project Bin video effects still declare the owned preservation requirement', () => {
	for (const project of [createCurrentAudioEditorProject({
		sources: [videoSource()],
		clips: [videoClipWithEffect('disabled-video-effect', false)],
		tracks: [createVideoTrack({ id: 'video-track', clipIds: ['video-clip'] })],
	}), createCurrentAudioEditorProject({
		sources: [videoSource()],
		projectBin: { clips: [videoClipWithEffect('bin-video-effect')] },
	})]) {
		assert.equal(
			project.featureRequirements.requirements[0]?.featureId,
			PROJECT_FEATURE_CAPABILITY_IDS.videoEffects,
		);
	}
});

test('audio and video ownership reconcile independently while foreign video state stays inert', () => {
	const project = createCurrentAudioEditorProject({
		sources: [videoSource()],
		clips: [videoClipWithEffect()],
		tracks: [
			audioTrackWithEffect(),
			createVideoTrack({ id: 'video-track', clipIds: ['video-clip'] }),
		],
	});
	assert.deepEqual(project.featureRequirements.requirements.map(({ id }) => id), [
		PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.audioEffects,
		PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.videoEffects,
	]);

	const inert = reconcileProjectOwnedFeatureRequirements({
		clips: [{
			kind: 'audio',
			videoEffects: [createVideoEffect('pixelate', { id: 'forged-audio-video-effect' })],
		}, {
			kind: 'video',
			videoEffects: [{ id: 'foreign-video-effect', type: 'org.example.foreign' }],
		}],
	}, EMPTY_MANIFEST);
	assert.strictEqual(inert, EMPTY_MANIFEST);
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
		const created = createCurrentAudioEditorProject(project);
		assert.equal(created.featureRequirements.requirements[0]?.featureId, PROJECT_FEATURE_CAPABILITY_IDS.audioEffects);
	}

	const missing = createCurrentAudioEditorProject({
		tracks: [createAudioTrack({
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
		fallback: {
			role: 'project-audio-mix-v1' as const,
			kind: 'audio' as const,
			sourceId: 'rendered-source',
			sha256: 'ab'.repeat(32),
		},
	};
	const source = {
		id: 'rendered-source', name: 'Render', mimeType: 'audio/wav', storageKey: 'rendered-source',
		frameCount: 1, channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: 65_536, opaqueExtensions: {},
	};
	const project = createCurrentAudioEditorProject({
		sources: [source],
		tracks: [audioTrackWithEffect()],
		featureRequirements: { schemaVersion: 2, requirements: [explicit] },
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
		{ schemaVersion: 2, requirements: Object.freeze([owned, explicit]) },
	);
	assert.deepEqual(reconciled.requirements, [explicit]);
});

test('explicit video-effect requirements win without being overwritten or duplicated', () => {
	const explicit = {
		id: 'publisher-video-bypass',
		featureId: PROJECT_FEATURE_CAPABILITY_IDS.videoEffects,
		displayName: 'Publisher video effects',
		disposition: 'bypass' as const,
		fallback: null,
	};
	const project = createCurrentAudioEditorProject({
		sources: [videoSource()],
		clips: [videoClipWithEffect()],
		tracks: [createVideoTrack({ id: 'video-track', clipIds: ['video-clip'] })],
		featureRequirements: { schemaVersion: 1, requirements: [explicit] },
	});
	assert.deepEqual(project.featureRequirements.requirements, [explicit]);
});

test('the reserved owned ID fails closed on a conflicting publisher declaration', () => {
	for (const [id, project] of [[
		PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.audioEffects,
		{ tracks: [audioTrackWithEffect()] },
	], [
		PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.videoEffects,
		{ clips: [videoClipWithEffect()] },
	]] as const) {
		assert.throws(() => reconcileProjectOwnedFeatureRequirements(project, {
			...EMPTY_MANIFEST,
			requirements: [{
				id,
				featureId: 'org.example.conflict',
				displayName: 'Conflicting requirement',
				disposition: 'bypass',
				fallback: null,
			}],
		}), /reserved.*(?:audio|video).*requirement|owned.*requirement.*conflict/iu);
	}
});
