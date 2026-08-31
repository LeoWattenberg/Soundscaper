/* SPDX-License-Identifier: AGPL-3.0-only */

/** Similarity-motion composition and RGBA warp math for selected finishing. */

import {
	createGrayVideoFrameV1,
	type GrayVideoFrameV1,
	type VideoSimilarityTransformV1,
} from './video-motion-processing-v27.ts';
import type { UnifiedExactRenderRgbaFrameV13 } from './unified-exact-render-finishing-consumers-v13.ts';

/** Compose first then second. */
export function composeMotion(
	first: VideoSimilarityTransformV1,
	second: VideoSimilarityTransformV1,
): VideoSimilarityTransformV1 {
	const cosine = Math.cos(second.rotationRadians) * second.scale;
	const sine = Math.sin(second.rotationRadians) * second.scale;
	return Object.freeze({
		scale: first.scale * second.scale,
		rotationRadians: first.rotationRadians + second.rotationRadians,
		translateX: cosine * first.translateX - sine * first.translateY + second.translateX,
		translateY: sine * first.translateX + cosine * first.translateY + second.translateY,
		inlierCount: Math.min(first.inlierCount, second.inlierCount),
		meanError: first.meanError + second.meanError,
	});
}

export function invertMotion(value: VideoSimilarityTransformV1): VideoSimilarityTransformV1 {
	const scale = 1 / value.scale;
	const rotationRadians = -value.rotationRadians;
	const cosine = Math.cos(rotationRadians) * scale;
	const sine = Math.sin(rotationRadians) * scale;
	return Object.freeze({
		scale, rotationRadians,
		translateX: -(cosine * value.translateX - sine * value.translateY),
		translateY: -(sine * value.translateX + cosine * value.translateY),
		inlierCount: value.inlierCount,
		meanError: value.meanError,
	});
}

export function warpApplied(
	frame: UnifiedExactRenderRgbaFrameV13,
	applied: VideoSimilarityTransformV1,
	signal?: AbortSignal,
): UnifiedExactRenderRgbaFrameV13 {
	const sourceTransform = invertMotion(applied);
	const cosine = Math.cos(sourceTransform.rotationRadians) * sourceTransform.scale;
	const sine = Math.sin(sourceTransform.rotationRadians) * sourceTransform.scale;
	const pixels = new Uint8Array(frame.pixels.byteLength);
	for (let y = 0; y < frame.height; y += 1) {
		throwIfAborted(signal);
		for (let x = 0; x < frame.width; x += 1) {
			const sourceX = cosine * x - sine * y + sourceTransform.translateX;
			const sourceY = sine * x + cosine * y + sourceTransform.translateY;
			const offset = (y * frame.width + x) * 4;
			if (sourceX < 0 || sourceY < 0 || sourceX > frame.width - 1 || sourceY > frame.height - 1) continue;
			for (let channel = 0; channel < 4; channel += 1) {
				pixels[offset + channel] = Math.round(sample(frame, sourceX, sourceY, channel));
			}
		}
	}
	return Object.freeze({ width: frame.width, height: frame.height, pixels });
}

function sample(
	frame: UnifiedExactRenderRgbaFrameV13,
	x: number,
	y: number,
	channel: number,
): number {
	const x0 = Math.floor(x);
	const y0 = Math.floor(y);
	const x1 = Math.min(frame.width - 1, x0 + 1);
	const y1 = Math.min(frame.height - 1, y0 + 1);
	const mixX = x - x0;
	const mixY = y - y0;
	const pixel = (px: number, py: number) => frame.pixels[(py * frame.width + px) * 4 + channel]!;
	const top = pixel(x0, y0) + (pixel(x1, y0) - pixel(x0, y0)) * mixX;
	const bottom = pixel(x0, y1) + (pixel(x1, y1) - pixel(x0, y1)) * mixX;
	return top + (bottom - top) * mixY;
}

export function channelFrame(frame: UnifiedExactRenderRgbaFrameV13, channel: number): GrayVideoFrameV1 {
	const samples = Array.from({ length: frame.width * frame.height }, (_, index) => (
		frame.pixels[index * 4 + channel]! / 255
	));
	return createGrayVideoFrameV1({ width: frame.width, height: frame.height, samples });
}

export function writeChannel(pixels: Uint8Array, channel: number, frame: GrayVideoFrameV1): void {
	frame.samples.forEach((sample, index) => { pixels[index * 4 + channel] = Math.round(sample * 255); });
}


function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason instanceof Error) throw signal.reason;
	throw new DOMException('The V13 finishing frame request was aborted.', 'AbortError');
}
