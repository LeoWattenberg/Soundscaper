/* SPDX-License-Identifier: AGPL-3.0-only */

import { VIDEO_MASK_MATTE_LIMITS_V1, type VideoMaskMatteGraphV1, type VideoMaskMatteNodeV1,
	type VideoLuminanceRangeMaskNodeV1, type VideoColorRangeMaskNodeV1 } from './video-mask-matte-v24.ts';
import type { VideoMaskMatteRgbaInputV13 } from './video-mask-matte-rgba-v13.ts';
import type { BrushMaskResourceV1 } from './imaging/brush-mask-resource-v1.ts';

/** Owning wrappers admit graph/body/frame authority and own every allocation.
 * Range sampling is separate from the unchanged byte coverage graph arithmetic. */
export interface VideoMaskMatteRangeSamplerV1 {
	luminance(node: Readonly<VideoLuminanceRangeMaskNodeV1>, pixelIndex: number): number;
	color(node: Readonly<VideoColorRangeMaskNodeV1>): (pixelIndex: number) => number;
}
const BUFFER_SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const CHUNK_PIXELS = 65_536;
type Plane = Uint8Array<ArrayBuffer>;
type Work = Generator<void, Plane, void>;

export function* evaluateVideoMaskMatteGraphWorkV1(graph: VideoMaskMatteGraphV1, width: number, height: number,
	inputs: ReadonlyMap<string, VideoMaskMatteRgbaInputV13>, allocate: (length: number) => Plane, ranges?: Readonly<VideoMaskMatteRangeSamplerV1>,
	brushInputs?: ReadonlyMap<string, Readonly<BrushMaskResourceV1>>): Work {
	const nodes = new Map(graph.nodes.map(node => [node.id, node])), cache = new Map<string, Plane>();
	return yield* evaluate(graph.outputNodeId);
	function* evaluate(id: string): Work {
		const cached = cache.get(id); if (cached) return cached;
		const node = nodes.get(id); if (!node) throw new ReferenceError(`Mask/matte node ${id} is unavailable.`);
		const result = yield* evaluateNode(node, graph, width, height, inputs, evaluate, allocate, ranges, brushInputs); cache.set(id, result); return result;
	}
}

function* evaluateNode(node: VideoMaskMatteNodeV1, graph: VideoMaskMatteGraphV1, width: number, height: number,
	inputs: ReadonlyMap<string, VideoMaskMatteRgbaInputV13>, evaluate: (id: string) => Work, allocate: (length: number) => Plane, ranges?: Readonly<VideoMaskMatteRangeSamplerV1>,
	brushInputs?: ReadonlyMap<string, Readonly<BrushMaskResourceV1>>): Work {
	if (node.kind === 'feather') return yield* feather(yield* evaluate(node.inputNodeId), width, height, node.radius, allocate);
	const operands: Plane[] = [];
	if (node.kind === 'invert') operands.push(yield* evaluate(node.inputNodeId));
	if (node.kind === 'boolean') for (const id of node.inputNodeIds) operands.push(yield* evaluate(id));
	let frame: VideoMaskMatteRgbaInputV13 | undefined;
	let brush: Readonly<BrushMaskResourceV1> | undefined;
	if (node.kind === 'raster' || node.kind === 'alpha') {
		const binding = graph.inputs.find(input => input.name === node.inputName);
		if (!binding) throw new ReferenceError(`Mask/matte input ${node.inputName} is unavailable.`);
		if (brushInputs) {
			brush = brushInputs.get(binding.sourceRef);
			if (!brush) throw new ReferenceError(`Brush source ${binding.sourceRef} is unavailable.`);
		} else {
			frame = inputs.get(binding.sourceRef);
			if (!frame) throw new ReferenceError(`Mask/matte source ${binding.sourceRef} is unavailable.`);
			dimension(frame.width, 'mask input width'); dimension(frame.height, 'mask input height');
			if (!(frame.pixels instanceof Uint8Array) || frame.pixels.byteLength !== frame.width * frame.height * 4) throw new RangeError('Mask input RGBA length does not match its dimensions.');
		}
	}
	const colorCoverage = node.kind === 'color-range' ? ranges!.color(node) : undefined;
	const output = allocate(width * height);
	for (let start = 0; start < output.length; start += CHUNK_PIXELS) {
		const end = Math.min(output.length, start + CHUNK_PIXELS);
		for (let index = start; index < end; index++) {
			const x = index % width, y = Math.floor(index / width), px = (x + 0.5) / width, py = (y + 0.5) / height;
			if (node.kind === 'linear-gradient') output[index] = gradient(node, px, py);
			else if (node.kind === 'luminance-range') output[index] = ranges!.luminance(node, index);
			else if (node.kind === 'color-range') output[index] = colorCoverage!(index);
			else if (node.kind === 'radial-gradient') output[index] = radialGradient(node, px, py);
			else if (node.kind === 'vector-shape') {
				const inside = node.shape === 'rectangle' ? px >= node.x && px < node.x + node.width && py >= node.y && py < node.y + node.height
					: ellipseContains(px, py, node.x, node.y, node.width, node.height); output[index] = inside ? 255 : 0;
			} else if (node.kind === 'vector-path') {
				let winding = 0; for (const path of node.paths) winding += pathWinding(path.points, px, py);
				output[index] = (node.fillRule === 'even-odd' ? Math.abs(winding) % 2 === 1 : winding !== 0) ? 255 : 0;
			} else if (node.kind === 'raster' || node.kind === 'alpha') {
				if (brush) {
					const sx = Math.min(brush.reference.width - 1, Math.floor(x * brush.reference.width / width));
					const sy = Math.min(brush.reference.height - 1, Math.floor(y * brush.reference.height / height));
					output[index] = brush.alpha[sy * brush.reference.width + sx]!; continue;
				}
				const source = frame!, sourceX = Math.min(source.width - 1, Math.floor(x * source.width / width)), sourceY = Math.min(source.height - 1, Math.floor(y * source.height / height));
				const offset = (sourceY * source.width + sourceX) * 4;
				output[index] = node.kind === 'alpha' || node.channel === 'alpha' ? source.pixels[offset + 3]!
					: node.channel === 'red' ? source.pixels[offset]! : node.channel === 'green' ? source.pixels[offset + 1]!
						: node.channel === 'blue' ? source.pixels[offset + 2]! : Math.round(source.pixels[offset]! * 0.2126 + source.pixels[offset + 1]! * 0.7152 + source.pixels[offset + 2]! * 0.0722);
			} else if (node.kind === 'invert') output[index] = 255 - operands[0]![index]!;
			else {
				let value = operands[0]![index]!;
				for (let operand = 1; operand < operands.length; operand++) {
					const next = operands[operand]![index]!;
					if (node.operation === 'union') value = Math.max(value, next);
					else if (node.operation === 'intersect') value = Math.min(value, next);
					else if (node.operation === 'subtract') value = Math.min(value, 255 - next); else value = Math.abs(value - next);
				}
				output[index] = value;
			}
		}
		if (end < output.length) yield;
	}
	return output;
}

function gradient(node: Extract<VideoMaskMatteNodeV1, { kind: 'linear-gradient' }>, x: number, y: number): number {
	const dx = node.end.x - node.start.x, dy = node.end.y - node.start.y, scale = Math.max(Math.abs(dx), Math.abs(dy));
	const nx = dx / scale, ny = dy / scale;
	const projection = ((x - node.start.x) * nx + (y - node.start.y) * ny) / (scale * (nx * nx + ny * ny));
	return Math.round(Math.max(0, Math.min(1, projection)) * 255);
}

function radialGradient(node: Extract<VideoMaskMatteNodeV1, { kind: 'radial-gradient' }>, x: number, y: number): number {
	const rho = Math.hypot((x - node.center.x) / node.radius.x, (y - node.center.y) / node.radius.y);
	return Math.round(255 * Math.max(0, Math.min(1, (1 - rho) / (1 - node.innerFraction))));
}

function* feather(source: Plane, width: number, height: number, radiusValue: number, allocate: (length: number) => Plane): Work {
	const radius = Math.min(VIDEO_MASK_MATTE_LIMITS_V1.maximumFeatherRadius, Math.max(0, Math.ceil(radiusValue)));
	if (radius === 0) { const copy = allocate(source.length); copy.set(source); return copy; }
	const horizontal = new Float64Array(source.length);
	try {
		for (let y = 0; y < height; y++) {
			let sum = 0; for (let x = -radius; x <= radius; x++) sum += source[y * width + clamp(x, width)]!;
			for (let x = 0; x < width; x++) { horizontal[y * width + x] = sum / (radius * 2 + 1); sum += source[y * width + clamp(x + radius + 1, width)]! - source[y * width + clamp(x - radius, width)]!; }
			if ((y + 1) * width >= CHUNK_PIXELS && (y + 1) % Math.max(1, Math.floor(CHUNK_PIXELS / width)) === 0) yield;
		}
		const output = allocate(source.length);
		for (let x = 0; x < width; x++) {
			let sum = 0; for (let y = -radius; y <= radius; y++) sum += horizontal[clamp(y, height) * width + x]!;
			for (let y = 0; y < height; y++) { output[y * width + x] = Math.round(sum / (radius * 2 + 1)); sum += horizontal[clamp(y + radius + 1, height) * width + x]! - horizontal[clamp(y - radius, height) * width + x]!; }
			if ((x + 1) * height >= CHUNK_PIXELS && (x + 1) % Math.max(1, Math.floor(CHUNK_PIXELS / height)) === 0) yield;
		}
		return output;
	} finally { if (Number(Reflect.apply(BUFFER_SIZE, horizontal.buffer, []))) horizontal.fill(0); }
}

function pathWinding(points: readonly Readonly<{ position: Readonly<{ x: number; y: number }> }>[], x: number, y: number): number {
	let winding = 0;
	for (let index = 0; index < points.length; index++) {
		const a = points[index]!.position, b = points[(index + 1) % points.length]!.position;
		if (a.y <= y && b.y > y && cross(a, b, x, y) > 0) winding++;
		else if (a.y > y && b.y <= y && cross(a, b, x, y) < 0) winding--;
	}
	return winding;
}
function ellipseContains(x: number, y: number, left: number, top: number, width: number, height: number): boolean {
	const dx = (x - (left + width / 2)) / (width / 2), dy = (y - (top + height / 2)) / (height / 2); return dx * dx + dy * dy <= 1;
}
function cross(a: Readonly<{ x: number; y: number }>, b: Readonly<{ x: number; y: number }>, x: number, y: number): number { return (b.x - a.x) * (y - a.y) - (x - a.x) * (b.y - a.y); }
function clamp(value: number, length: number): number { return Math.max(0, Math.min(length - 1, value)); }
function dimension(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 65_536) throw new RangeError(`${name} must be a positive bounded dimension.`); return Number(value);
}
