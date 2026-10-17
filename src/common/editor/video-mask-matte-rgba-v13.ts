/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from './closed-domain-value.ts';
import { normalizeVideoMaskMatteGraphV1, VIDEO_MASK_MATTE_WORKING_LIMIT_V1, videoMaskMatteWorkingBytesV1 } from './video-mask-matte-v24.ts';
import { captureVideoMaskLuminanceFrameV1, videoMaskLuminanceRangeCoverageV1, videoMaskMatteUsesCurrentFrameV1,
	type CapturedVideoMaskLuminanceFrameV1 } from './video-mask-luminance-range-v1.ts';
import { prepareVideoMaskColorRangeCoverageV1 } from './video-mask-color-range-v1.ts';
import { evaluateVideoMaskMatteGraphWorkV1, type VideoMaskMatteRangeSamplerV1 } from './video-mask-matte-graph-work-v1.ts';
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
type Plane = Uint8Array<ArrayBuffer>;

/** Existing synchronous Frame entry retains its pixel cap and exact graph arithmetic. */
export function evaluateVideoMaskMatteRgbaV13(graphValue: unknown, widthValue: number, heightValue: number,
	inputs: ReadonlyMap<string, VideoMaskMatteRgbaInputV13> = new Map(), currentFrame?: unknown): Plane {
	const graph = normalizeVideoMaskMatteGraphV1(graphValue), width = dimension(widthValue, 'mask width'), height = dimension(heightValue, 'mask height');
	if (width * height > 33_554_432) throw new RangeError('A mask frame may contain at most 33554432 pixels.');
	if (!(inputs instanceof Map)) throw new TypeError('Mask/matte inputs must be a ReadonlyMap.');
	let source: Readonly<CapturedVideoMaskLuminanceFrameV1> | undefined;
	if (videoMaskMatteUsesCurrentFrameV1(graph)) { videoMaskMatteWorkingBytesV1(graph, width, height); source = captureVideoMaskLuminanceFrameV1(currentFrame, width, height); }
	const owned: Plane[] = []; let delivered: Plane | undefined;
	const work = evaluateVideoMaskMatteGraphWorkV1(graph, width, height, inputs, length => { const bytes = new Uint8Array(length); if (source) owned.push(bytes); return bytes; }, byteRanges(source));
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
	const work = evaluateVideoMaskMatteGraphWorkV1(graph, width, height, new Map(), length => { const plane = new Uint8Array(length); owned.push(plane); return plane; }, byteRanges(source));
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
	const work = evaluateVideoMaskMatteGraphWorkV1(request.prepared.graph, request.width, request.height, new Map(), length => {
		const plane = new Uint8Array(length); owned.push(plane.buffer); return plane;
	}, byteRanges(source), brushInputs);
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

function byteRanges(source: Readonly<CapturedVideoMaskLuminanceFrameV1> | undefined): Readonly<VideoMaskMatteRangeSamplerV1> | undefined {
	return source && { luminance: (node, index) => videoMaskLuminanceRangeCoverageV1(node, source, index),
		color: node => prepareVideoMaskColorRangeCoverageV1(node, source) };
}
