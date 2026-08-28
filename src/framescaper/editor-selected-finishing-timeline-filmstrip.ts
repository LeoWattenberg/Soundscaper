/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	resolveRuntimeProjectProjection,
	type RuntimeClipProject,
} from '../common/editor/runtime-clip-projection.ts';
import type { AudioEditorProjectStore } from '../common/editor/storage.js';
import type {
	ProductVideoTimelineFilmstripFrame,
	ProductVideoTimelineFilmstripRequest,
} from '../common/editor/ui/workspace/product-video-visual-preview-runtime.ts';
import { createVideoKeyframeRenderStateProvider } from '../common/editor/video-keyframe-render-state-provider.ts';
import { resolveVideoKeyframePreviewState } from '../common/editor/video-keyframe-preview-state.ts';
import { resolveVideoSourceDisplaySize } from '../common/editor/video-source-presentation.ts';
import { resolveActiveVideoLayers } from '../common/editor/video-timeline.js';
import { createFramescaperSelectedVisualPreviewSessionFinishing } from './editor-selected-finishing-visual-preview.ts';

type Data = Readonly<Record<string, unknown>>;

interface DecodedFilmstripSourceFinishing {
	readonly drawable: unknown;
	readonly width: number;
	readonly height: number;
	dispose(): void;
}

type DecodeFilmstripSourceFinishing = (
	url: string,
	width: number,
	height: number,
	signal: AbortSignal,
) => Promise<DecodedFilmstripSourceFinishing>;

export interface FramescaperSelectedTimelineFilmstripOptionsFinishing
	extends ProductVideoTimelineFilmstripRequest {
	readonly profile: unknown;
	readonly store: AudioEditorProjectStore;
	/** Test seam; selected production routes always use browser image decode. */
	readonly decodeSource?: DecodeFilmstripSourceFinishing;
}

/** Render existing derivative cells through the selected exact V13 presentation session. */
export async function createFramescaperSelectedTimelineFilmstripFinishing(
	options: FramescaperSelectedTimelineFilmstripOptionsFinishing,
): Promise<readonly ProductVideoTimelineFilmstripFrame[] | null> {
	const frames = filmstripFrames(options?.frames);
	const signal = options.signal ?? new AbortController().signal;
	throwIfAborted(signal);
	if (frames.length === 0) return Object.freeze([]);
	const width = evenDimension(options.width, 'timeline filmstrip width');
	const height = evenDimension(options.height, 'timeline filmstrip height');
	const runtimeProject = resolveRuntimeProjectProjection(options.project as RuntimeClipProject);
	const keyframeState = createVideoKeyframeRenderStateProvider();
	const session = await createFramescaperSelectedVisualPreviewSessionFinishing({
		profile: options.profile,
		project: options.project,
		store: options.store,
		width,
		height,
	});
	if (session === null) return null;
	if (typeof session.renderExact !== 'function') {
		session.dispose();
		throw new Error('Selected finishing timeline thumbnails require exact preview execution.');
	}
	const decode = options.decodeSource ?? decodeFilmstripSource;
	const output: ProductVideoTimelineFilmstripFrame[] = [];
	try {
		for (const frame of frames) {
			throwIfAborted(signal);
			const active = activeFilmstripEntry(
				runtimeProject, frame, { width, height }, keyframeState,
			);
			const decoded = await decode(frame.sourceUrl, width, height, signal);
			try {
				throwIfAborted(signal);
				const rendered = await session.renderExact({
					timelineSample: frame.timelineSample,
					mediaLayers: [mediaLayer(active, decoded)],
				});
				const pixels = readExactOutput(rendered.layers, signal);
				output.push(Object.freeze({
					key: frame.key,
					timelineSample: frame.timelineSample,
					width: pixels.width,
					height: pixels.height,
					pixels: pixels.pixels,
				}));
			} finally {
				decoded.dispose();
			}
		}
		return Object.freeze(output);
	} finally {
		session.dispose();
	}
}

function activeFilmstripEntry(
	project: ReturnType<typeof resolveRuntimeProjectProjection>,
	frame: ProductVideoTimelineFilmstripRequest['frames'][number],
	canvas: Readonly<{ width: number; height: number }>,
	keyframeState: ReturnType<typeof createVideoKeyframeRenderStateProvider>,
): Readonly<{ layer: Data; clip: Data }> {
	const layers = resolveActiveVideoLayers(project, frame.timelineSample, {
		renderCanvas: canvas,
		resolveClipRenderState: (request: Parameters<typeof resolveVideoKeyframePreviewState>[1]) => (
			resolveVideoKeyframePreviewState(keyframeState, request)
		),
	});
	for (const layerValue of layers) {
		const layer = record(layerValue, 'timeline filmstrip layer');
		for (const clipValue of records(layer.clips, 'timeline filmstrip layer clips')) {
			if (clipValue.clipId !== frame.clipId) continue;
			if (clipValue.sourceId !== frame.sourceId) {
				throw new Error(`Timeline filmstrip clip ${frame.clipId} changed source authority.`);
			}
			return Object.freeze({ layer, clip: clipValue });
		}
	}
	throw new ReferenceError(`Timeline filmstrip clip ${frame.clipId} is not active at its requested sample.`);
}

function mediaLayer(
	active: Readonly<{ layer: Data; clip: Data }>,
	decoded: DecodedFilmstripSourceFinishing,
): Data {
	const source = record(active.clip.source, 'timeline filmstrip source');
	const size = resolveVideoSourceDisplaySize(source) ?? {
		width: decoded.width,
		height: decoded.height,
	};
	const effects = active.clip.videoEffects ?? record(active.clip.clip, 'timeline filmstrip clip').videoEffects ?? [];
	if (!Array.isArray(effects)) throw new TypeError('Timeline filmstrip video effects must be an array.');
	return Object.freeze({
		trackId: stableId(active.layer.trackId, 'timeline filmstrip track ID'),
		trackIndex: nonNegativeInteger(active.layer.trackIndex, 'timeline filmstrip track index'),
		entries: Object.freeze([Object.freeze({
			kind: 'video',
			role: active.clip.role,
			clipId: stableId(active.clip.clipId, 'timeline filmstrip clip ID'),
			sourceId: stableId(active.clip.sourceId, 'timeline filmstrip source ID'),
			available: true,
			video: Object.freeze({
				drawable: decoded.drawable,
				videoWidth: decoded.width,
				videoHeight: decoded.height,
				readyState: 4,
				currentTime: 0,
				pause() {},
			}),
			effects: Object.freeze([...effects]),
			opacity: active.clip.opacity,
			displayWidth: size.width,
			displayHeight: size.height,
			renderDescription: active.clip.renderDescription,
			intervalProgress: 0,
		})]),
	});
}

async function decodeFilmstripSource(
	url: string,
	maximumWidth: number,
	maximumHeight: number,
	signal: AbortSignal,
): Promise<DecodedFilmstripSourceFinishing> {
	if (typeof globalThis.fetch !== 'function' || typeof globalThis.createImageBitmap !== 'function'
		|| !globalThis.document?.createElement) {
		throw new Error('Selected finishing timeline thumbnail decode requires a browser image runtime.');
	}
	const response = await globalThis.fetch(url, { signal });
	if (!response.ok) throw new Error(`Timeline thumbnail decode failed with HTTP ${String(response.status)}.`);
	const bitmap = await globalThis.createImageBitmap(await response.blob());
	try {
		throwIfAborted(signal);
		const scale = Math.min(1, maximumWidth / bitmap.width, maximumHeight / bitmap.height);
		const width = Math.max(1, Math.round(bitmap.width * scale));
		const height = Math.max(1, Math.round(bitmap.height * scale));
		const canvas = globalThis.document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const context = canvas.getContext('2d', { alpha: true });
		if (!context) throw new Error('Selected finishing timeline thumbnail decode has no 2D context.');
		context.drawImage(bitmap, 0, 0, width, height);
		return Object.freeze({
			drawable: canvas, width, height,
			dispose() { context.clearRect(0, 0, width, height); },
		});
	} finally {
		bitmap.close();
	}
}

function readExactOutput(
	layersValue: readonly Readonly<Record<string, unknown>>[],
	signal: AbortSignal,
): Readonly<{ width: number; height: number; pixels: Uint8Array<ArrayBuffer> }> {
	throwIfAborted(signal);
	const entries = layersValue.flatMap((layer, layerIndex) => records(
		record(layer, `timeline filmstrip output layer ${String(layerIndex)}`).entries,
		`timeline filmstrip output layer ${String(layerIndex)} entries`,
	));
	if (entries.length !== 1) throw new RangeError('Timeline filmstrip exact output must have one entry.');
	const video = record(entries[0]!.video, 'timeline filmstrip exact output drawable');
	const width = positiveInteger(video.videoWidth, 'timeline filmstrip exact output width');
	const height = positiveInteger(video.videoHeight, 'timeline filmstrip exact output height');
	const drawable = video.drawable;
	if (!drawable || typeof drawable !== 'object') throw new TypeError('Timeline filmstrip output canvas is unavailable.');
	const getContext = (drawable as { getContext?: unknown }).getContext;
	if (typeof getContext !== 'function') throw new TypeError('Timeline filmstrip output has no canvas context.');
	const context = getContext.call(drawable, '2d', { willReadFrequently: true }) as {
		getImageData?: (x: number, y: number, width: number, height: number) => { data: Uint8ClampedArray };
	} | null;
	if (!context || typeof context.getImageData !== 'function') {
		throw new Error('Timeline filmstrip output has no readable 2D context.');
	}
	const data = context.getImageData(0, 0, width, height).data;
	throwIfAborted(signal);
	if (!(data instanceof Uint8ClampedArray) || data.byteLength !== width * height * 4) {
		throw new RangeError('Timeline filmstrip output geometry changed.');
	}
	return Object.freeze({
		width, height,
		pixels: Uint8Array.from(data) as Uint8Array<ArrayBuffer>,
	});
}

function filmstripFrames(value: unknown): ProductVideoTimelineFilmstripRequest['frames'] {
	if (!Array.isArray(value)) throw new TypeError('Timeline filmstrip frames must be an array.');
	if (value.length > 256) throw new RangeError('Timeline filmstrip requests are limited to 256 frames.');
	const keys = new Set<string>();
	return Object.freeze(value.map((item, index) => {
		const frame = record(item, `timeline filmstrip frame ${String(index)}`);
		const key = text(frame.key, 'timeline filmstrip frame key', 1_024);
		if (keys.has(key)) throw new RangeError(`Timeline filmstrip frame key ${key} is duplicated.`);
		keys.add(key);
		return Object.freeze({
			key,
			clipId: stableId(frame.clipId, 'timeline filmstrip clip ID'),
			sourceId: stableId(frame.sourceId, 'timeline filmstrip source ID'),
			timelineSample: nonNegativeInteger(frame.timelineSample, 'timeline filmstrip sample'),
			sourceUrl: text(frame.sourceUrl, 'timeline filmstrip source URL', 1_048_576),
		});
	}));
}

function evenDimension(value: unknown, name: string): number {
	const number = positiveInteger(value, name);
	return Math.max(2, number - number % 2);
}

function positiveInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) throw new RangeError(`${name} must be positive.`);
	return Number(value);
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be non-negative.`);
	return Number(value);
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
		throw new TypeError(`${name} must be a stable ID.`);
	}
	return value;
}

function text(value: unknown, name: string, maximum: number): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > maximum) {
		throw new TypeError(`${name} must be non-empty bounded text.`);
	}
	return value;
}

function record(value: unknown, name: string): Data {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Data;
}

function records(value: unknown, name: string): Data[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => record(item, `${name}[${String(index)}]`));
}

function throwIfAborted(signal: AbortSignal): void {
	if (signal.aborted) throw signal.reason ?? new DOMException('Timeline filmstrip rendering was cancelled.', 'AbortError');
}
