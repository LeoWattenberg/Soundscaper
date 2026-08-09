/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createAudioClipV4,
	createAudioSourceV4,
	createVideoClipV4,
	createVideoSourceV4,
} from '../../src/common/editor/project-v4.js';
import {
	createAudioEditorProjectV10,
	validateAudioEditorProjectV10,
} from '../../src/common/editor/project-v10.ts';

export function createPersistedVideoProject(
	{ projectBin = false, timeline = false }: Readonly<{ projectBin?: boolean; timeline?: boolean }> = {},
) {
	const frameCount = 48_000;
	const videoSource = createVideoSourceV4({
		id: 'persisted-video-source',
		name: 'persisted-camera.mp4',
		mimeType: 'video/mp4',
		storageKey: 'persisted-video-source',
		frameCount,
		sampleRate: 48_000,
		width: 640,
		height: 360,
		frameRate: 25,
		videoCodec: 'h264',
		audioCodec: 'aac',
		hasAudio: true,
		opaqueExtensions: { byteLength: 15 },
	});
	const audioSource = createAudioSourceV4({
		id: 'persisted-audio-source',
		name: 'persisted camera audio',
		storageKey: 'persisted-audio-source',
		frameCount,
		channelCount: 2,
		sampleRate: 48_000,
	});
	const binClips = projectBin ? [
		createVideoClipV4({
			id: 'persisted-bin-video',
			sourceId: videoSource.id,
			title: 'Persisted scene',
			sourceStartFrame: 0,
			sourceDurationFrames: frameCount,
			durationFrames: frameCount,
			binItemId: 'persisted-bin-item',
		}),
		createAudioClipV4({
			id: 'persisted-bin-audio',
			sourceId: audioSource.id,
			title: 'Persisted scene',
			sourceStartFrame: 0,
			sourceDurationFrames: frameCount,
			durationFrames: frameCount,
			binItemId: 'persisted-bin-item',
		}),
	] : [];
	const avLinkId = timeline ? 'persisted-av-link' : null;
	const timelineClips = timeline ? [
		createVideoClipV4({
			id: 'persisted-timeline-video',
			sourceId: videoSource.id,
			title: 'Timeline scene',
			sourceStartFrame: 0,
			sourceDurationFrames: frameCount,
			durationFrames: frameCount,
			avLinkId,
		}),
		createAudioClipV4({
			id: 'persisted-timeline-audio',
			sourceId: audioSource.id,
			title: 'Timeline scene audio',
			sourceStartFrame: 0,
			sourceDurationFrames: frameCount,
			durationFrames: frameCount,
			avLinkId,
		}),
	] : [];
	const laneGroupId = timeline ? 'persisted-lane-group' : null;
	const tracks = timeline ? [{
		type: 'video',
		id: 'persisted-video-track',
		name: 'Persisted video',
		clipIds: ['persisted-timeline-video'],
		mute: false,
		hidden: false,
		collapsed: false,
		height: 96,
		laneGroupId,
		opaqueExtensions: {},
	}, {
		type: 'audio',
		id: 'persisted-audio-track',
		name: 'Persisted audio',
		clipIds: ['persisted-timeline-audio'],
		mute: false,
		solo: false,
		armed: false,
		gain: 1,
		pan: 0,
		channelCount: 2,
		color: 'auto',
		effects: [],
		laneGroupId,
		opaqueExtensions: {},
	}] : [];
	const project = createAudioEditorProjectV10({
		id: `persisted-video-project-${projectBin ? 'bin' : 'timeline'}`,
		title: 'Persisted video project',
		now: '2026-07-18T12:00:00.000Z',
		sources: [videoSource, audioSource],
		clips: timelineClips,
		tracks,
		projectBin: { clips: binClips },
	});
	validateAudioEditorProjectV10(project);
	return {
		project,
		videoSource: project.sources.find(({ id }) => id === videoSource.id),
		audioSource: project.sources.find(({ id }) => id === audioSource.id),
	};
}
