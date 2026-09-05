/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	computeAudioTrackFreezeDigestsV1,
	type AudioTrackFreezeV1,
} from '../src/common/editor/audio-track-freeze-v21.ts';
import type {
	ProjectFeatureRequirementsManifest,
} from '../src/common/editor/project-feature-requirements.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import {
	reconcileSoundscaperProjectFeatureRequirements,
	validateSoundscaperProjectFeatureRequirements,
	SOUNDSCAPER_AUDIO_TRACK_FREEZE_REQUIREMENT_ID_PREFIX,
} from '../src/soundscaper/editor-project-feature-requirements.ts';
import {
	SOUNDSCAPER_NATIVE_PLUGIN_REQUIREMENT_PREFIX,
} from '../src/soundscaper/editor-native-plugin-playback.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';

const LIVE_DIGEST = 'ab'.repeat(32);
const DERIVED_DIGEST = 'cd'.repeat(32);
const NOW = '2026-09-05T09:00:00.000Z';

test('a frozen track and a hosted native plug-in reconcile to a manifest that validates', () => {
	const frozen = installFreeze(fixture().project);
	// Both reconcilers append their own rows, so the canonical manifest is
	// [...common, ...freeze, ...native]; validation has to accept exactly that.
	const hosted = { ...frozen, nativePluginStates: [state()] } as Readonly<Record<string, unknown>>;
	const manifest = reconcileSoundscaperProjectFeatureRequirements(
		hosted,
		hosted.featureRequirements as ProjectFeatureRequirementsManifest,
	);
	const document = { ...hosted, featureRequirements: manifest };

	assert.equal(validateSoundscaperProjectFeatureRequirements(document), true);
	assert.deepEqual(prefixes(manifest), [
		SOUNDSCAPER_AUDIO_TRACK_FREEZE_REQUIREMENT_ID_PREFIX,
		SOUNDSCAPER_NATIVE_PLUGIN_REQUIREMENT_PREFIX,
	]);
});

test('a native plug-in can be bound into a project that already owns a frozen track', () => {
	const frozen = installFreeze(fixture().project);
	const bound = applySoundscaperProjectCommand(frozen, binding(), { now: NOW });

	assert.equal(validateSoundscaperProject(bound), true);
	assert.deepEqual(prefixes(bound.featureRequirements), [
		SOUNDSCAPER_AUDIO_TRACK_FREEZE_REQUIREMENT_ID_PREFIX,
		SOUNDSCAPER_NATIVE_PLUGIN_REQUIREMENT_PREFIX,
	]);
});

test('a track can be frozen in a project that already hosts a native plug-in', () => {
	const bound = applySoundscaperProjectCommand(fixture().project, binding(), { now: NOW });
	const frozen = installFreeze(bound);

	assert.equal(validateSoundscaperProject(frozen), true);
	assert.deepEqual(prefixes(frozen.featureRequirements), [
		SOUNDSCAPER_AUDIO_TRACK_FREEZE_REQUIREMENT_ID_PREFIX,
		SOUNDSCAPER_NATIVE_PLUGIN_REQUIREMENT_PREFIX,
	]);
});

function prefixes(manifestValue: unknown): readonly string[] {
	const manifest = manifestValue as ProjectFeatureRequirementsManifest;
	return manifest.requirements.flatMap(({ id }) => {
		if (id.startsWith(SOUNDSCAPER_AUDIO_TRACK_FREEZE_REQUIREMENT_ID_PREFIX)) {
			return [SOUNDSCAPER_AUDIO_TRACK_FREEZE_REQUIREMENT_ID_PREFIX];
		}
		if (id.startsWith(SOUNDSCAPER_NATIVE_PLUGIN_REQUIREMENT_PREFIX)) {
			return [SOUNDSCAPER_NATIVE_PLUGIN_REQUIREMENT_PREFIX];
		}
		return [];
	}).sort();
}

function installFreeze(project: ReturnType<typeof createSoundscaperProject>) {
	const { freeze, derivedSource, sourceContentIdentities } = fixture();
	return applySoundscaperProjectCommand(project, {
		type: 'audio-freeze/install',
		trackId: 'voice', expectedFreeze: null, replacementFreeze: freeze, derivedSource,
		sourceContentIdentities,
	} as never, { now: NOW });
}

function binding() {
	return {
		type: 'native-plugin/bind', operation: 'author', trackId: 'track-1',
		effect: {
			id: 'native-effect-1', type: 'native-plugin', enabled: true, bypassed: false,
			params: { instanceId: 'native-instance-1', latencyFrames: 128 },
			context: {
				format: 'clap', stablePluginId: 'org.example.effect', binarySha256: 'b'.repeat(64),
			},
		},
		state: state(),
	} as never;
}

function state() {
	const sha256 = 'c'.repeat(64);
	return {
		instanceId: 'native-instance-1', format: 'clap', stablePluginId: 'org.example.effect',
		binarySha256: 'b'.repeat(64),
		stateBody: {
			kind: 'native-plugin-state' as const,
			bodyId: `native-plugin-state:${sha256}`,
			byteLength: 1,
			sha256,
		},
		enabled: true, bypassed: false, continuity: 'live' as const, latencySamples: 128,
	};
}

function fixture() {
	const liveSource = createAudioSource({
		id: 'voice-live', storageKey: 'pcm:voice-live', frameCount: 512,
		channelCount: 2, sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: 65_536, contentSha256: LIVE_DIGEST,
	});
	const liveClip = createAudioClip({
		id: 'voice-clip', sourceId: 'voice-live', title: 'Voice', timelineStartFrame: 0,
		durationFrames: 512, sourceStartFrame: 0, sourceDurationFrames: 512,
	});
	const voiceTrack = createAudioTrack({
		id: 'voice', name: 'Voice', gain: 0.8, pan: -0.2, clipIds: ['voice-clip'],
	});
	const hostTrack = createAudioTrack({ id: 'track-1', name: 'Track', clipIds: [] });
	const project = createSoundscaperProject({
		id: 'freeze-native-project', title: 'Freeze and native project', now: NOW,
		sources: [liveSource], clips: [liveClip], tracks: [voiceTrack, hostTrack],
		sequences: [{ id: 'main-sequence', trackIds: ['voice', 'track-1'] }],
		primarySequenceId: 'main-sequence',
	} as never);
	const sourceContentIdentities = Object.freeze([
		Object.freeze({ sourceId: 'voice-live', contentSha256: LIVE_DIGEST }),
	]);
	const digests = computeAudioTrackFreezeDigestsV1({
		sampleRate: project.sampleRate,
		renderStartFrame: 0,
		renderFrameCount: 1_024,
		track: project.tracks[0],
		clips: project.clips,
		sourceContentIdentities,
		automationLanes: project.automationLanes,
		tempoMap: project.tempoMap ?? null,
	});
	const freeze: AudioTrackFreezeV1 = {
		schemaVersion: 1, derivedSourceId: 'voice-freeze', ...digests,
		renderStartFrame: 0, renderFrameCount: 1_024,
		capturePosition: 'post-insert-pre-strip',
	};
	const derivedSource = createAudioSource({
		id: 'voice-freeze', storageKey: 'derived:voice-freeze', contentSha256: DERIVED_DIGEST,
		frameCount: 1_024, channelCount: 2, sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: 65_536,
	});
	return { project, freeze, derivedSource, sourceContentIdentities };
}
