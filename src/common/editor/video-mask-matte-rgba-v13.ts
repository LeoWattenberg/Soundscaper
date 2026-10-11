/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from './closed-domain-value.ts';
import { normalizeVideoMaskMatteGraphV1, VIDEO_MASK_MATTE_LIMITS_V1, VIDEO_MASK_MATTE_WORKING_LIMIT_V1, videoMaskMatteWorkingBytesV1,
	type VideoMaskMatteGraphV1, type VideoMaskMatteNodeV1 } from './video-mask-matte-v24.ts';
import { captureVideoMaskLuminanceFrameV1, videoMaskLuminanceRangeCoverageV1, videoMaskMatteUsesCurrentFrameV1,
	type CapturedVideoMaskLuminanceFrameV1 } from './video-mask-luminance-range-v1.ts';
import { prepareVideoMaskColorRangeCoverageV1 } from './video-mask-color-range-v1.ts';
import { prepareVideoMaskMatteBrushInputsV1 } from './imaging/image-develop-brush-mask-v1.ts';
import { captureMaskRasterSourceV1, withMaskRasterSourceScopeV1, scopedBrushMaskResourceV1,
	assertMaskRasterSourceScopeV1, maskRasterSourceScopeWorkingBytesV1, withMaskRasterSourceScopeWorkV1 } from './imaging/mask-raster-source-scope-v1.ts';
import type { MaskRasterSourcePortV1 } from './imaging/mask-raster-source-port-v1.ts';
import type { BrushMaskResourceV1 } from './imaging/brush-mask-resource-v1.ts';

export interface VideoMaskMatteRgbaInputV13 {
	readonly width: number;
	readonly height: number;
	readonly pixels: Uint8Array<ArrayBuffer>;
}
const CHECK = AbortSignal.prototype.throwIfAborted;
const BUFFER_SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const CHUNK_PIXELS = 65_536;
type Plane = Uint8Array<ArrayBuffer>;
type Work = Generator<void, Plane, void>;

/** Existing synchronous Frame entry retains its pixel cap and exact graph arithmetic. */
export function evaluateVideoMaskMatteRgbaV13(graphValue: unknown, widthValue: number, heightValue: number,
	inputs: ReadonlyMap<string, VideoMaskMatteRgbaInputV13> = new Map(), currentFrame?: unknown): Plane {
	const graph = normalizeVideoMaskMatteGraphV1(graphValue), width = dimension(widthValue, 'mask width'), height = dimension(heightValue, 'mask height');
	if (width * height > 33_554_432) throw new RangeError('A mask frame may contain at most 33554432 pixels.');
	if (!(inputs instanceof Map)) throw new TypeError('Mask/matte inputs must be a ReadonlyMap.');
	let source: Readonly<CapturedVideoMaskLuminanceFrameV1> | undefined;
	if (videoMaskMatteUsesCurrentFrameV1(graph)) { videoMaskMatteWorkingBytesV1(graph, width, height); source = captureVideoMaskLuminanceFrameV1(currentFrame, width, height); }
	const owned: Plane[] = []; let delivered: Plane | undefined;
	const work = evaluateGraph(graph, width, height, inputs, length => { const bytes = new Uint8Array(length); if (source) owned.push(bytes); return bytes; }, source);
	try { let next = work.next(); while (!next.done) next = work.next(); delivered = next.value; return delivered; }
	finally { work.return(new Uint8Array()); if (source) wipe(source.pixels); for (const bytes of owned) if (bytes !== delivered) wipe(bytes); }
}

/** One bounded self-contained graph; all cache planes are borrowed and retired
 * after delivery. Shared row spans keep legacy and async arithmetic identical. */
export async function withVideoMaskMatteRgbaV1<Result>(value: unknown,
	consume: (coverage: Plane) => Result | Promise<Result>): Promise<Result> {
	const input = record(value, 'scoped mask request', ['graph', 'width', 'height', 'signal', 'currentFrame'], ['graph', 'width', 'height']);
	const signal = Object.hasOwn(input, 'signal') ? field(input, 'signal', 'scoped mask request') : undefined;
	if (signal !== undefined) assertSignal(signal);
	const check = () => { if (signal !== undefined) Reflect.apply(CHECK, signal, []); };
	check(); if (typeof consume !== 'function') throw new TypeError('Scoped mask requires a consumer.');
	const graph = normalizeVideoMaskMatteGraphV1(field(input, 'graph', 'scoped mask request'));
	if (graph.inputs.length) throw new RangeError('External mask inputs require authenticated media authority.');
	const width = dimension(field(input, 'width', 'scoped mask request'), 'mask width'), height = dimension(field(input, 'height', 'scoped mask request'), 'mask height');
	videoMaskMatteWorkingBytesV1(graph, width, height);
	const owned: Plane[] = [];
	const source = videoMaskMatteUsesCurrentFrameV1(graph) ? captureVideoMaskLuminanceFrameV1(field(input, 'currentFrame', 'scoped mask request'), width, height) : undefined;
	if (source) owned.push(source.pixels);
	const work = evaluateGraph(graph, width, height, new Map(), length => { const plane = new Uint8Array(length); owned.push(plane); return plane; }, source);
	try {
		check(); let next = work.next();
		while (!next.done) { await new Promise<void>(resolve => { setTimeout(resolve, 0); }); check(); next = work.next(); }
		check(); const result = await consume(next.value); check(); return result;
	} finally { work.return(new Uint8Array()); for (const bytes of owned) wipe(bytes); }
}

/** The explicit branch accepts only a current authenticated scope. All graph
 * declarations must belong to its complete closure, including unused inputs. */
export async function withVideoMaskMatteBrushScopeV1<Result>(value: unknown,
	consume: (coverage: Plane) => Result | Promise<Result>, scope: unknown): Promise<Result> {
	return await withMaskRasterSourceScopeWorkV1(scope, async () => {
		const request = prepareBrushRequest(value, consume);
		admitBrushScopeWorkingBytes(request, scope);
		const source = captureBrushCurrentFrame(request), backing = source?.pixels.buffer;
		try { return await runBrushGraph(request, consume, scope, source); }
		finally { if (source && backing) wipeBacking(backing); }
	});
}

/** Capture the actual range signal before the first resource await. This entry
 * owns one complete serial source scope and releases it after graph delivery. */
export async function withVideoMaskMatteBrushV1<Result>(value: unknown,
	consume: (coverage: Plane) => Result | Promise<Result>, sourceValue: MaskRasterSourcePortV1): Promise<Result> {
	const request = prepareBrushRequest(value, consume), source = captureBrushCurrentFrame(request);
	const backing = source?.pixels.buffer;
	try {
		const sourcePort = captureMaskRasterSourceV1(sourceValue);
		return await withMaskRasterSourceScopeV1(request.prepared.references, request.prepared.retainedStorageKeys, sourcePort,
			scope => runBrushGraph(request, consume, scope, source), request.signal);
	} finally { if (source && backing) wipeBacking(backing); }
}

function prepareBrushRequest(value: unknown, consume: unknown) {
	const input = record(value, 'scoped brush mask request', ['graph', 'width', 'height', 'signal', 'currentFrame'], ['graph', 'width', 'height']);
	const rawSignal = Object.hasOwn(input, 'signal') ? field(input, 'signal', 'scoped brush mask request') : undefined;
	if (rawSignal !== undefined) assertSignal(rawSignal);
	const signal = rawSignal as AbortSignal | undefined;
	const check = () => { if (signal !== undefined) Reflect.apply(CHECK, signal, []); };
	check(); if (typeof consume !== 'function') throw new TypeError('Scoped brush masks require a consumer.');
	const width = dimension(field(input, 'width', 'scoped brush mask request'), 'mask width');
	const height = dimension(field(input, 'height', 'scoped brush mask request'), 'mask height');
	const prepared = prepareVideoMaskMatteBrushInputsV1(field(input, 'graph', 'scoped brush mask request'), width, height);
	return { input, prepared, width, height, signal, check };
}
function captureBrushCurrentFrame(request: ReturnType<typeof prepareBrushRequest>): Readonly<CapturedVideoMaskLuminanceFrameV1> | undefined {
	return videoMaskMatteUsesCurrentFrameV1(request.prepared.graph)
		? captureVideoMaskLuminanceFrameV1(field(request.input, 'currentFrame', 'scoped brush mask request'), request.width, request.height) : undefined;
}
async function runBrushGraph<Result>(request: ReturnType<typeof prepareBrushRequest>, consume: (coverage: Plane) => Result | Promise<Result>,
	scope: unknown, source?: Readonly<CapturedVideoMaskLuminanceFrameV1>): Promise<Result> {
	admitBrushScopeWorkingBytes(request, scope);
	const brushInputs = new Map<string, Readonly<BrushMaskResourceV1>>();
	for (const key of request.prepared.retainedStorageKeys) brushInputs.set(key, scopedBrushMaskResourceV1(scope, key));
	const owned: ArrayBuffer[] = [];
	const work = evaluateGraph(request.prepared.graph, request.width, request.height, new Map(), length => {
		const plane = new Uint8Array(length); owned.push(plane.buffer); return plane;
	}, source, brushInputs);
	const check = () => { request.check(); assertMaskRasterSourceScopeV1(scope, []); };
	try {
		check(); let next = work.next();
		while (!next.done) { await new Promise<void>(resolve => { setTimeout(resolve, 0); }); check(); next = work.next(); }
		check(); const result = await consume(next.value); check(); return result;
	} finally { work.return(new Uint8Array()); for (const backing of owned) wipeBacking(backing); }
}
function admitBrushScopeWorkingBytes(request: ReturnType<typeof prepareBrushRequest>, scope: unknown): void {
	assertMaskRasterSourceScopeV1(scope, request.prepared.references);
	const bytes = BigInt(videoMaskMatteWorkingBytesV1(request.prepared.graph, request.width, request.height))
		+ BigInt(maskRasterSourceScopeWorkingBytesV1(scope));
	if (bytes > BigInt(VIDEO_MASK_MATTE_WORKING_LIMIT_V1)) throw new RangeError('Brush mask coverage exceeds its 64 MiB working budget.');
}

function* evaluateGraph(graph: VideoMaskMatteGraphV1, width: number, height: number,
	inputs: ReadonlyMap<string, VideoMaskMatteRgbaInputV13>, allocate: (length: number) => Plane, currentFrame?: Readonly<CapturedVideoMaskLuminanceFrameV1>,
	brushInputs?: ReadonlyMap<string, Readonly<BrushMaskResourceV1>>): Work {
	const nodes = new Map(graph.nodes.map(node => [node.id, node])), cache = new Map<string, Plane>();
	return yield* evaluate(graph.outputNodeId);
	function* evaluate(id: string): Work {
		const cached = cache.get(id); if (cached) return cached;
		const node = nodes.get(id); if (!node) throw new ReferenceError(`Mask/matte node ${id} is unavailable.`);
		const result = yield* evaluateNode(node, graph, width, height, inputs, evaluate, allocate, currentFrame, brushInputs); cache.set(id, result); return result;
	}
}

function* evaluateNode(node: VideoMaskMatteNodeV1, graph: VideoMaskMatteGraphV1, width: number, height: number,
	inputs: ReadonlyMap<string, VideoMaskMatteRgbaInputV13>, evaluate: (id: string) => Work, allocate: (length: number) => Plane, currentFrame?: Readonly<CapturedVideoMaskLuminanceFrameV1>,
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
	const colorCoverage = node.kind === 'color-range' ? prepareVideoMaskColorRangeCoverageV1(node, currentFrame!) : undefined;
	const output = allocate(width * height);
	for (let start = 0; start < output.length; start += CHUNK_PIXELS) {
		const end = Math.min(output.length, start + CHUNK_PIXELS);
		for (let index = start; index < end; index++) {
			const x = index % width, y = Math.floor(index / width), px = (x + 0.5) / width, py = (y + 0.5) / height;
			if (node.kind === 'linear-gradient') output[index] = gradient(node, px, py);
			else if (node.kind === 'luminance-range') output[index] = videoMaskLuminanceRangeCoverageV1(node, currentFrame!, index);
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
function wipe(bytes: Plane): void { if (Number(Reflect.apply(BUFFER_SIZE, bytes.buffer, []))) Uint8Array.prototype.fill.call(bytes, 0); }
function wipeBacking(backing: ArrayBuffer): void { if (Number(Reflect.apply(BUFFER_SIZE, backing, []))) Uint8Array.prototype.fill.call(new Uint8Array(backing), 0); }
function assertSignal(value: unknown): asserts value is AbortSignal {
	if (typeof value !== 'object' || value === null) throw new TypeError('Mask evaluation requires a native signal.');
	Reflect.apply(CHECK, value, []);
	if (Object.getPrototypeOf(value) !== AbortSignal.prototype || ['aborted', 'reason', 'throwIfAborted', 'addEventListener', 'removeEventListener'].some(key => Object.hasOwn(value, key))) throw new TypeError('Mask evaluation requires unmodified native cancellation.');
}
