/* SPDX-License-Identifier: AGPL-3.0-only */

import { straightUnifiedExactLinearFrameV13, type UnifiedExactLinearPremultipliedFrameV13 } from '../common/editor/unified-exact-linear-rgba-v13.ts';
import { evaluateVideoMaskMatteRgbaV13, type VideoMaskMatteRgbaInputV13 } from '../common/editor/video-mask-matte-rgba-v13.ts';
import { normalizeVideoMaskMatteGraphV1, videoMaskMatteWorkingBytesV1, VIDEO_MASK_MATTE_WORKING_LIMIT_V1,
	type VideoMaskMatteGraphV1 } from '../common/editor/video-mask-matte-v24.ts';
import { videoMaskMatteUsesCurrentFrameV1 } from '../common/editor/video-mask-luminance-range-v1.ts';
import { combinedGraphs } from './selected-finishing-exact-frame-support.ts';

const CHECK = AbortSignal.prototype.throwIfAborted, FILL = Uint8Array.prototype.fill;
type Inputs = ReadonlyMap<string, VideoMaskMatteRgbaInputV13>;
type LinearFrame = UnifiedExactLinearPremultipliedFrameV13;

export function selectedFinishingMaskGraphsV1(ids: readonly string[], graphs: ReadonlyMap<string, unknown>): readonly unknown[] {
	return ids.map(id => { const graph = graphs.get(id); if (!graph) throw new ReferenceError(`Selected finishing mask ${id} is unavailable.`); return graph; });
}

export function admitSelectedFinishingLuminanceMasksV1(graphs: readonly unknown[], width: number, height: number): void {
	const normalized = graphs.map(normalizeVideoMaskMatteGraphV1);
	if (normalized.some(videoMaskMatteUsesCurrentFrameV1)) admit(normalized, width, height);
}

/** Legacy masks still enter the actual placement kernel at its original stage. */
export function legacySelectedFinishingMaskV1(graphs: readonly unknown[], width: number, height: number, inputs: Inputs): Uint8Array<ArrayBuffer> | undefined {
	if (!graphs.length) return undefined;
	const normalized = graphs.map(normalizeVideoMaskMatteGraphV1);
	if (normalized.some(videoMaskMatteUsesCurrentFrameV1)) { admit(normalized, width, height); return undefined; }
	return combinedGraphs(graphs, width, height, inputs);
}

/** Presentation ranges sample the actual post-finishing, placed picture. */
export function applySelectedFinishingLuminanceMaskV1(frame: LinearFrame, graphs: readonly unknown[], inputs: Inputs, signal: AbortSignal): LinearFrame {
	const normalized = graphs.map(normalizeVideoMaskMatteGraphV1);
	if (!normalized.some(videoMaskMatteUsesCurrentFrameV1)) return frame;
	const coverage = currentCoverage(normalized, frame, inputs, signal);
	try {
		for (let index = 0; index < coverage.length; index++) {
			if (index % 65_536 === 0) Reflect.apply(CHECK, signal, []);
			const amount = coverage[index]! / 255, offset = index * 4;
			for (let channel = 0; channel < 4; channel++) frame.pixels[offset + channel] = frame.pixels[offset + channel]! * amount;
		}
		return frame;
	} finally { Reflect.apply(FILL, coverage, [0]); }
}

/** Adjustment ranges sample the incoming composition before their operations. */
export function selectedFinishingCompositionRangeMaskV1(graphs: readonly unknown[], frame: LinearFrame, inputs: Inputs, signal: AbortSignal): Uint8Array<ArrayBuffer> | undefined {
	const normalized = graphs.map(normalizeVideoMaskMatteGraphV1);
	return normalized.some(videoMaskMatteUsesCurrentFrameV1) ? currentCoverage(normalized, frame, inputs, signal) : undefined;
}

function currentCoverage(graphs: readonly VideoMaskMatteGraphV1[], frame: LinearFrame, inputs: Inputs, signal: AbortSignal): Uint8Array<ArrayBuffer> {
	Reflect.apply(CHECK, signal, []); admit(graphs, frame.width, frame.height);
	// Actual exact composition is premultiplied Float64 linear Rec709/D65.
	// This explicit conversion unpremultiplies and rounds to straight linear
	// UNORM8; sRGB shares its primaries, and no transfer decode is applied again.
	const current = straightUnifiedExactLinearFrameV13(frame);
	let combined: Uint8Array<ArrayBuffer> | undefined, delivered = false;
	try {
		combined = new Uint8Array(frame.width * frame.height); combined.fill(255);
		const declared = { descriptor: { schemaVersion: 1, width: frame.width, height: frame.height,
			sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'linear' }, pixels: current.pixels };
		for (const graph of graphs) {
			Reflect.apply(CHECK, signal, []);
			const plane = evaluateVideoMaskMatteRgbaV13(graph, frame.width, frame.height, inputs, declared);
			try {
				for (let index = 0; index < combined.length; index++) {
					if (index % 65_536 === 0) Reflect.apply(CHECK, signal, []);
					combined[index] = Math.round(combined[index]! * plane[index]! / 255);
				}
			} finally { Reflect.apply(FILL, plane, [0]); }
		}
		Reflect.apply(CHECK, signal, []); delivered = true; return combined;
	} finally { Reflect.apply(FILL, current.pixels, [0]); if (!delivered && combined) Reflect.apply(FILL, combined, [0]); }
}

function admit(graphs: readonly VideoMaskMatteGraphV1[], width: number, height: number): void {
	// Retain every graph cache conservatively, plus the conversion and combined
	// plane. Each reachable range already counts its private RGBA signal copy.
	const bytes = graphs.reduce((sum, graph) => sum + BigInt(videoMaskMatteWorkingBytesV1(graph, width, height)), BigInt(width) * BigInt(height) * 5n);
	if (bytes > BigInt(VIDEO_MASK_MATTE_WORKING_LIMIT_V1)) throw new RangeError('Selected finishing luminance masks exceed their 64 MiB working budget.');
}
