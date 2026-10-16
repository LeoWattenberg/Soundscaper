/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { ScapeAssetDescriptor, ScapeManifest } from '../../src/common/editor/scape-archive-envelope.ts';
import { parseCubeLutV1, type VideoCubeLutReferenceV1 } from '../../src/common/editor/video-color-management-v27.ts';
import { videoMotionSettingsSha256V1 } from '../../src/common/editor/video-motion-analysis-v27.ts';
import type { VideoMotionAnalysisReferenceV1, VideoProcessorStackV1 } from '../../src/common/editor/video-motion-model-v27.ts';
import { createVideoTimingAssetPublication } from '../../src/common/editor/video-timing-asset.ts';
import type { FramescaperProjectFinishing } from '../../src/framescaper/editor-project-finishing.ts';
import type {
	FramescaperDurableScapeAssetProject, FramescaperDurableScapeAssetReference,
} from '../../src/framescaper/editor-scape-durable-asset-plan-core.ts';

export type Json = Record<string, unknown>;

export interface ProjectInput {
	readonly sources?: readonly Json[];
	readonly videoFreezeFallbacks?: readonly { readonly renderedSourceId: string }[];
	readonly videoVisualPresentations?: readonly Json[];
	readonly videoFinishingPresets?: readonly Json[];
	readonly videoProcessorStacks?: readonly VideoProcessorStackV1[];
	readonly videoMotionAnalyses?: readonly VideoMotionAnalysisReferenceV1[];
}

export interface CoreInput {
	readonly sources?: readonly Json[];
	readonly freezeRenderedSourceIds?: readonly string[];
	readonly luts?: readonly VideoCubeLutReferenceV1[];
	readonly processorStacks?: readonly VideoProcessorStackV1[];
	readonly motionAnalyses?: readonly VideoMotionAnalysisReferenceV1[];
}

export function coreProject(input: CoreInput = {}): FramescaperDurableScapeAssetProject {
	return {
		sources: input.sources ?? [], freezeRenderedSourceIds: new Set(input.freezeRenderedSourceIds),
		luts: () => input.luts ?? [], processorStacks: () => input.processorStacks ?? [],
		motionAnalyses: () => input.motionAnalyses ?? [],
	};
}

export function finishingProject(input: ProjectInput = {}): FramescaperProjectFinishing {
	return {
		sources: [], videoFreezeFallbacks: [], videoVisualPresentations: [], videoFinishingPresets: [],
		videoProcessorStacks: [], videoMotionAnalyses: [], ...input,
	} as unknown as FramescaperProjectFinishing;
}

export const UTF8 = new TextEncoder();
export const MAXIMUM_STILL_BYTES = 512 * 1024 * 1024;
export const MAXIMUM_LUT_BYTES = 16 * 1024 * 1024;
export const TIMING_MIME = 'application/vnd.soundscaper.video-timing';
export const MOTION_MIME = 'application/vnd.framescaper.motion-analysis+json';
export const STILL_BYTES = UTF8.encode('finishing still body');
export const PROXY_BYTES = UTF8.encode('finishing proxy body');
export const LUT_TEXT = [
	'TITLE "Fixture"', 'LUT_3D_SIZE 2', '0.0 0.0 0.0', '1.0 0.0 0.0', '0.0 1.0 0.0', '1.0 1.0 0.0',
	'0.0 0.0 1.0', '1.0 0.0 1.0', '0.0 1.0 1.0', '1.0 1.0 1.0', '',
].join('\n');
export const LUT = parseCubeLutV1(LUT_TEXT);
export const TIMING = createVideoTimingAssetPublication(digest(PROXY_BYTES), {
	timescale: 1000, presentationTicks: [0n, 100n], finalFrameDurationTicks: 100n,
});
export const MOTION_STACK: VideoProcessorStackV1 = Object.freeze({
	schemaVersion: 1, id: 'stack-1', sourceId: 'video-1', processors: [],
});
export const MOTION_INPUT_SHA = digest(UTF8.encode('motion input'));
export const MOTION_BYTES = UTF8.encode(JSON.stringify({
	schemaVersion: 1, analysisId: 'motion-1', sourceId: 'video-1', processorStackId: 'stack-1',
	inputSha256: MOTION_INPUT_SHA, settingsSha256: videoMotionSettingsSha256V1(MOTION_STACK),
	analysisWidth: 4, analysisHeight: 4, startFrame: 0, endFrame: 2,
	transforms: [{
		frameNumber: 1,
		transform: { scale: 1, rotationRadians: 0, translateX: 0, translateY: 0, inlierCount: 0, meanError: 0 },
	}],
}));
export const MOTION: VideoMotionAnalysisReferenceV1 = Object.freeze({
	schemaVersion: 1, id: 'motion-1', sourceId: 'video-1', processorStackId: 'stack-1',
	inputSha256: MOTION_INPUT_SHA, settingsSha256: videoMotionSettingsSha256V1(MOTION_STACK),
	storageKey: `motion-sha256:${digest(MOTION_BYTES)}`, sha256: digest(MOTION_BYTES),
	byteLength: MOTION_BYTES.byteLength, startFrame: 0, endFrame: 2,
});
export const STORED: Readonly<Record<string, Json>> = {
	'still-body': { size: STILL_BYTES.byteLength, sha256: digest(STILL_BYTES), mimeType: 'image/png' },
	'video-proxy-body': { size: PROXY_BYTES.byteLength, sha256: digest(PROXY_BYTES), mimeType: 'video/mp4' },
	[TIMING.reference.storageKey]: {
		size: TIMING.bytes.byteLength, sha256: TIMING.reference.sha256, mimeType: TIMING_MIME,
	},
	'cube-lut-body': { size: LUT.byteLength, sha256: LUT.sha256, mimeType: 'text/plain' },
	[MOTION.storageKey]: { size: MOTION_BYTES.byteLength, sha256: MOTION.sha256, mimeType: MOTION_MIME },
};

export function stillSource(overrides: Json = {}): Json {
	return {
		id: 'still-1', kind: 'still', mimeType: 'image/png', storageKey: 'still-body',
		contentSha256: digest(STILL_BYTES), ...overrides,
	};
}

export function proxiedVideoSource(overrides: Json = {}): Json {
	return {
		id: 'video-1', kind: 'video', mimeType: 'video/mp4', storageKey: 'video-body',
		proxyAttachment: {
			storageKey: 'video-proxy-body', mimeType: 'video/mp4', byteLength: PROXY_BYTES.byteLength,
			sha256: digest(PROXY_BYTES), timingAsset: TIMING.reference,
		},
		...overrides,
	};
}

export function lutReference(overrides: Partial<VideoCubeLutReferenceV1> = {}): VideoCubeLutReferenceV1 {
	return {
		storageKey: 'cube-lut-body', sha256: LUT.sha256, byteLength: LUT.byteLength, size: LUT.size,
		domainMin: LUT.domainMin, domainMax: LUT.domainMax, ...overrides,
	};
}

export function presentation(lut: VideoCubeLutReferenceV1 | null): Json {
	return { id: 'presentation-1', grade: lut === null ? null : { lut } };
}

export function preset(lut: VideoCubeLutReferenceV1 | null): Json {
	return { id: 'preset-1', template: { grade: lut === null ? null : { lut } } };
}

export function stored(storageKey: string, overrides: Json): Json {
	return { ...STORED[storageKey], ...overrides };
}

export function store(
	overrides: Readonly<Record<string, Json | null>> = {},
	options: Readonly<{ calls?: string[]; onCall?: () => void }> = {},
): { getMediaAssetMetadata(storageKey: string): Promise<unknown> } {
	const entries: Record<string, Json | null> = { ...STORED, ...overrides };
	return {
		getMediaAssetMetadata(storageKey: string): Promise<unknown> {
			options.calls?.push(storageKey);
			options.onCall?.();
			return Promise.resolve(entries[storageKey] ?? null);
		},
	};
}

export function descriptorFor(reference: FramescaperDurableScapeAssetReference): ScapeAssetDescriptor {
	return {
		sourceId: reference.archiveId, kind: reference.kind, encoding: reference.encoding,
		entry: reference.entry, mimeType: reference.mimeType, sha256: reference.sha256,
		size: reference.byteLength ?? STILL_BYTES.byteLength,
	};
}

export function manifest(assets: readonly ScapeAssetDescriptor[]): ScapeManifest {
	return { assets: [...assets] } as unknown as ScapeManifest;
}

export function blob(bytes: Uint8Array): Blob {
	return new Blob([bytes.slice().buffer as ArrayBuffer]);
}

export function digest(bytes: Uint8Array): string {
	return bytesToHex(sha256(bytes));
}
