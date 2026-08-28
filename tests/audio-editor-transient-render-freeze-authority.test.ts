/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { computeAudioTrackFreezeDigestsV1 } from '../src/common/editor/audio-track-freeze-v21.ts';
import {
	createIsolatedTrackRenderProjectV21,
} from '../src/common/editor/controller/isolated-track-render-project-v21.ts';
import { createMixRenderSnapshot } from '../src/common/editor/controller/mix-render-model.ts';
import type { ControllerProject, ControllerTrack } from '../src/common/editor/controller/track-domain-types.ts';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import type { ProjectFeatureRequirementsManifest } from '../src/common/editor/project-feature-requirements.ts';
import { reconcileProjectOwnedFeatureRequirements } from '../src/common/editor/project-owned-feature-requirements.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';

const NOW = '2026-08-20T12:00:00.000Z';
const PUBLISHER_REQUIREMENT = Object.freeze({
	id: 'publisher.spatializer',
	featureId: 'org.publisher.spatializer',
	displayName: 'Publisher spatializer',
	disposition: 'bypass' as const,
	fallback: null,
});
const PUBLISHER_REQUIREMENT_BYTES = JSON.stringify([PUBLISHER_REQUIREMENT]);

test('a V21 mix snapshot removes retained and dropped freeze authority without losing publisher requirements', () => {
	const project = frozenProject();
	const voice = project.tracks.find(({ id }) => id === 'voice') as unknown as ControllerTrack;
	const snapshot = createMixRenderSnapshot(
		project as unknown as ControllerProject,
		[voice],
	);

	assert.deepEqual(snapshot.tracks.map(({ id }) => id), ['voice']);
	assertTransientRenderRequirements(snapshot);
	assert.equal(Object.hasOwn(project.tracks.find(({ id }) => id === 'voice')!, 'audioFreeze'), true);
	assert.equal(Object.hasOwn(project.tracks.find(({ id }) => id === 'music')!, 'audioFreeze'), true);
});

test('an isolated V21 render removes retained and dropped freeze authority without losing publisher requirements', () => {
	const project = frozenProject();
	const snapshot = createIsolatedTrackRenderProjectV21(project as never, {
		trackId: 'voice', effects: [], clipIds: null,
	});

	assert.deepEqual(snapshot.tracks.map(({ id }) => id), ['voice']);
	assertTransientRenderRequirements(snapshot);
	assert.equal(Object.hasOwn(project.tracks.find(({ id }) => id === 'voice')!, 'audioFreeze'), true);
	assert.equal(Object.hasOwn(project.tracks.find(({ id }) => id === 'music')!, 'audioFreeze'), true);
});

function assertTransientRenderRequirements(project: Readonly<Record<string, unknown>>): void {
	const tracks = project.tracks as readonly Readonly<Record<string, unknown>>[];
	assert.equal(tracks.some((track) => Object.hasOwn(track, 'audioFreeze')), false);
	const manifest = project.featureRequirements as ProjectFeatureRequirementsManifest;
	assert.deepEqual(manifest.requirements.filter(({ featureId }) => (
		featureId === PROJECT_FEATURE_CAPABILITY_IDS.audioTrackFreeze
	)), []);
	assert.equal(JSON.stringify(manifest.requirements.filter(({ id }) => (
		id === PUBLISHER_REQUIREMENT.id
	))), PUBLISHER_REQUIREMENT_BYTES);
	assert.strictEqual(reconcileProjectOwnedFeatureRequirements(project, manifest), manifest);
}

function frozenProject() {
	const automationLanes = [] as const;
	const voice = frozenTrack('voice', automationLanes);
	const music = frozenTrack('music', automationLanes);
	return createSoundscaperProject({
		id: 'transient-render-freeze', title: 'Transient render freeze', now: NOW,
		sources: [...voice.sources, ...music.sources],
		clips: [voice.clip, music.clip],
		tracks: [voice.track, music.track],
		trackFolders: [{ id: 'stems', name: 'Stems' }],
		sequences: [{
			id: 'main-sequence',
			trackNodes: [
				{ kind: 'folder', id: 'stems', parentFolderId: null },
				{ kind: 'track', id: 'voice', parentFolderId: 'stems' },
				{ kind: 'track', id: 'music', parentFolderId: null },
			],
		}],
		primarySequenceId: 'main-sequence',
		automationLanes,
		featureRequirements: { schemaVersion: 2, requirements: [PUBLISHER_REQUIREMENT] },
	});
}

function frozenTrack(id: string, automationLanes: readonly unknown[]) {
	const liveSource = createAudioSource({
		id: `${id}-source`, name: `${id} source`, storageKey: `pcm:${id}`,
		contentSha256: digest(id === 'voice' ? 'a' : 'b'), frameCount: 8, channelCount: 1,
		sampleRate: 48_000, originalSampleRate: 48_000, sampleFormat: 'float32', chunkFrames: 65_536,
	});
	const derivedSource = createAudioSource({
		id: `${id}-freeze`, name: `${id} freeze`, storageKey: `derived:${id}`,
		contentSha256: digest(id === 'voice' ? 'c' : 'd'), frameCount: 8, channelCount: 1,
		sampleRate: 48_000, originalSampleRate: 48_000, sampleFormat: 'float32', chunkFrames: 65_536,
	});
	const clip = createAudioClip({
		id: `${id}-clip`, sourceId: liveSource.id, title: id,
		timelineStartFrame: 0, durationFrames: 8, sourceStartFrame: 0, sourceDurationFrames: 8,
	});
	const effect = {
		id: `${id}-filter`, type: 'highpass', enabled: true,
		params: { frequency: 200, q: 1 },
	};
	const editableTrack = createAudioTrack({
		id, name: id, clipIds: [clip.id], effects: [effect],
	});
	const freezeDigests = computeAudioTrackFreezeDigestsV1({
		sampleRate: 48_000, renderStartFrame: 0, renderFrameCount: 8,
		track: editableTrack, clips: [clip],
		sourceContentIdentities: [{ sourceId: liveSource.id, contentSha256: liveSource.contentSha256! }],
		automationLanes, tempoMap: null,
	});
	const track = createAudioTrack({
		id, name: id, clipIds: [clip.id], effects: [effect],
		audioFreeze: {
			schemaVersion: 1, derivedSourceId: derivedSource.id, ...freezeDigests,
			renderStartFrame: 0, renderFrameCount: 8, capturePosition: 'post-insert-pre-strip',
		},
	});
	return { sources: [liveSource, derivedSource], clip, track };
}

function digest(character: string): string {
	return character.repeat(64);
}
