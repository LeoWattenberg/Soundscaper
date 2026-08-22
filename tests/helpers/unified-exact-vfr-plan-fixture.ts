/* SPDX-License-Identifier: AGPL-3.0-only */

import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../../src/common/editor/video-clip-composition.ts';
import { createDefaultVideoKeyframeCurves } from '../../src/common/editor/video-keyframe-curves.ts';
import { createVideoRetimeExportIntentV6 } from '../../src/common/editor/video-retime-export-plan.ts';
import type { UnifiedExactRenderPlanVersion } from '../../src/common/editor/unified-exact-render-plan.ts';
import {
	boundVideoSourceTimingAuthority,
	bindVideoSourceTimingView,
	type VideoSourceTimingView,
} from '../../src/common/editor/video-source-timing-view.ts';
import {
	createVideoTimingAssetPublication,
	validateVideoTimingAssetBytes,
} from '../../src/common/editor/video-timing-asset.ts';
import {
	NTSC,
	SOURCE_SHA256,
	videoClip,
} from './video-retime-export-fixtures.ts';

const RATE_1 = Object.freeze({ num: 1, den: 1 });

export function unifiedExactVfrPlanFixture(
	version: UnifiedExactRenderPlanVersion = 9,
	sourceSha256: string = SOURCE_SHA256,
) {
	const publication = createVideoTimingAssetPublication(sourceSha256, {
		timescale: 100,
		presentationTicks: [0n, 10n, 30n, 60n],
		finalFrameDurationTicks: 40n,
	});
	const index = validateVideoTimingAssetBytes(publication.reference, publication.bytes);
	const view: VideoSourceTimingView = Object.freeze({
		kind: 'vfr', reference: publication.reference, index,
	});
	const source = Object.freeze({
		id: 'vfr-source', kind: 'video', contentSha256: sourceSha256,
		frameRate: NTSC, sourceFrameCount: 4, timingAsset: publication.reference,
		timingDecision: { mode: 'exact', rate: NTSC, backend: 'demuxer' },
	});
	const timing = bindVideoSourceTimingView(new Map([['vfr-source', view]]), source);
	const canonicalClip = videoClip('vfr-clip', 'vfr-source', null, {
		sequenceFrameCount: 4, sourceFrameCount: 4,
	});
	const intent = createVideoRetimeExportIntentV6({
		sampleStart: 0, sampleDuration: 4, sampleRate: 1,
		sequenceBinding: { id: 'sequence-1', rate: RATE_1 }, outputRate: RATE_1,
		topology: [{
			startSample: 0, endSample: 4,
			layers: [{ clips: [{ clipId: 'vfr-clip' }] }],
		}],
		canonicalClips: [canonicalClip],
	}, new Map([['vfr-source', timing]]));
	const plan = {
		version,
		strategy: 'framescaper-unified-exact-v1',
		project: { id: 'vfr-project', revision: 1 },
		format: { container: 'mp4', extension: 'mp4', mimeType: 'video/mp4' },
		codecs: {
			video: 'h264', videoEncoder: 'libx264', audio: null, audioEncoder: null,
			pixelFormat: 'yuv420p',
		},
		timebase: {
			sampleStart: 0, sampleDuration: 4, sampleRate: 1,
			sequenceId: 'sequence-1', sequenceRate: RATE_1,
		},
		output: {
			frameRate: RATE_1, frameCount: 4, quality: 'balanced',
			canvas: {
				width: 640, height: 360, fit: 'contain', pixelFormat: 'yuv420p',
				backgroundColor: '#000000',
			},
			includeAudio: false, audioLayout: null,
		},
		tracks: [{ trackId: 'track-1', sequenceOrder: 0, mute: false, solo: false, hidden: false }],
		sources: [{
			inputIndex: 0, nodeId: 'source-node', sourceId: 'vfr-source',
			storageKey: 'video-original-sha256:a7', mimeType: 'video/mp4',
			contentSha256: sourceSha256, timing: boundVideoSourceTimingAuthority(timing),
		}],
		nodes: [{
			kind: 'clip', nodeId: 'clip-node', clipId: 'vfr-clip', trackId: 'track-1',
			sourceNodeId: 'source-node', sequenceStartFrame: 0, sequenceFrameCount: 4,
			sourceInFrame: 0, sourceFrameCount: 4,
			pictureState: {
				composition: DEFAULT_VIDEO_CLIP_COMPOSITION, videoEffects: [],
				videoKeyframes: createDefaultVideoKeyframeCurves(4),
			},
			sourceTimeMapping: {
				kind: 'video-retime-export-intent-v6', sourceRate: NTSC,
				retimeMap: null, intent,
			},
		}],
	};
	return Object.freeze({
		plan,
		publication,
		timing,
		timingSidecars: new Map([['vfr-source', timing]]),
	});
}
