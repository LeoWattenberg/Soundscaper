/* SPDX-License-Identifier: AGPL-3.0-only */

import type { VideoKeyframeExportFrame } from '../../src/common/editor/video-keyframe-export-frame-source.ts';
import type { VideoKeyframeOfflineVideoExportRequest } from '../../src/common/editor/ui/video-keyframe-offline-video-export.ts';
import type { UnifiedExactRenderRgbaFrameV13 } from '../../src/common/editor/unified-exact-render-finishing-consumers-v13.ts';

type Data = Readonly<Record<string, unknown>>;

export async function composeFramescaperExactExportTestFrame(
	request: VideoKeyframeOfflineVideoExportRequest,
	frameValue: unknown,
	target: Uint8Array<ArrayBuffer>,
	sourceRgba: readonly [number, number, number, number],
): Promise<void> {
	if (!request.rgbaCompositor) throw new Error('The exact export compositor is unavailable.');
	const frame = record(frameValue, 'test export frame');
	await request.rgbaCompositor({
		frame: frame as unknown as VideoKeyframeExportFrame,
		layers: exactLayers(frame, sourceRgba),
		width: request.canvas.width, height: request.canvas.height,
		rgba: target, signal: request.signal,
	});
}

export function captureFramescaperExactExportTestFrame(
	entry: Data,
): UnifiedExactRenderRgbaFrameV13 {
	const rgba = entry.testSourceRgba;
	if (!Array.isArray(rgba) || rgba.length !== 4
		|| rgba.some((channel) => !Number.isSafeInteger(channel)
			|| Number(channel) < 0 || Number(channel) > 255)) {
		throw new RangeError('The exact export test source pixel is invalid.');
	}
	return Object.freeze({
		width: 1, height: 1,
		pixels: Uint8Array.from(rgba as number[]) as Uint8Array<ArrayBuffer>,
	});
}

function exactLayers(frame: Data, rgba: readonly number[]) {
	const layers = array(frame.layers, 'test export layers');
	return Object.freeze(layers.map((layerValue, trackIndex) => {
		const layer = record(layerValue, 'test export layer');
		const clips = array(layer.clips, 'test export clips');
		return Object.freeze({
			trackId: typeof layer.trackId === 'string' ? layer.trackId : 'video-track',
			trackIndex,
			entries: Object.freeze(clips.map((clipValue, compositingOrder) => {
				const clip = record(clipValue, 'test export clip');
				const opacity = typeof clip.opacity === 'number' ? clip.opacity : 1;
				return Object.freeze({
					...clip, testSourceRgba: Object.freeze([...rgba]),
					displayWidth: 1, displayHeight: 1, intervalProgress: 0,
					renderDescription: Object.freeze({
						crop: Object.freeze({
							normalized: Object.freeze({ left: 0, top: 0, right: 0, bottom: 0 }),
							sourcePixels: Object.freeze({ x: 0, y: 0, width: 1, height: 1 }),
						}),
						sourceDisplayToCanvas: Object.freeze([1, 0, 0, 1, 0, 0]),
						opacityStart: opacity, opacityEnd: opacity,
						blendMode: 'normal', compositingOrder,
					}),
				});
			})),
		});
	}));
}

function record(value: unknown, name: string): Data {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as Data;
}

function array(value: unknown, name: string): unknown[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value;
}
