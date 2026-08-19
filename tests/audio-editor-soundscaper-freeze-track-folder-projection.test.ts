/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	computeAudioTrackFreezeDigestsV1,
	type AudioTrackFreezeV1,
} from '../src/common/editor/audio-track-freeze-v21.ts';
import { createAudioClipV10, createAudioSourceV10, createAudioTrackV10 } from '../src/common/editor/project-v10.ts';
import {
	isTrackFolderMediaStateProjectionV12,
	projectTrackFolderMediaStateV12,
} from '../src/common/editor/track-folder-media-runtime.ts';
import {
	createSoundscaperAudioTrackFreezePlaybackServiceV21,
} from '../src/soundscaper/editor-audio-track-freeze-playback-v21.ts';
import {
	createSoundscaperAudioTrackFreezePlaybackServiceV23,
} from '../src/soundscaper/editor-audio-track-freeze-playback-v23.ts';
import { createSoundscaperPlaybackProjectServiceV21 } from '../src/soundscaper/editor-project-playback-v21.ts';
import { createSoundscaperPlaybackProjectServiceV23 } from '../src/soundscaper/editor-project-playback-v23.ts';
import { createSoundscaperProjectV21 } from '../src/soundscaper/editor-project-v21.ts';
import { createSoundscaperProjectV23 } from '../src/soundscaper/editor-project-v23.ts';

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

for (const revision of ['V21', 'V23'] as const) {
	test(`a frozen track inside a folder still projects for ${revision} playback and delivery`, () => {
		const { project, freeze, derivedSource, trackId } = fixture(revision);
		const playback = revision === 'V21'
			? createSoundscaperAudioTrackFreezePlaybackServiceV21(
				createSoundscaperPlaybackProjectServiceV21(), pcmStore(),
			)
			: createSoundscaperAudioTrackFreezePlaybackServiceV23(
				createSoundscaperPlaybackProjectServiceV23(), pcmStore(),
			);
		playback.admitVerifiedFreeze({
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
	});
}

function pcmStore() {
	// The projection under test reads no PCM; the service only needs a store that
	// satisfies its canonical-access contract.
	return {
		getSourceMetadata: () => null,
		readSourceChunks: () => { throw new Error('The projection must not read PCM.'); },
		openSourceReadSession: () => null,
	} as never;
}

function fixture(revision: 'V21' | 'V23') {
	const source = createAudioSourceV10({
		id: 'voice-source', storageKey: 'pcm:voice', contentSha256: CONTENT_SHA256,
		frameCount: 8, channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: 65_536,
	});
	const derivedSource = createAudioSourceV10({
		id: 'voice-freeze', storageKey: 'derived:voice-freeze', contentSha256: DERIVED_SHA256,
		frameCount: 8, channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: 65_536,
	});
	const clip = createAudioClipV10({
		id: 'voice-clip', sourceId: source.id, title: 'Voice', timelineStartFrame: 0,
		durationFrames: 8, sourceStartFrame: 0, sourceDurationFrames: 8,
	});
	const bare = createAudioTrackV10({ id: 'voice', name: 'Voice', clipIds: [clip.id], effects: [] });
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
	const track = createAudioTrackV10({
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
	const project = revision === 'V21'
		? createSoundscaperProjectV21(options)
		: createSoundscaperProjectV23(options);
	return { project, freeze, derivedSource, trackId: 'voice' };
}
