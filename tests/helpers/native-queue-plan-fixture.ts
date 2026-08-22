/* SPDX-License-Identifier: AGPL-3.0-only */

import { createVideoExportPlan } from '../../src/common/editor/video-export.js';
import {
	createVideoKeyframeExportPlanV7,
} from '../../src/common/editor/video-keyframe-export-plan-v7.ts';

export function nativeQueueKeyedPlanV7(): Record<string, unknown> {
	const durationFrames = 48_048;
	return createVideoKeyframeExportPlanV7({
		format: 'mp4',
		sampleRate: 48_000,
		range: { startFrame: 96_000, endFrame: 96_000 + durationFrames, durationFrames },
		canvas: {
			width: 1_280,
			height: 720,
			frameRate: { num: 30_000, den: 1_001 },
			fit: 'contain',
			pixelFormat: 'yuv420p',
			backgroundColor: '#000000',
			referenceClipId: 'clip-a',
			referenceSourceId: 'source-a',
		},
		activeClipIds: ['clip-a', 'clip-b'],
		activeSourceIds: ['source-a', 'source-b'],
		sources: [keyedSource('source-a', '12'), keyedSource('source-b', '34')],
		includeAudio: true,
		audioFileName: 'audio-mix.wav',
	}) as unknown as Record<string, unknown>;
}

export function nativeQueueStaticPlanV8(): Record<string, unknown> {
	return createVideoExportPlan(singleClipProject(), {
		includeAudio: false,
		range: { startFrame: 0, endFrame: 1_000 },
	}) as Record<string, unknown>;
}

function keyedSource(id: string, digestByte: string): Record<string, unknown> {
	return {
		kind: 'video', id, storageKey: `storage-${id}`, mimeType: 'video/mp4',
		contentSha256: digestByte.repeat(32),
	};
}

function singleClipProject() {
	return {
		sampleRate: 1_000,
		selection: { startFrame: 0, endFrame: 0 },
		loop: { enabled: false, startFrame: 0, endFrame: 0 },
		sources: [{
			kind: 'video', id: 'source-1', name: 'Source', mimeType: 'video/mp4',
			storageKey: 'media/source-1', frameCount: 10_000, sampleRate: 1_000,
			width: 1_280, height: 720, frameRate: 30, videoCodec: 'h264',
			audioCodec: 'aac', hasAudio: false, posterStorageKey: null, thumbnailStorageKey: null,
		}],
		clips: [{
			kind: 'video', id: 'clip-1', sourceId: 'source-1', title: 'Clip',
			timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 10_000,
			durationFrames: 10_000, trimStartFrames: 0, trimEndFrames: 0, speedRatio: 1,
			groupId: null, avLinkId: null, binItemId: null, color: 'blue',
		}],
		tracks: [{
			type: 'video', id: 'track-1', name: 'Video', clipIds: ['clip-1'], mute: false,
			hidden: false, collapsed: false, height: 120, laneGroupId: null,
		}],
	};
}
