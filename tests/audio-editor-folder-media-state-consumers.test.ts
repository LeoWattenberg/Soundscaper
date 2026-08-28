/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAup4ExportPlan } from '../src/common/editor/aup4-export.js';
import { exportProjectEdl } from '../src/common/editor/controller/interchange-export-action.ts';
import { edlExportableVideoTracks } from '../src/common/editor/ui/application-menus.js';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
	createVideoSource,
	createVideoTrack,
} from '../src/common/editor/project-media-factory.ts';
import { projectTrackFolderMediaStateV12 } from '../src/common/editor/track-folder-media-runtime.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';

/**
 * A folder's mute and hidden reach every consumer, or the file disagrees with
 * what plays.
 *
 * Folder media state is inherited, not stored on the leaf: the projection is
 * what flattens it onto the tracks. Playback, audio delivery, video delivery,
 * and the three interchange profiles all cross it. Two consumers did not — an
 * AUP4 export wrote the persisted flags, so a track silent in the editor arrived
 * in Audacity unmuted; and the menu that decides whether an edit list can be
 * exported filtered on the raw `hidden` flag, so it offered the export for a
 * programme with no composing picture and the export then threw.
 */

const NOW = '2026-08-19T12:00:00.000Z';
const SAMPLE_RATE = 48_000;
const PAL = Object.freeze({ num: 25, den: 1 });

test('an AUP4 export states the track state the folder gives it', () => {
	const project = audioProject({ folderMuted: true });
	const projected = projectTrackFolderMediaStateV12(project) as unknown as {
		tracks: readonly Record<string, unknown>[];
	};
	assert.equal(projected.tracks[0]?.mute, true, 'the projection is what playback renders');

	const plan = createAup4ExportPlan(project);
	const track = plan.project.tracks.find(({ id }: { id: string }) => id === 'voice');
	assert.equal(track?.mute, true, 'the exported file must state what the editor plays');
});

test('an AUP4 export of an unfoldered project is unchanged', () => {
	const plan = createAup4ExportPlan(audioProject({ folderMuted: false }));
	const track = plan.project.tracks.find(({ id }: { id: string }) => id === 'voice');
	assert.equal(track?.mute, false);
});

test('the Export EDL entry offers itself exactly when a picture composes', async () => {
	// Inside a hidden folder: nothing composes, so the entry must not offer an
	// export that would immediately refuse for having no visible video track.
	const hiddenFolder = videoProject({ folderHidden: true, trackHidden: false, trackSolo: false });
	assert.deepEqual(edlTrackIds(hiddenFolder), []);
	await assert.rejects(() => exportProjectEdl(edlRuntime(hiddenFolder)), /visible video track/iu);

	// Hidden but soloed: solo is a statement about the whole set, so this track
	// composes and the export produces an event list for it.
	const soloed = videoProject({ folderHidden: false, trackHidden: true, trackSolo: true });
	assert.deepEqual(edlTrackIds(soloed), ['v1']);
	const exported = await exportProjectEdl(edlRuntime(soloed));
	assert.match(exported?.text ?? '', /^TITLE: /u);
});

function edlTrackIds(project: Readonly<Record<string, unknown>>): readonly string[] {
	return (edlExportableVideoTracks(project) as readonly Record<string, unknown>[])
		.map((track) => String(track.id));
}

function edlRuntime(project: Readonly<Record<string, unknown>>) {
	return { getProject: () => project, state: {} as Record<string, unknown>, sequenceId: 'seq' };
}

function audioProject({ folderMuted }: { folderMuted: boolean }) {
	return createSoundscaperProject({
		id: 'folder-consumers-audio', title: 'Folder consumers', now: NOW,
		sources: [createAudioSource({
			id: 'voice-source', storageKey: 'pcm:voice', frameCount: 480_000, channelCount: 1,
			sampleRate: SAMPLE_RATE, originalSampleRate: SAMPLE_RATE, sampleFormat: 'float32',
			chunkFrames: 65_536,
		})],
		clips: [createAudioClip({
			id: 'voice-clip', sourceId: 'voice-source', title: 'Voice', timelineStartFrame: 0,
			durationFrames: 48_000, sourceStartFrame: 0, sourceDurationFrames: 48_000,
		})],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['voice-clip'] })],
		trackFolders: [{ id: 'stems', name: 'Stems', mute: folderMuted }],
		sequences: [{
			id: 'seq',
			trackNodes: [
				{ kind: 'folder', id: 'stems', parentFolderId: null },
				{ kind: 'track', id: 'voice', parentFolderId: 'stems' },
			],
		}],
		primarySequenceId: 'seq',
	});
}

function videoProject(
	{ folderHidden, trackHidden, trackSolo }: {
		folderHidden: boolean; trackHidden: boolean; trackSolo: boolean;
	},
) {
	return createSoundscaperProject({
		id: 'folder-consumers-video', title: 'Folder consumers', now: NOW,
		sources: [createVideoSource({
			id: 'cam', name: 'CAM', storageKey: 'media/cam.mp4', mimeType: 'video/mp4',
			frameCount: SAMPLE_RATE * 10, sampleRate: SAMPLE_RATE, channelCount: 2,
			frameRate: PAL, width: 1920, height: 1080,
		})],
		clips: [{
			kind: 'video', id: 'v-clip', sourceId: 'cam', title: 'Wide', sequenceId: 'seq',
			sequenceStartFrame: 0, sequenceFrameCount: 25, sourceInFrame: 0, sourceFrameCount: 25,
		}],
		tracks: [createVideoTrack({
			id: 'v1', name: 'V1', clipIds: ['v-clip'], hidden: trackHidden, solo: trackSolo,
		})],
		trackFolders: [{ id: 'picture', name: 'Picture', hidden: folderHidden }],
		sequences: [{
			id: 'seq', name: 'Sequence', rate: PAL,
			trackNodes: [
				{ kind: 'folder', id: 'picture', parentFolderId: null },
				{ kind: 'track', id: 'v1', parentFolderId: 'picture' },
			],
		}],
		primarySequenceId: 'seq',
	});
}
