/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
	createVideoSource,
	createVideoTrack,
} from '../src/common/editor/project-media-factory.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsV20,
} from '../src/framescaper/editor-project-feature-requirements-v20.ts';
import {
	createFramescaperPlaybackProjectServiceV20,
} from '../src/framescaper/editor-project-playback-v20.ts';
import {
	FRAMESCAPER_V20_PROJECT_MODEL_PROFILE,
} from '../src/framescaper/editor-project-v20-profile.ts';
import {
	createFramescaperProjectV20,
	validateFramescaperProjectV20,
} from '../src/framescaper/editor-project-v20.ts';
import { opacityKeyframes } from './helpers/framescaper-v20-model-fixture.ts';

const PROFILE = FRAMESCAPER_V20_PROJECT_MODEL_PROFILE;

test('V20 playback authenticates authority before observing options', () => {
	let reads = 0;
	const options = new Proxy({}, {
		get() { reads += 1; throw new Error('option get'); },
		ownKeys() { reads += 1; throw new Error('option keys'); },
		getOwnPropertyDescriptor() { reads += 1; throw new Error('option descriptor'); },
	});
	assert.throws(
		() => createFramescaperPlaybackProjectServiceV20({}, options),
		/exact Framescaper V20/iu,
	);
	assert.equal(reads, 0);
});

test('V20 playback preserves detached keyframes and reports selected capability', () => {
	const project = projectFixture();
	const service = createFramescaperPlaybackProjectServiceV20(PROFILE);
	assert.ok(service.projectForActivationAdmission);
	const admission = service.projectForActivationAdmission(project);
	assert.equal(admission.project, project);
	assert.equal(admission.featureRequirementsReport?.compatible, true);
	assert.equal(admission.featureRequirementsReport?.items.at(-1)?.availability, 'available');
	const projection = service.projectForPlayback(project);
	assert.equal((projection.project as { schemaVersion: number }).schemaVersion, 17);
	const clip = ((projection.project as { clips?: readonly Record<string, unknown>[] }).clips ?? [])[0]!;
	assert.deepEqual(clip.videoKeyframes, project.clips[0]!.videoKeyframes);
	assert.notStrictEqual(clip.videoKeyframes, project.clips[0]!.videoKeyframes);
	assert.equal(projection.featureRequirementsReport?.items.at(-1)?.availability, 'available');
	assert.deepEqual(projection.requiredVideoSourceIds, []);
});

test('V20 playback leaves prior and future schema documents opaque', () => {
	const service = createFramescaperPlaybackProjectServiceV20(PROFILE);
	for (const project of [
		{ schemaVersion: 19, marker: 'prior' },
		{ schemaVersion: 21, marker: 'future' },
	]) {
		const projection = service.projectForPlayback(project);
		assert.equal(projection.project, project);
		assert.equal(projection.featureRequirementsReport, null);
	}
});

test('V20 playback inherits exact rendered-fallback projection and source admission', () => {
	const project = audioFallbackProject();
	const service = createFramescaperPlaybackProjectServiceV20(PROFILE);
	const admission = service.projectForActivationAdmission?.(project);
	const playback = service.projectForPlayback(project);

	assert.equal(admission?.project, project);
	assert.equal(admission?.audioRenderedFallback?.sourceId, 'fallback-source');
	assert.deepEqual(admission?.requiredAudioSourceIds, ['fallback-source']);
	assert.equal((playback.project as { schemaVersion: number }).schemaVersion, 17);
	assert.equal(playback.audioRenderedFallback?.sourceId, 'fallback-source');
	assert.deepEqual(playback.requiredAudioSourceIds, ['fallback-source']);
	assert.ok((playback.project as unknown as { clips: readonly { sourceId: string }[] }).clips
		.some(({ sourceId }) => sourceId === 'fallback-source'));
	assert.equal((project.clips[0] as Readonly<Record<string, unknown>> | undefined)?.sourceId, 'original-source');
});

test('V20 playback inherits control-free audio-effect bypass projection', () => {
	const project = audioBypassProject();
	const service = createFramescaperPlaybackProjectServiceV20(PROFILE);
	const admission = service.projectForActivationAdmission?.(project);
	const playback = service.projectForPlayback(project);

	assert.equal(admission?.audioEffectPlaybackBypass?.placeholders[0]?.effectId, 'invert');
	assert.equal(playback.audioEffectPlaybackBypass?.placeholders[0]?.effectId, 'invert');
	const track = (playback.project as unknown as {
		tracks: readonly { effects: readonly { bypassed?: boolean; params: unknown }[] }[];
	}).tracks[0]!;
	assert.equal(track.effects[0]?.bypassed, true);
	assert.deepEqual(track.effects[0]?.params, {});
	assert.equal((project.tracks[0] as Readonly<{
		effects: readonly { bypassed?: boolean }[];
	}> | undefined)?.effects[0]?.bypassed, false);
});

function projectFixture(): ReturnType<typeof createFramescaperProjectV20> {
	const project = createFramescaperProjectV20(PROFILE, {
		id: 'playback-v20', title: 'Playback V20', now: '2026-08-13T12:00:00.000Z',
		sources: [createVideoSource({
			id: 'source', name: 'Video', storageKey: 'source', mimeType: 'video/mp4',
			contentSha256: '12'.repeat(32), frameCount: 48_000, sampleFrameCount: 48_000,
			sourceFrameCount: 30, frameRate: { num: 30, den: 1 }, width: 1_920, height: 1_080,
		})],
		clips: [{
			kind: 'video', id: 'clip', sourceId: 'source', title: 'Video', sequenceId: 'main',
			sequenceStartFrame: 0, sequenceFrameCount: 30, sourceInFrame: 0,
			sourceFrameCount: 30, retimeMap: null,
		}],
		tracks: [createVideoTrack({ id: 'track', name: 'Video', clipIds: ['clip'], locked: false })],
		sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: ['track'] }],
		primarySequenceId: 'main',
	});
	(project.clips[0] as unknown as Record<string, unknown>).videoKeyframes = opacityKeyframes(30);
	(project as unknown as Record<string, unknown>).featureRequirements =
		reconcileFramescaperProjectFeatureRequirementsV20(PROFILE, project);
	validateFramescaperProjectV20(PROFILE, project);
	return project;
}

function audioFallbackProject(): ReturnType<typeof createFramescaperProjectV20> {
	const original = {
		...createAudioSource({
			id: 'original-source', storageKey: 'original-source', frameCount: 4,
			channelCount: 2, sampleRate: 48_000,
		}),
		contentSha256: '12'.repeat(32),
	};
	const fallback = {
		...createAudioSource({
			id: 'fallback-source', storageKey: 'fallback-source', frameCount: 6,
			channelCount: 2, sampleRate: 48_000,
		}),
		contentSha256: '34'.repeat(32),
	};
	const clip = createAudioClip({
		id: 'original-clip', sourceId: original.id, durationFrames: original.frameCount,
	});
	return createFramescaperProjectV20(PROFILE, {
		id: 'fallback-v20',
		title: 'Fallback V20',
		now: '2026-08-13T12:00:00.000Z',
		sources: [original, fallback],
		clips: [clip],
		tracks: [createAudioTrack({ id: 'track', name: 'Audio', clipIds: [clip.id] })],
		featureRequirements: { schemaVersion: 2, requirements: [{
			id: 'publisher-render',
			featureId: 'org.example.future-mixer',
			displayName: 'Future mixer',
			disposition: 'rendered-fallback',
			fallback: {
				role: 'project-audio-mix-v1', kind: 'audio',
				sourceId: fallback.id, sha256: fallback.contentSha256,
			},
		}] },
	});
}

function audioBypassProject(): ReturnType<typeof createFramescaperProjectV20> {
	const source = createAudioSource({
		id: 'source', storageKey: 'source', frameCount: 4,
		channelCount: 2, sampleRate: 48_000,
	});
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: source.frameCount });
	const track = {
		...createAudioTrack({ id: 'track', name: 'Audio', clipIds: [clip.id] }),
		effectsActive: true,
		effects: [{
			id: 'invert', type: 'audacity-invert', enabled: true, bypassed: false, params: { amount: 1 },
		}],
	};
	return createFramescaperProjectV20(PROFILE, {
		id: 'bypass-v20',
		title: 'Bypass V20',
		now: '2026-08-13T12:00:00.000Z',
		sources: [source],
		clips: [clip],
		tracks: [track],
		featureRequirements: { schemaVersion: 2, requirements: [{
			id: 'publisher-audio-effects',
			featureId: 'org.soundscaper.capability.audio-effects',
			displayName: 'Audio effects',
			disposition: 'bypass',
			fallback: null,
		}] },
	});
}
