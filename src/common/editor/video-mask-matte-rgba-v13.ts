/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeVideoMaskMatteGraphV1,
	type VideoMaskMatteGraphV1,
	type VideoMaskMatteNodeV1,
} from './video-mask-matte-v24.ts';

export interface VideoMaskMatteRgbaInputV13 {
	readonly width: number;
	readonly height: number;
	readonly pixels: Uint8Array<ArrayBuffer>;
}

/** Evaluate a bounded V24 graph into deterministic eight-bit mask coverage. */
export function evaluateVideoMaskMatteRgbaV13(
	graphValue: unknown,
	widthValue: number,
	heightValue: number,
	inputs: ReadonlyMap<string, VideoMaskMatteRgbaInputV13> = new Map(),
): Uint8Array<ArrayBuffer> {
	const graph = normalizeVideoMaskMatteGraphV1(graphValue);
	const width = dimension(widthValue, 'mask width');
	const height = dimension(heightValue, 'mask height');
	if (width * height > 33_554_432) throw new RangeError('A mask frame may contain at most 33554432 pixels.');
	if (!(inputs instanceof Map)) throw new TypeError('Mask/matte inputs must be a ReadonlyMap.');
	const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
	const cache = new Map<string, Uint8Array<ArrayBuffer>>();
	return evaluate(graph.outputNodeId);

	function evaluate(nodeId: string): Uint8Array<ArrayBuffer> {
		const cached = cache.get(nodeId);
		if (cached) return cached;
		const node = nodes.get(nodeId);
		if (!node) throw new ReferenceError(`Mask/matte node ${nodeId} is unavailable.`);
		const result = evaluateNode(node, graph, width, height, inputs, evaluate);
		cache.set(nodeId, result);
		return result;
	}
}

function evaluateNode(
	node: VideoMaskMatteNodeV1,
	graph: VideoMaskMatteGraphV1,
	width: number,
	height: number,
	inputs: ReadonlyMap<string, VideoMaskMatteRgbaInputV13>,
	evaluate: (nodeId: string) => Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
	if (node.kind === 'vector-shape') return vectorShape(node, width, height);
	if (node.kind === 'vector-path') return vectorPath(node, width, height);
	if (node.kind === 'raster' || node.kind === 'alpha') {
		const binding = graph.inputs.find(({ name }) => name === node.inputName);
		if (!binding) throw new ReferenceError(`Mask/matte input ${node.inputName} is unavailable.`);
		const frame = inputs.get(binding.sourceRef);
		if (!frame) throw new ReferenceError(`Mask/matte source ${binding.sourceRef} is unavailable.`);
		return rasterInput(node, frame, width, height);
	}
	if (node.kind === 'invert') {
		const source = evaluate(node.inputNodeId);
		return Uint8Array.from(source, (value) => 255 - value) as Uint8Array<ArrayBuffer>;
	}
	if (node.kind === 'feather') return feather(evaluate(node.inputNodeId), width, height, node.radius);
	const operands = node.inputNodeIds.map(evaluate);
	const output = new Uint8Array(width * height);
	for (let index = 0; index < output.length; index += 1) {
		let value = operands[0]![index]!;
		for (let operand = 1; operand < operands.length; operand += 1) {
			const next = operands[operand]![index]!;
			if (node.operation === 'union') value = Math.max(value, next);
			else if (node.operation === 'intersect') value = Math.min(value, next);
			else if (node.operation === 'subtract') value = Math.min(value, 255 - next);
			else value = Math.abs(value - next);
		}
		output[index] = value;
	}
	return output;
}

function vectorShape(
	node: Extract<VideoMaskMatteNodeV1, Readonly<{ kind: 'vector-shape' }>>,
	width: number,
	height: number,
): Uint8Array<ArrayBuffer> {
	const output = new Uint8Array(width * height);
	for (let y = 0; y < height; y += 1) {
		const py = (y + 0.5) / height;
		for (let x = 0; x < width; x += 1) {
			const px = (x + 0.5) / width;
			const inside = node.shape === 'rectangle'
				? px >= node.x && px < node.x + node.width && py >= node.y && py < node.y + node.height
				: ellipseContains(px, py, node.x, node.y, node.width, node.height);
			output[y * width + x] = inside ? 255 : 0;
		}
	}
	return output;
}

function vectorPath(
	node: Extract<VideoMaskMatteNodeV1, Readonly<{ kind: 'vector-path' }>>,
	width: number,
	height: number,
): Uint8Array<ArrayBuffer> {
	const output = new Uint8Array(width * height);
	for (let y = 0; y < height; y += 1) {
		const py = (y + 0.5) / height;
		for (let x = 0; x < width; x += 1) {
			const px = (x + 0.5) / width;
			let winding = 0;
			for (const path of node.paths) winding += pathWinding(path.points, px, py);
			const inside = node.fillRule === 'even-odd' ? Math.abs(winding) % 2 === 1 : winding !== 0;
			output[y * width + x] = inside ? 255 : 0;
		}
	}
	return output;
}

function pathWinding(
	points: readonly Readonly<{ readonly position: Readonly<{ x: number; y: number }> }>[],
	x: number,
	y: number,
): number {
	let winding = 0;
	for (let index = 0; index < points.length; index += 1) {
		const a = points[index]!.position;
		const b = points[(index + 1) % points.length]!.position;
		if (a.y <= y && b.y > y && cross(a, b, x, y) > 0) winding += 1;
		else if (a.y > y && b.y <= y && cross(a, b, x, y) < 0) winding -= 1;
	}
	return winding;
}

function rasterInput(
	node: Extract<VideoMaskMatteNodeV1, Readonly<{ kind: 'raster' | 'alpha' }>>,
	frame: VideoMaskMatteRgbaInputV13,
	width: number,
	height: number,
): Uint8Array<ArrayBuffer> {
	const sourceWidth = dimension(frame.width, 'mask input width');
	const sourceHeight = dimension(frame.height, 'mask input height');
	if (!(frame.pixels instanceof Uint8Array) || frame.pixels.byteLength !== sourceWidth * sourceHeight * 4) {
		throw new RangeError('Mask input RGBA length does not match its dimensions.');
	}
	const output = new Uint8Array(width * height);
	for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
		const sourceX = Math.min(sourceWidth - 1, Math.floor(x * sourceWidth / width));
		const sourceY = Math.min(sourceHeight - 1, Math.floor(y * sourceHeight / height));
		const offset = (sourceY * sourceWidth + sourceX) * 4;
		output[y * width + x] = node.kind === 'alpha' || node.channel === 'alpha'
			? frame.pixels[offset + 3]!
			: node.channel === 'red' ? frame.pixels[offset]!
				: node.channel === 'green' ? frame.pixels[offset + 1]!
					: node.channel === 'blue' ? frame.pixels[offset + 2]!
						: Math.round(frame.pixels[offset]! * 0.2126
							+ frame.pixels[offset + 1]! * 0.7152
							+ frame.pixels[offset + 2]! * 0.0722);
	}
	return output;
}

function feather(
	source: Uint8Array<ArrayBuffer>,
	width: number,
	height: number,
	radiusValue: number,
): Uint8Array<ArrayBuffer> {
	const radius = Math.min(64, Math.max(0, Math.ceil(radiusValue)));
	if (radius === 0) return source.slice() as Uint8Array<ArrayBuffer>;
	const horizontal = new Float64Array(source.length);
	for (let y = 0; y < height; y += 1) {
		let sum = 0;
		for (let x = -radius; x <= radius; x += 1) sum += source[y * width + clamp(x, width)]!;
		for (let x = 0; x < width; x += 1) {
			horizontal[y * width + x] = sum / (radius * 2 + 1);
			sum += source[y * width + clamp(x + radius + 1, width)]!
				- source[y * width + clamp(x - radius, width)]!;
		}
	}
	const output = new Uint8Array(source.length);
	for (let x = 0; x < width; x += 1) {
		let sum = 0;
		for (let y = -radius; y <= radius; y += 1) sum += horizontal[clamp(y, height) * width + x]!;
		for (let y = 0; y < height; y += 1) {
			output[y * width + x] = Math.round(sum / (radius * 2 + 1));
			sum += horizontal[clamp(y + radius + 1, height) * width + x]!
				- horizontal[clamp(y - radius, height) * width + x]!;
		}
	}
	return output;
}

function ellipseContains(
	x: number, y: number, left: number, top: number, width: number, height: number,
): boolean {
	const dx = (x - (left + width / 2)) / (width / 2);
	const dy = (y - (top + height / 2)) / (height / 2);
	return dx * dx + dy * dy <= 1;
}

function cross(
	a: Readonly<{ x: number; y: number }>, b: Readonly<{ x: number; y: number }>, x: number, y: number,
): number {
	return (b.x - a.x) * (y - a.y) - (x - a.x) * (b.y - a.y);
}

function clamp(value: number, length: number): number {
	return Math.max(0, Math.min(length - 1, value));
}

function dimension(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 65_536) {
		throw new RangeError(`${name} must be a positive bounded dimension.`);
	}
	return Number(value);
}
