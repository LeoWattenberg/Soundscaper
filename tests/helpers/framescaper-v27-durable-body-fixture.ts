/* SPDX-License-Identifier: AGPL-3.0-only */

import { digestScapeBytes } from '../../src/common/editor/scape-archive-media.ts';
import type { FramescaperDesktopV12BodyStore } from '../../src/framescaper/desktop-project-library-v12-body-transfer.ts';
import { parseCubeLutV1 } from '../../src/common/editor/video-color-management-v27.ts';
import {
	analyzeVideoMotionV1,
} from '../../src/common/editor/video-motion-analysis-v27.ts';
import { createGrayVideoFrameV1 } from '../../src/common/editor/video-motion-processing-v27.ts';
import { createVideoTimingAssetPublication } from '../../src/common/editor/video-timing-asset.ts';
import { createVideoFreezeFallbackV1 } from '../../src/common/editor/video-freeze-v24.ts';
import { reconcileFramescaperProjectFeatureRequirementsV27 } from '../../src/framescaper/editor-project-feature-requirements-v27.ts';
import {
	FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE,
} from '../../src/framescaper/editor-project-runtime-profile-v27.ts';
import {
	cloneFramescaperProjectV27,
	createFramescaperProjectV27,
	type FramescaperProjectV27,
} from '../../src/framescaper/editor-project-v27.ts';
import { framescaperV20Options } from './framescaper-v20-model-fixture.ts';

const PROFILE = FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE;
const UTF8 = new TextEncoder();

export const V27_ORIGINAL_BYTES = UTF8.encode('V27 desktop original video');
export const V27_PROXY_BYTES = UTF8.encode('V27 desktop proxy');
export const V27_STILL_BYTES = UTF8.encode('V27 desktop regular still');
export const V27_FREEZE_BYTES = UTF8.encode('V27 desktop freeze render');
export const V27_LUT_TEXT = [
	'LUT_3D_SIZE 2',
	'0 0 0', '0 0 1', '0 1 0', '0 1 1',
	'1 0 0', '1 0 1', '1 1 0', '1 1 1',
].join('\n');

export interface FramescaperV27DurableBodyFixture {
	readonly project: FramescaperProjectV27;
	readonly bodies: ReadonlyMap<string, Readonly<{
		readonly bytes: Uint8Array;
		readonly mimeType: string;
		readonly kind: string;
		readonly encoding: string;
	}>>;
}

export async function createFramescaperV27DurableBodyFixture(
): Promise<FramescaperV27DurableBodyFixture> {
	const originalSha = digestScapeBytes(V27_ORIGINAL_BYTES);
	const proxySha = digestScapeBytes(V27_PROXY_BYTES);
	const stillSha = digestScapeBytes(V27_STILL_BYTES);
	const freezeSha = digestScapeBytes(V27_FREEZE_BYTES);
	const lut = parseCubeLutV1(V27_LUT_TEXT);
	const timing = createVideoTimingAssetPublication(proxySha, {
		timescale: 1_000,
		presentationTicks: Array.from({ length: 10 }, (_, index) => BigInt(index * 100)),
		finalFrameDurationTicks: 100n,
	});
	const stack = processorStack('video-source');
	const motion = await analyzeVideoMotionV1({
		analysisId: 'motion-analysis', inputSha256: originalSha, processorStack: stack,
		frames: [
			{ frameNumber: 0, frame: grayFrame(0) },
			{ frameNumber: 1, frame: grayFrame(1) },
		],
	});
	const options = framescaperV20Options();
	const video = (options.sources as Record<string, unknown>[])[0]!;
	video.contentSha256 = originalSha;
	options.sources = [video];
	const videoClip = (options.clips as Record<string, unknown>[])[0]!;
	const extraClips = [
		stillClip('still-clip', 'still-source', 10),
		stillClip('freeze-clip', 'freeze-source', 20),
		generatorClip(),
	];
	options.clips = [videoClip, ...extraClips];
	const track = (options.tracks as Record<string, unknown>[])[0]!;
	track.clipIds = ['video-clip', ...extraClips.map(({ id }) => id)];
	options.tracks = [track];
	(options.sequences as Record<string, unknown>[])[0]!.trackIds = ['video-track'];
	const freeze = createVideoFreezeFallbackV1({
		renderedSourceId: 'freeze-source', renderedAssetSha256: freezeSha,
		authoredStateSha256: '11'.repeat(32), inputIdentitiesSha256: '22'.repeat(32),
		renderPlanFingerprintSha256: '33'.repeat(32), nativeEffectFingerprintSha256: '44'.repeat(32),
	});
	const lutReference = {
		storageKey: `lut-sha256:${lut.sha256}`, sha256: lut.sha256, byteLength: lut.byteLength,
		size: lut.size, domainMin: lut.domainMin, domainMax: lut.domainMax,
	};
	const grade = {
		schemaVersion: 1, exposureStops: 0, contrast: 1, pivot: 0.18,
		lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], saturation: 1,
		lut: lutReference,
	};
	const project = createFramescaperProjectV27(PROFILE, {
		...options, videoTransitionsByTrackId: { 'video-track': [] },
		visualModel: {
			stillSources: [
				stillSource('still-source', 'Regular still', stillSha),
				stillSource('freeze-source', 'Freeze render', freezeSha),
			],
			generatorSources: [generatorSource()], freezeFallbacks: [freeze],
		},
		finishing: {
			processorStacks: [stack], motionAnalyses: [motion.reference],
			visualPresentations: [{
				schemaVersion: 1, id: 'graded-video', owner: { kind: 'clip', id: 'video-clip' },
				enabled: true, opacity: 1, blendMode: 'normal', grade,
				processorStackId: stack.id, maskMatteIds: [],
			}],
			finishingPresets: [{
				schemaVersion: 1, kind: 'video-finishing-preset', id: 'look', name: 'Look',
				template: { enabled: true, opacity: 1, blendMode: 'normal', grade },
			}],
		},
	});
	const mutable = structuredClone(project) as unknown as Record<string, unknown>;
	const mutableVideo = (mutable.sources as Record<string, unknown>[])
		.find(({ id }) => id === 'video-source')!;
	mutableVideo.proxyAttachment = proxyAttachment(proxySha, originalSha, timing);
	mutable.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV27(PROFILE, mutable);
	const exact = cloneFramescaperProjectV27(PROFILE, mutable);
	return Object.freeze({
		project: exact,
		bodies: new Map([
			body('video-source', V27_ORIGINAL_BYTES, 'video/mp4', 'video-original', 'framescaper-video-original-v1'),
			body(`video-proxy-sha256:${proxySha}`, V27_PROXY_BYTES, 'video/mp4', 'video-proxy', 'video-proxy-v1'),
			body(timing.reference.storageKey, timing.bytes, 'application/vnd.soundscaper.video-timing',
				'video-timing', timing.reference.encoding),
			body('still-source', V27_STILL_BYTES, 'image/png', 'still', 'still-image-v1'),
			body('freeze-source', V27_FREEZE_BYTES, 'image/png', 'freeze-render', 'freeze-render-v1'),
			body(`lut-sha256:${lut.sha256}`, UTF8.encode(V27_LUT_TEXT), 'text/plain', 'cube-lut', 'cube-lut-v1'),
			body(motion.reference.storageKey, motion.bytes, 'application/vnd.framescaper.motion-analysis+json',
				'motion-analysis', 'motion-analysis-json-v1'),
		]),
	});
}

export async function seedFramescaperV27DurableBodies(
	store: FramescaperDesktopV12BodyStore & Readonly<{
		writeMediaAsset(storageKey: string, body: Blob, metadata: Readonly<Record<string, unknown>>): PromiseLike<unknown>;
	}>,
	fixture: FramescaperV27DurableBodyFixture,
): Promise<void> {
	for (const [storageKey, value] of fixture.bodies) {
		await store.writeMediaAsset(storageKey, new Blob([Uint8Array.from(value.bytes).buffer], {
			type: value.mimeType,
		}), {
			name: storageKey, mimeType: value.mimeType, kind: value.kind, encoding: value.encoding,
		});
	}
}

function body(
	storageKey: string,
	bytes: Uint8Array,
	mimeType: string,
	kind: string,
	encoding: string,
) {
	return [storageKey, Object.freeze({ bytes: Uint8Array.from(bytes), mimeType, kind, encoding })] as const;
}

function stillSource(id: string, name: string, contentSha256: string) {
	return {
		schemaVersion: 1, kind: 'still', id, name, mimeType: 'image/png', storageKey: id,
		contentSha256, width: 2, height: 2, hasAlpha: true,
	};
}

function stillClip(id: string, sourceId: string, sequenceStartFrame: number) {
	return {
		schemaVersion: 1, kind: 'still', id, sourceId, sequenceId: 'main-sequence',
		sequenceStartFrame, sequenceFrameCount: 10,
	};
}

function generatorSource() {
	return {
		schemaVersion: 1, kind: 'generator', id: 'generator-source', name: 'External composite',
		width: 2, height: 2, frameRate: { num: 10, den: 1 }, frameCount: 10,
		generator: {
			kind: 'external-generator', bindingId: 'builtin-composite',
			inputs: [{ name: 'plate', sourceRef: 'still-source' }],
		},
	};
}

function generatorClip() {
	return {
		schemaVersion: 1, kind: 'generator', id: 'generator-clip', sourceId: 'generator-source',
		sequenceId: 'main-sequence', sequenceStartFrame: 30, sequenceFrameCount: 10,
		sourceInFrame: 0, sourceFrameCount: 10,
	};
}

function proxyAttachment(
	proxySha: string,
	originalSha: string,
	timing: ReturnType<typeof createVideoTimingAssetPublication>,
) {
	return {
		kind: 'video-proxy-attachment', version: 1,
		rule: 'exact-original-generation-proxy-content-and-timing-v1',
		storageKey: `video-proxy-sha256:${proxySha}`, mimeType: 'video/mp4',
		byteLength: V27_PROXY_BYTES.byteLength, sha256: proxySha, originalSha256: originalSha,
		originalAuthorityKind: 'owned', generatorId: 'ffmpeg', generatorVersion: 1,
		recipeId: 'framescaper-video-proxy-h264-540-v1', recipeVersion: 1,
		timingBackendId: 'ffprobe', timingRule: 'exact-presentation-boundaries-v1',
		frameCount: 10, boundaryCount: 11, timingAsset: timing.reference,
		audioPolicy: 'ignore-proxy-container-audio-v1',
	};
}

function processorStack(sourceId: string) {
	return {
		schemaVersion: 1 as const, id: 'motion-stack', sourceId,
		processors: [{
			schemaVersion: 1 as const, id: 'tracker', kind: 'tracking' as const, enabled: true,
			maximumFeatures: 16, quality: 0.01, minimumDistance: 1, windowRadius: 2, pyramidLevels: 2,
		}],
	};
}

function grayFrame(offset: number) {
	const samples = Array.from({ length: 64 }, () => 0);
	for (let y = 2; y < 5; y += 1) for (let x = 1 + offset; x < 4 + offset; x += 1) {
		samples[y * 8 + x] = 1;
	}
	return createGrayVideoFrameV1({ width: 8, height: 8, samples });
}
