/* SPDX-License-Identifier: AGPL-3.0-only */

import { createNativeMediaImageSequenceSourceV25 } from '../../src/common/editor/native-media-image-sequence-v25.ts';
import { fingerprintNativeMediaPlan } from '../../src/common/editor/native-media-plan-canonical-form.ts';
import { createVideoFreezeFallbackV1 } from '../../src/common/editor/video-freeze-v24.ts';
import { createDefaultDissolveVideoTransitionV1 } from '../../src/common/editor/video-transition-registry.ts';
import { createUnreportedVideoSourceCharacteristicsV25 } from '../../src/common/editor/video-source-professional-characteristics-v25.ts';
import type { UnifiedExactRenderPlanVersion } from '../../src/common/editor/unified-exact-render-plan.ts';
import { createVideoRetimeExportIntentV6 } from '../../src/common/editor/video-retime-export-plan.ts';
import {
	SOURCE_SHA256,
	RATE_1,
	baseInput,
	bindCfrTiming,
	linearCurve,
	videoClip,
} from './video-retime-export-fixtures.ts';

export const UNIFIED_SHA_A = SOURCE_SHA256;
export const UNIFIED_SHA_B = 'b2'.repeat(32);
export const UNIFIED_SHA_C = 'c3'.repeat(32);
export const UNIFIED_SHA_D = 'd4'.repeat(32);

export function unifiedExactTimingFixture() {
	return new Map([['source-1', bindCfrTiming('source-1', 20, RATE_1)]]);
}

export function unifiedExactPlanFixture(version: UnifiedExactRenderPlanVersion) {
	return {
		version,
		strategy: 'framescaper-unified-exact-v1',
		project: { id: 'project-1', revision: 7 },
		format: { container: 'mp4', extension: 'mp4', mimeType: 'video/mp4' },
		codecs: {
			video: 'h264', videoEncoder: 'libx264', audio: 'aac', audioEncoder: 'aac',
			pixelFormat: 'yuv420p',
		},
		timebase: {
			sampleStart: 0, sampleDuration: 10, sampleRate: 1,
			sequenceId: 'sequence-1', sequenceRate: RATE_1,
		},
		output: {
			frameRate: RATE_1, frameCount: 10,
			canvas: {
				width: 1_280, height: 720, fit: 'contain', pixelFormat: 'yuv420p',
				backgroundColor: '#000000',
			},
			includeAudio: true, audioLayout: 'stereo',
		},
		sources: [source()],
		nodes: [
			clip('clip-out', 0, 7, 0, 7, true),
			clip('clip-in', 5, 7, 7, 7, false),
			clip('clip-later', 7, 7, 13, 7, false),
			transition('transition-1', 'clip-out', 'clip-in', 0, 7, 0, 7, 5, 7, 7, 7),
			transition('transition-2', 'clip-in', 'clip-later', 5, 7, 7, 7, 7, 7, 13, 7),
			...(version >= 10 ? [visual()] : []),
			...(version >= 11 ? [professional()] : []),
			...(version >= 12 ? [openFx()] : []),
		],
	};
}

function source() {
	return {
		inputIndex: 0, nodeId: 'source-node', sourceId: 'source-1',
		storageKey: `image-sequence-pack-sha256:${UNIFIED_SHA_A}`,
		mimeType: 'application/vnd.soundscaper.image-sequence-pack',
		contentSha256: UNIFIED_SHA_A,
		timing: { kind: 'cfr', frameCount: 20, rate: RATE_1 },
	};
}

function clip(
	clipId: string,
	sequenceStartFrame: number,
	sequenceFrameCount: number,
	sourceInFrame: number,
	sourceFrameCount: number,
	retimed: boolean,
) {
	const startSample = Math.max(0, sequenceStartFrame);
	const endSample = Math.min(10, sequenceStartFrame + sequenceFrameCount);
	const timing = unifiedExactTimingFixture();
	const intent = createVideoRetimeExportIntentV6(baseInput({
		sampleDuration: 10,
		sequenceBinding: { id: 'sequence-1', rate: RATE_1 },
		topology: [
			...(startSample === 0 ? [] : [{ startSample: 0, endSample: startSample, layers: [] }]),
			{ startSample, endSample, layers: [{ clips: [{ clipId }] }] },
			...(endSample === 10 ? [] : [{ startSample: endSample, endSample: 10, layers: [] }]),
		],
		canonicalClips: [videoClip(
			clipId,
			'source-1',
			retimed ? linearCurve(sequenceFrameCount) : null,
			{
				sequenceStartFrame, sequenceFrameCount, sourceInFrame, sourceFrameCount,
			},
		)],
	}), timing);
	return {
		kind: 'clip', nodeId: `node-${clipId}`, clipId, trackId: 'track-1',
		sourceNodeId: 'source-node', sequenceStartFrame, sequenceFrameCount,
		sourceInFrame, sourceFrameCount,
		sourceTimeMapping: { kind: 'video-retime-export-intent-v6', intent },
	};
}

function transition(
	id: string,
	outgoingClipId: string,
	incomingClipId: string,
	outgoingStart: number,
	outgoingCount: number,
	outgoingSourceIn: number,
	outgoingSourceCount: number,
	incomingStart: number,
	incomingCount: number,
	incomingSourceIn: number,
	incomingSourceCount: number,
) {
	const durationFrames = outgoingStart + outgoingCount - incomingStart;
	return {
		kind: 'transition',
		nodeId: `node-${id}`,
		transition: createDefaultDissolveVideoTransitionV1({
			id, outgoingClipId, incomingClipId, durationFrames,
		}),
		edges: {
			schemaVersion: 1,
			sequenceId: 'sequence-1',
			trackId: 'track-1',
			outgoing: edge(
				outgoingClipId, outgoingStart, outgoingCount, outgoingSourceIn, outgoingSourceCount,
			),
			incoming: edge(
				incomingClipId, incomingStart, incomingCount, incomingSourceIn, incomingSourceCount,
			),
		},
	};
}

function edge(
	clipId: string,
	sequenceStartFrame: number,
	sequenceFrameCount: number,
	sourceInFrame: number,
	sourceFrameCount: number,
) {
	return {
		clipId, sourceId: 'source-1', sequenceStartFrame, sequenceFrameCount,
		sequenceRate: RATE_1, sourceInFrame, sourceFrameCount, sourceRate: RATE_1,
		retimeMap: null,
	};
}

function visual() {
	const authoredState = {
		source: {
			schemaVersion: 1, kind: 'generator', id: 'generator-1', name: 'Black',
			width: 1_280, height: 720, frameRate: RATE_1, frameCount: 10,
			generator: { kind: 'solid', color: '#000000ff' },
		},
		clip: {
			schemaVersion: 1, kind: 'generator', id: 'generator-clip-1',
			sourceId: 'generator-1', sequenceId: 'sequence-1', sequenceStartFrame: 0,
			sequenceFrameCount: 10, sourceInFrame: 0, sourceFrameCount: 10,
		},
	};
	const freshness = {
		authoredStateSha256: fingerprintNativeMediaPlan(authoredState).sha256,
		inputIdentitiesSha256: UNIFIED_SHA_B,
		renderPlanFingerprintSha256: UNIFIED_SHA_C,
		nativeEffectFingerprintSha256: UNIFIED_SHA_D,
	};
	return {
		kind: 'visual', nodeId: 'visual-node', modelId: 'generator-1', modelKind: 'solid',
		authoredState,
		freshness,
		frozenFallback: createVideoFreezeFallbackV1({
			renderedSourceId: 'source-1', renderedAssetSha256: UNIFIED_SHA_A, ...freshness,
		}),
	};
}

function professional() {
	const characteristics = createUnreportedVideoSourceCharacteristicsV25();
	const imageSequence = createNativeMediaImageSequenceSourceV25({
		id: 'source-1', name: 'Sequence',
		selection: {
			stem: 'shot_', extension: 'exr', frameNumberWidth: 4,
			firstFrameNumber: 1, lastFrameNumber: 20, frameCount: 20,
			frameRate: RATE_1,
			frames: Array.from({ length: 20 }, (_, index) => ({
				index, fileName: `shot_${String(index + 1).padStart(4, '0')}.exr`, frameNumber: index + 1,
			})),
		},
		inventory: {
			kind: 'image-sequence-inventory', version: 1,
			storageKey: `image-sequence-inventory-sha256:${UNIFIED_SHA_C}`,
			sha256: UNIFIED_SHA_C, byteLength: 1_024, frameCount: 20,
			firstFrameNumber: 1, lastFrameNumber: 20,
		},
		sourcePack: {
			kind: 'image-sequence-source-pack',
			storageKey: `image-sequence-pack-sha256:${UNIFIED_SHA_A}`,
			sha256: UNIFIED_SHA_A, byteLength: 4_096,
		},
		characteristics,
		clearedPolicyRowIds: ['codec-image-sequence-still-formats'],
	});
	return {
		kind: 'professional-media', nodeId: 'professional-node', sourceNodeId: 'source-node',
		characteristics, imageSequence,
		proxyAttachment: proxyAttachment(),
		exportAuthority: 'original',
	};
}

function proxyAttachment() {
	return {
		kind: 'video-proxy-attachment', version: 1,
		rule: 'exact-original-generation-proxy-content-and-timing-v1',
		storageKey: `video-proxy-sha256:${UNIFIED_SHA_B}`,
		mimeType: 'video/quicktime', byteLength: 4_096, sha256: UNIFIED_SHA_B,
		originalSha256: UNIFIED_SHA_A, originalAuthorityKind: 'owned',
		generatorId: 'framescaper-native-media-host', generatorVersion: 1,
		recipeId: 'framescaper-native-prores-proxy-mov-v1', recipeVersion: 1,
		timingBackendId: 'ffmpeg-9.0.1', timingRule: 'exact-presentation-boundaries-v1',
		frameCount: 20, boundaryCount: 21,
		timingAsset: {
			encoding: 'soundscaper-video-timing-v1',
			storageKey: `video-timing-sha256:${UNIFIED_SHA_D}`,
			sha256: UNIFIED_SHA_D, sourceSha256: UNIFIED_SHA_B,
			byteLength: 192, frameCount: 20, timescale: 1,
			finalFrameDurationTicks: '1',
		},
		audioPolicy: 'ignore-proxy-container-audio-v1',
	};
}

function openFx() {
	return {
		kind: 'openfx', nodeId: 'openfx-node',
		state: {
			schemaVersion: 1,
			instanceId: 'ofx-1', pluginId: 'net.example.Retimer', binarySha256: UNIFIED_SHA_A,
			context: 'retimer', attachment: { kind: 'retimer', targetId: 'clip-out' },
			inputs: [{ name: 'Source', sourceRef: 'source-1' }],
			parameters: [{
				name: 'speed', type: 'double', value: [1], keyframes: [{ frame: 3, value: 0.5 }],
			}],
			customEncodings: {}, enabled: true,
			freshness: {
				authoredStateSha256: UNIFIED_SHA_A,
				inputIdentitiesSha256: UNIFIED_SHA_B,
				renderPlanFingerprintSha256: UNIFIED_SHA_C,
				nativeEffectFingerprintSha256: UNIFIED_SHA_D,
			},
			frozenFallback: {
				externalMediaSourceId: 'source-1', renderedAssetSha256: UNIFIED_SHA_A,
				frameCount: 10,
				freshness: {
					authoredStateSha256: UNIFIED_SHA_A,
					inputIdentitiesSha256: UNIFIED_SHA_B,
					renderPlanFingerprintSha256: UNIFIED_SHA_C,
					nativeEffectFingerprintSha256: UNIFIED_SHA_D,
				},
			},
		},
	};
}
