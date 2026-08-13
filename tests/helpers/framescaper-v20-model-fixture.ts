/* SPDX-License-Identifier: AGPL-3.0-only */

import { createVideoSourceV10, createVideoTrackV10 } from '../../src/common/editor/project-v10.ts';

export const FRAMESCAPER_V20_FIXTURE_NOW = '2026-08-13T12:00:00.000Z';

export function framescaperV20Options(): Record<string, unknown> {
	return {
		id: 'framescaper-v20',
		title: 'Framescaper V20',
		now: FRAMESCAPER_V20_FIXTURE_NOW,
		sources: [
			createVideoSourceV10({
				id: 'video-source',
				name: 'Video',
				storageKey: 'video-source',
				mimeType: 'video/mp4',
				contentSha256: '12'.repeat(32),
				frameCount: 48_000,
				sampleFrameCount: 48_000,
				sourceFrameCount: 10,
				frameRate: { num: 10, den: 1 },
				width: 1_920,
				height: 1_080,
			}),
			{
				kind: 'audio', id: 'audio-source', name: 'Audio', storageKey: 'audio-source',
				mimeType: 'audio/wav', frameCount: 48_000, channelCount: 1,
				sampleRate: 48_000, originalSampleRate: 48_000,
			},
		],
		clips: [
			{
				kind: 'video', id: 'video-clip', sourceId: 'video-source', title: 'Video',
				sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
				sourceInFrame: 0, sourceFrameCount: 10, retimeMap: null,
			},
			{
				kind: 'audio', id: 'audio-clip', sourceId: 'audio-source', title: 'Audio',
				timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 48_000,
				durationFrames: 48_000,
			},
		],
		projectBin: {
			clips: [{
				kind: 'video', id: 'bin-video', sourceId: 'video-source', title: 'Bin video',
				sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
				sourceInFrame: 0, sourceFrameCount: 10, retimeMap: null, binItemId: 'bin-video',
			}],
		},
		tracks: [
			createVideoTrackV10({
				id: 'video-track', name: 'Video', clipIds: ['video-clip'], locked: false,
			}),
			{
				id: 'audio-track', name: 'Audio', type: 'audio', clipIds: ['audio-clip'],
				height: 96, collapsed: false,
			},
		],
		sequences: [{
			id: 'main-sequence', rate: { num: 10, den: 1 },
			trackIds: ['video-track', 'audio-track'],
		}],
		primarySequenceId: 'main-sequence',
	};
}

export function opacityKeyframes(end = 10): Record<string, unknown> {
	return {
		schemaVersion: 1,
		timeDomain: {
			authoredDuration: { num: end, den: 1 },
			viewStart: { num: 0, den: 1 },
			viewDuration: { num: end, den: 1 },
		},
		curves: [{
			target: { kind: 'composition', parameterId: 'opacity' },
			curve: {
				anchors: [
					{ position: { num: 0, den: 1 }, value: 0.25 },
					{ position: { num: end, den: 1 }, value: 0.75 },
				],
				segments: [{ kind: 'linear' }],
			},
		}],
	};
}
