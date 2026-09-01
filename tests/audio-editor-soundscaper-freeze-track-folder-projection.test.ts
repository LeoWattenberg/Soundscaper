/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	computeAudioTrackFreezeDigestsV1,
	type AudioTrackFreezeV1,
} from '../src/common/editor/audio-track-freeze-v21.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import {
	isTrackFolderMediaStateProjectionV12,
	projectTrackFolderMediaStateV12,
} from '../src/common/editor/track-folder-media-runtime.ts';
import {
	createSoundscaperAudioTrackFreezePlaybackService,
} from '../src/soundscaper/editor-audio-track-freeze-playback.ts';
import { createSoundscaperPlaybackProjectService } from '../src/soundscaper/editor-project-playback.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';

/**
 * A frozen track inside a track folder must still project for playback and delivery.
 *
 * Folder media state is flattened onto the leaves by a transient projection that
 * marks itself with an enumerable field and records its trust privately, so no
 * caller can forge one. The freeze service rebuilds that projection to swap the
 * rendered clip in — and rebuilt it with a spread, which copies the enumerable
 * marker and leaves the private trust behind. What playback hands on is then a
 * document carrying a marker nothing trusts, and the next reader of it, the
 * engine's own `projectTrackFolderMediaStateV12`, refuses it outright.
 *
 * Both features are UI-reachable and neither gates on the other, so they met in
 * ordinary use: freezing a track that lives in a folder broke playback, audio
 * delivery, and video delivery at once, while the same project without a folder
 * was fine — which is why the freeze suite never saw it.
 */

const NOW = '2026-08-19T12:00:00.000Z';
const CONTENT_SHA256 = 'a'.repeat(64);
const DERIVED_SHA256 = 'b'.repeat(64);

test('a frozen track inside a folder still projects for playback and delivery', () => {
	const { project, freeze, derivedSource, trackId } = fixture();
	const playback = createSoundscaperAudioTrackFreezePlaybackService(
		createSoundscaperPlaybackProjectService(), pcmStore(),
	);
	const revoke = playback.admitVerifiedFreeze({
		project, trackId, freeze, derivedSource,
		sourceContentIdentities: [{ sourceId: 'voice-source', contentSha256: CONTENT_SHA256 }],
	});

	const projections = [
		playback.projectForPlayback(project),
		playback.projectForAudioRenderedFallbackDelivery(project),
		playback.projectForVideoRenderedFallbackDelivery(project),
	];
	for (const projection of projections) {
		// The rendered clip is what proves the freeze projection actually ran, so
		// this asserts about the rebuilt document rather than a pass-through.
		const clips = (projection.project as unknown as {
			clips: readonly Record<string, unknown>[];
		}).clips;
		assert.ok(
			clips.some((clip) => clip.sourceId === derivedSource.id),
			'the projection must substitute the frozen render',
		);
		assert.equal(
			isTrackFolderMediaStateProjectionV12(projection.project),
			true,
			'the rebuilt projection must carry the trust that goes with its marker',
		);
		// What the engine does with it on load, and the reason an untrusted
		// marker is not a private detail: it refuses the whole document.
		assert.doesNotThrow(() => projectTrackFolderMediaStateV12(projection.project));

		// The folder's own mute still reaches the leaf inside it, which is what
		// the projection exists to do and what the rebuild must not undo.
		const track = (projection.project as unknown as {
			tracks: readonly Record<string, unknown>[];
		}).tracks.find(({ id }) => id === trackId);
		assert.equal(track?.mute, true);
	}
	revoke();
	assert.equal(
		playback.projectForPlayback(project).requiredAudioSourceIds.includes(derivedSource.id),
		false,
	);
	playback.dispose();
});

function pcmStore() {
	// The projection under test reads no PCM; the service only needs a store that
	// satisfies its canonical-access contract.
	return {
		getSourceMetadata: () => null,
		readSourceChunks: () => { throw new Error('The projection must not read PCM.'); },
		openSourceReadSession: () => null,
	} as never;
}

function fixture() {
	const source = createAudioSource({
		id: 'voice-source', storageKey: 'pcm:voice', contentSha256: CONTENT_SHA256,
		frameCount: 8, channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: 65_536,
	});
	const derivedSource = createAudioSource({
		id: 'voice-freeze', storageKey: 'derived:voice-freeze', contentSha256: DERIVED_SHA256,
		frameCount: 8, channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: 65_536,
	});
	const clip = createAudioClip({
		id: 'voice-clip', sourceId: source.id, title: 'Voice', timelineStartFrame: 0,
		durationFrames: 8, sourceStartFrame: 0, sourceDurationFrames: 8,
	});
	const bare = createAudioTrack({ id: 'voice', name: 'Voice', clipIds: [clip.id], effects: [] });
	const digests = computeAudioTrackFreezeDigestsV1({
		sampleRate: 48_000,
		renderStartFrame: 0,
		renderFrameCount: 8,
		track: bare,
		clips: [clip],
		sourceContentIdentities: [{ sourceId: source.id, contentSha256: CONTENT_SHA256 }],
		automationLanes: [],
		tempoMap: null,
	});
	const freeze: AudioTrackFreezeV1 = {
		schemaVersion: 1,
		derivedSourceId: String(derivedSource.id),
		...digests,
		renderStartFrame: 0,
		renderFrameCount: 8,
		capturePosition: 'post-insert-pre-strip',
	};
	const track = createAudioTrack({
		id: 'voice', name: 'Voice', clipIds: [clip.id], effects: [], audioFreeze: freeze,
	});
	const options = {
		id: 'freeze-folder-project', title: 'Freeze inside a folder', now: NOW,
		sources: [source, derivedSource], clips: [clip], tracks: [track],
		trackFolders: [{ id: 'stems', name: 'Stems', mute: true }],
		sequences: [{
			id: 'main-sequence',
			trackNodes: [
				{ kind: 'folder', id: 'stems', parentFolderId: null },
				{ kind: 'track', id: 'voice', parentFolderId: 'stems' },
			],
		}],
		primarySequenceId: 'main-sequence',
	};
	const project = createSoundscaperProject(options);
	return { project, freeze, derivedSource, trackId: 'voice' };
}
