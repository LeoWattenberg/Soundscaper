/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createVideoKeyframeExportInventory,
} from '../common/editor/video-keyframe-export-inventory.ts';
import {
	createVideoKeyframeExportPlanV7,
	type VideoKeyframeExportPlanFormatV7,
	type VideoKeyframeExportPlanV7,
} from '../common/editor/video-keyframe-export-plan-v7.ts';
import { resolveExactVideoExportCanvas } from '../common/editor/video-export.js';
import { isVideoCanvasFit, type VideoCanvasFit } from '../common/editor/video-canvas-fit.ts';
import {
	normalizeVideoDeliveryQuality,
	type VideoDeliveryQuality,
} from '../common/editor/video-delivery-quality.ts';
import {
	normalizeVideoDeliveryAudioLayout,
	type VideoDeliveryAudioLayout,
} from '../common/editor/video-delivery-audio-layout.ts';
import {
	assertFramescaperProjectV20Profile,
	type FramescaperProjectV20Profile,
} from './editor-project-v20-profile.ts';
import { framescaperProjectForRuntimeConsumersV20 } from './editor-project-v20-runtime.ts';
import {
	validateFramescaperProjectV20,
	type FramescaperProjectV20,
} from './editor-project-v20-validation.ts';
import {
	classifyFramescaperVideoExportDispatchV20,
	type FramescaperVideoExportRangeRequestV20,
} from './video-export-dispatch-v20.ts';

export interface FramescaperVideoKeyframeExportPlanRequestV20 {
	readonly format?: VideoKeyframeExportPlanFormatV7;
	readonly range?: FramescaperVideoExportRangeRequestV20;
	readonly includeAudio?: boolean;
	readonly audioFileName?: string;
	readonly canvas?: Readonly<{
		readonly size?: Readonly<{ readonly width: number; readonly height: number }>;
		readonly fit?: VideoCanvasFit;
		readonly width?: number;
		readonly height?: number;
		readonly frameRate?: number | Readonly<{ readonly num: number; readonly den: number }>;
		readonly backgroundColor?: string;
		readonly maximumWidth?: number;
		readonly maximumHeight?: number;
		readonly maximumFrameRate?: number | Readonly<{ readonly num: number; readonly den: number }>;
	}>;
	readonly quality?: VideoDeliveryQuality;
	readonly audioLayout?: VideoDeliveryAudioLayout;
}

interface ExactCanvas {
	readonly width: number;
	readonly height: number;
	readonly frameRate: Readonly<{ readonly num: number; readonly den: number }>;
	readonly fit: VideoCanvasFit;
	readonly pixelFormat: 'yuv420p';
	readonly backgroundColor: string;
	readonly referenceClipId: string | null;
	readonly referenceSourceId: string | null;
}

const REQUEST_FIELDS = [
	'format', 'range', 'includeAudio', 'audioFileName', 'canvas', 'quality', 'audioLayout',
] as const;
const CANVAS_FIELDS = [
	'size', 'fit', 'width', 'height', 'frameRate', 'backgroundColor',
	'maximumWidth', 'maximumHeight', 'maximumFrameRate',
] as const;

/** Build an unselected V7 plan only after exact V20 and keyed-range authentication. */
export function createFramescaperVideoKeyframeExportPlanV20(
	profile: FramescaperProjectV20Profile | unknown,
	projectValue: FramescaperProjectV20 | unknown,
	requestValue: FramescaperVideoKeyframeExportPlanRequestV20 | unknown = {},
): VideoKeyframeExportPlanV7 {
	assertFramescaperProjectV20Profile(profile);
	validateFramescaperProjectV20(profile, projectValue);
	const request = snapshotRequest(requestValue);
	const requestedRange = request.range ?? 'project';
	const decision = classifyFramescaperVideoExportDispatchV20(
		profile, projectValue, requestedRange,
	);
	if (decision.strategy !== 'keyed-v20') {
		throw new RangeError('The exact export range has no active authored keyframes; use legacy-v6 dispatch.');
	}
	const runtimeProject = framescaperProjectForRuntimeConsumersV20(profile, projectValue);
	const inventory = createVideoKeyframeExportInventory({
		project: runtimeProject,
		startFrame: decision.range.startFrame,
		endFrame: decision.range.endFrame,
	});
	assertSameIds(decision.activeClipIds, inventory.activeClipIds, 'clip');
	assertSameIds(decision.activeSourceIds, inventory.activeSourceIds, 'source');
	const canvas = resolveExactVideoExportCanvas(runtimeProject, {
		...(request.canvas ?? {}),
		range: Object.freeze({
			startFrame: decision.range.startFrame,
			endFrame: decision.range.endFrame,
		}),
	}) as ExactCanvas;
	assertFramescaperVideoKeyframeExportCanvasAuthorityV20(canvas, inventory.project.clips);
	const includeAudio = request.includeAudio ?? true;
	if (!includeAudio && request.audioFileName !== undefined) {
		throw new TypeError('audioFileName requires includeAudio to be true.');
	}
	return createVideoKeyframeExportPlanV7({
		format: request.format ?? 'mp4',
		sampleRate: positiveInteger(runtimeProject.sampleRate, 'project.sampleRate'),
		range: decision.range,
		canvas: {
			width: canvas.width,
			height: canvas.height,
			frameRate: canvas.frameRate,
			fit: canvas.fit,
			pixelFormat: 'yuv420p',
			backgroundColor: canvas.backgroundColor,
			referenceClipId: canvas.referenceClipId,
			referenceSourceId: canvas.referenceSourceId,
		},
		activeClipIds: inventory.activeClipIds,
		activeSourceIds: inventory.activeSourceIds,
		sources: inventory.project.sources,
		includeAudio,
		...(request.quality === undefined ? {} : { quality: request.quality }),
		...(request.audioLayout === undefined ? {} : { audioLayout: request.audioLayout }),
		...(request.audioFileName === undefined ? {} : { audioFileName: request.audioFileName }),
	});
}

function snapshotRequest(value: unknown): FramescaperVideoKeyframeExportPlanRequestV20 {
	const request = closedRecord(value, REQUEST_FIELDS, 'Framescaper keyed export request');
	const result: Record<string, unknown> = {};
	if (Object.hasOwn(request, 'format')) {
		const format = data(request, 'format', 'Framescaper keyed export request');
		if (format !== 'mp4' && format !== 'webm') throw new RangeError('Framescaper keyed export format must be mp4 or webm.');
		result.format = format;
	}
	if (Object.hasOwn(request, 'range')) result.range = snapshotRange(data(request, 'range', 'Framescaper keyed export request'));
	if (Object.hasOwn(request, 'includeAudio')) {
		const includeAudio = data(request, 'includeAudio', 'Framescaper keyed export request');
		if (typeof includeAudio !== 'boolean') throw new TypeError('Framescaper keyed export includeAudio must be boolean.');
		result.includeAudio = includeAudio;
	}
	if (Object.hasOwn(request, 'audioFileName')) {
		const fileName = data(request, 'audioFileName', 'Framescaper keyed export request');
		if (typeof fileName !== 'string') throw new TypeError('Framescaper keyed export audioFileName must be a string.');
		result.audioFileName = fileName;
	}
	if (Object.hasOwn(request, 'canvas')) result.canvas = snapshotCanvas(data(request, 'canvas', 'Framescaper keyed export request'));
	if (Object.hasOwn(request, 'quality')) {
		result.quality = normalizeVideoDeliveryQuality(
			data(request, 'quality', 'Framescaper keyed export request'),
			'Framescaper keyed export quality',
		);
	}
	if (Object.hasOwn(request, 'audioLayout')) {
		result.audioLayout = normalizeVideoDeliveryAudioLayout(
			data(request, 'audioLayout', 'Framescaper keyed export request'),
			'Framescaper keyed export audioLayout',
		);
	}
	return Object.freeze(result) as FramescaperVideoKeyframeExportPlanRequestV20;
}

function snapshotRange(value: unknown): FramescaperVideoExportRangeRequestV20 {
	if (value === 'project' || value === 'selection' || value === 'loop') return value;
	const range = closedRecord(value, ['startFrame', 'endFrame'], 'Framescaper keyed export range');
	if (Reflect.ownKeys(range).length !== 2) throw new TypeError('Framescaper keyed export range requires startFrame and endFrame.');
	return Object.freeze({
		startFrame: nonNegativeInteger(data(range, 'startFrame', 'Framescaper keyed export range'), 'range.startFrame'),
		endFrame: nonNegativeInteger(data(range, 'endFrame', 'Framescaper keyed export range'), 'range.endFrame'),
	});
}

function snapshotCanvas(value: unknown): Readonly<Record<string, unknown>> {
	const canvas = closedRecord(value, CANVAS_FIELDS, 'Framescaper keyed export canvas');
	const result: Record<string, unknown> = {};
	for (const key of CANVAS_FIELDS) {
		if (!Object.hasOwn(canvas, key)) continue;
		const candidate = data(canvas, key, 'Framescaper keyed export canvas');
		if (key === 'frameRate' || key === 'maximumFrameRate') result[key] = snapshotRate(candidate, `canvas.${key}`);
		else if (key === 'backgroundColor') {
			if (typeof candidate !== 'string') throw new TypeError('canvas.backgroundColor must be a string.');
			result[key] = candidate;
		} else if (key === 'size') result[key] = snapshotSize(candidate);
		else if (key === 'fit') {
			if (!isVideoCanvasFit(candidate)) throw new RangeError('canvas.fit is unsupported.');
			result[key] = candidate;
		} else result[key] = positiveInteger(candidate, `canvas.${key}`);
	}
	return Object.freeze(result);
}

/**
 * A stated delivery canvas, passed through untouched for the shared resolver to
 * validate. Nothing is capped or rounded here: a keyed export answers to the
 * same canvas rules as every other one, and the encoder's own frame-byte limit
 * refuses what it cannot stream when the plan is built.
 */
function snapshotSize(value: unknown): Readonly<{ width: number; height: number }> {
	const size = closedRecord(value, ['width', 'height'], 'Framescaper keyed export canvas size');
	return Object.freeze({
		width: positiveInteger(data(size, 'width', 'canvas.size'), 'canvas.size.width'),
		height: positiveInteger(data(size, 'height', 'canvas.size'), 'canvas.size.height'),
	});
}

function snapshotRate(value: unknown, name: string): number | Readonly<{ num: number; den: number }> {
	if (typeof value === 'number') {
		if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be positive.`);
		return value;
	}
	const rate = closedRecord(value, ['num', 'den'], name);
	if (Reflect.ownKeys(rate).length !== 2) throw new TypeError(`${name} requires num and den.`);
	return Object.freeze({
		num: positiveInteger(data(rate, 'num', name), `${name}.num`),
		den: positiveInteger(data(rate, 'den', name), `${name}.den`),
	});
}

/** Refuse a detached canvas authority that splices independently active IDs. */
export function assertFramescaperVideoKeyframeExportCanvasAuthorityV20(
	canvas: ExactCanvas,
	clips: readonly Readonly<Record<string, unknown>>[],
): void {
	if (canvas.referenceClipId === null || canvas.referenceSourceId === null) {
		throw new RangeError('A keyed export range requires one exact canvas reference clip/source pair.');
	}
	const clip = clips.find((candidate) => data(candidate, 'id', 'active video clip') === canvas.referenceClipId);
	if (!clip || data(clip, 'sourceId', 'canvas reference clip') !== canvas.referenceSourceId) {
		throw new Error('The range-scoped canvas reference clip does not bind its reference source.');
	}
}

function assertSameIds(left: readonly string[], right: readonly string[], kind: string): void {
	if (left.length !== right.length || left.some((value, index) => value !== right[index])) {
		throw new Error(`Framescaper keyed export ${kind} inventory changed during planning.`);
	}
}

function closedRecord(
	value: unknown,
	fields: readonly string[],
	name: string,
): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be a plain record.`);
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${name} must be a plain record.`);
	const record = value as Readonly<Record<string, unknown>>;
	for (const key of Reflect.ownKeys(record)) {
		if (typeof key !== 'string' || !fields.includes(key)) throw new TypeError(`${name} has an unsupported field.`);
		const descriptor = Object.getOwnPropertyDescriptor(record, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
		}
	}
	return record;
}

function data(value: object, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
	}
	return descriptor.value;
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return value;
}

function positiveInteger(value: unknown, name: string): number {
	const result = nonNegativeInteger(value, name);
	if (result === 0) throw new RangeError(`${name} must be positive.`);
	return result;
}
