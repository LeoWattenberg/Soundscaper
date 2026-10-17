/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from './closed-domain-value.ts';
import { planPixelFrameV1, readPixelFrameV1, type PixelFrameDescriptorV1 } from './imaging/pixel-frame-contract-v1.ts';
import type { VideoLuminanceRangeMaskNodeV1, VideoMaskMatteGraphV1 } from './video-mask-matte-v24.ts';

export interface VideoMaskCurrentFrameV1 {
	readonly descriptor: Readonly<PixelFrameDescriptorV1>;
	readonly pixels: Uint8Array<ArrayBuffer>;
}
export interface CapturedVideoMaskLuminanceFrameV1 {
	readonly pixels: Uint8Array<ArrayBuffer>;
	readonly transfer: 'srgb' | 'linear';
}

/** Unreachable range nodes acquire no current-frame authority. */
export function videoMaskMatteUsesCurrentFrameV1(graph: Readonly<VideoMaskMatteGraphV1>): boolean {
	const nodes = new Map(graph.nodes.map(node => [node.id, node])), seen = new Set<string>();
	const visit = (id: string): boolean => {
		if (seen.has(id)) return false; seen.add(id);
		const node = nodes.get(id)!;
		if (node.kind === 'luminance-range' || node.kind === 'color-range') return true;
		if (node.kind === 'feather' || node.kind === 'invert') return visit(node.inputNodeId);
		return node.kind === 'boolean' && node.inputNodeIds.some(visit);
	};
	return visit(graph.outputNodeId);
}

/** Admit declared geometry/profile before reading and privately copying bytes. */
export function captureVideoMaskLuminanceFrameV1(value: unknown, width: number, height: number): Readonly<CapturedVideoMaskLuminanceFrameV1> {
	const input = record(value, 'mask current frame', ['descriptor', 'pixels']);
	const plan = planPixelFrameV1(field(input, 'descriptor', 'mask current frame'), { maximumPixels: 33_554_432, maximumBytes: 128 * 1024 * 1024 });
	const descriptor = plan.descriptor;
	if (descriptor.width !== width || descriptor.height !== height) throw new RangeError('Mask current frame must match the exact mask extent.');
	if (descriptor.sampleFormat !== 'unorm8' || descriptor.primaries !== 'srgb'
		|| (descriptor.transfer !== 'srgb' && descriptor.transfer !== 'linear')) throw new RangeError('Mask current frame requires declared linear or encoded sRGB UNORM8 pixels.');
	const frame = readPixelFrameV1(input);
	if (!(frame.pixels instanceof Uint8Array)) throw new TypeError('Mask current frame requires native Uint8Array pixels.');
	const pixels = new Uint8Array(plan.byteLength); Uint8Array.prototype.set.call(pixels, frame.pixels);
	return Object.freeze({ pixels, transfer: descriptor.transfer });
}

/** Straight-alpha, decoded linear Rec709 luminance; hidden RGB contributes zero. */
export function videoMaskLuminanceRangeCoverageV1(node: Readonly<VideoLuminanceRangeMaskNodeV1>,
	frame: Readonly<CapturedVideoMaskLuminanceFrameV1>, pixelIndex: number): number {
	const offset = pixelIndex * 4, pixels = frame.pixels;
	if (pixels[offset + 3] === 0) return 0;
	const linear = frame.transfer === 'linear';
	const luminance = decode(pixels[offset]!, linear) * 0.2126 + decode(pixels[offset + 1]!, linear) * 0.7152 + decode(pixels[offset + 2]!, linear) * 0.0722;
	if (luminance >= node.lower && luminance <= node.upper) return 255;
	if (node.falloff === 0) return 0;
	const ramp = luminance < node.lower ? 1 - (node.lower - luminance) / node.falloff : 1 - (luminance - node.upper) / node.falloff;
	return Math.round(255 * Math.max(0, Math.min(1, ramp)));
}

function decode(byte: number, linear: boolean): number {
	const sample = byte / 255;
	return linear || sample <= 0.04045 ? (linear ? sample : sample / 12.92) : ((sample + 0.055) / 1.055) ** 2.4;
}
