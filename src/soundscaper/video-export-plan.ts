/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ControllerProjectRuntime } from '../common/editor/controller/project-runtime.ts';
import type { VideoDeliveryAudioLayout } from '../common/editor/video-delivery-audio-layout.ts';
import type { VideoDeliveryQuality } from '../common/editor/video-delivery-quality.ts';
import {
	createVideoKeyframeExportInventory,
	type VideoKeyframeExportInventory,
} from '../common/editor/video-keyframe-export-inventory.ts';
import {
	createVideoKeyframeExportPlanV7,
	type VideoKeyframeExportPlanV7,
} from '../common/editor/video-keyframe-export-plan-v7.ts';
import type { VideoCanvasFit } from '../common/editor/video-canvas-fit.ts';
import { resolveExactVideoExportCanvas, resolveVideoExportRange } from '../common/editor/video-export.js';

export interface SoundscaperVideoKeyframeExportPlanRequest {
	readonly format: 'mp4' | 'webm';
	readonly range?: unknown;
	readonly includeAudio: boolean;
	readonly canvas?: unknown;
	readonly quality?: unknown;
	readonly audioLayout?: unknown;
	readonly captions?: unknown;
}

interface ExactCanvas {
	readonly width: number;
	readonly height: number;
	readonly frameRate: Readonly<{ readonly num: number; readonly den: number }>;
	readonly fit: VideoCanvasFit;
	readonly backgroundColor: string;
	readonly referenceClipId: string | null;
	readonly referenceSourceId: string | null;
}

/** Build one exact V7 plan from selected Soundscaper baseline runtime authority. */
export function createSoundscaperVideoKeyframeExportPlan(
	runtime: Pick<ControllerProjectRuntime, 'projectForRuntimeConsumers'>,
	project: Readonly<Record<string, unknown>>,
	request: SoundscaperVideoKeyframeExportPlanRequest,
): VideoKeyframeExportPlanV7 {
	if (request.captions != null) {
		throw new RangeError('The Soundscaper keyed desktop video path cannot deliver captions.');
	}
	if (request.format !== 'mp4' && request.format !== 'webm') {
		throw new RangeError('Soundscaper keyed video format must be mp4 or webm.');
	}
	const runtimeProject = runtime.projectForRuntimeConsumers(project) as Readonly<Record<string, unknown>>;
	const range = resolveVideoExportRange(runtimeProject, (request.range ?? 'project') as never);
	const inventory = createVideoKeyframeExportInventory({
		project: runtimeProject, startFrame: range.startFrame, endFrame: range.endFrame,
	});
	const canvas = resolveExactVideoExportCanvas(runtimeProject, {
		...canvasRequest(request.canvas), range,
	}) as ExactCanvas;
	assertSoundscaperVideoKeyframeExportCanvasAuthority(canvas, inventory);
	return createVideoKeyframeExportPlanV7({
		format: request.format,
		sampleRate: positiveInteger(runtimeProject.sampleRate, 'project.sampleRate'),
		range,
		canvas: {
			width: canvas.width, height: canvas.height, frameRate: canvas.frameRate,
			fit: canvas.fit, pixelFormat: 'yuv420p', backgroundColor: canvas.backgroundColor,
			referenceClipId: canvas.referenceClipId, referenceSourceId: canvas.referenceSourceId,
		},
		activeClipIds: inventory.activeClipIds,
		activeSourceIds: inventory.activeSourceIds,
		sources: inventory.project.sources,
		includeAudio: request.includeAudio,
		...(request.quality === undefined ? {} : { quality: request.quality as VideoDeliveryQuality }),
		...(request.audioLayout === undefined ? {} : {
			audioLayout: request.audioLayout as VideoDeliveryAudioLayout,
		}),
	});
}

/** Refuse a canvas reference spliced from independently active IDs. */
export function assertSoundscaperVideoKeyframeExportCanvasAuthority(
	canvas: ExactCanvas,
	inventory: VideoKeyframeExportInventory,
): void {
	if (canvas.referenceClipId === null || canvas.referenceSourceId === null
		|| !inventory.activeClipIds.includes(canvas.referenceClipId)
		|| !inventory.activeSourceIds.includes(canvas.referenceSourceId)) {
		throw new RangeError('A Soundscaper keyed export requires one active canvas reference clip/source pair.');
	}
	const clip = inventory.project.clips.find((candidate) => candidate.id === canvas.referenceClipId);
	if (clip?.sourceId !== canvas.referenceSourceId) {
		throw new Error('The Soundscaper canvas reference clip does not bind its active reference source.');
	}
}

function canvasRequest(value: unknown): Readonly<Record<string, unknown>> {
	if (value === undefined) return {};
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Soundscaper keyed video canvas must be a record.');
	}
	return value as Readonly<Record<string, unknown>>;
}

function positiveInteger(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return value;
}
