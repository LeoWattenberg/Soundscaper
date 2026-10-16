/* SPDX-License-Identifier: AGPL-3.0-only */
import { withImageDevelopGpuCurrentV1 } from '../../../src/common/editor/imaging/image-develop-gpu-current-v1.ts';
import { withImageDevelopLinearCurrentV1 } from '../../../src/common/editor/imaging/image-develop-linear-current-v1.ts';
import { defaultImageDevelopStateV2 } from '../../../src/common/editor/imaging/image-develop-state-v2.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1 as PROFILE } from '../../../src/common/editor/photo-library-develop-linear-port-v1.ts';
import { pixelFrameWebGl2ComponentEquivalentCurrentV1 as equivalent } from '../../../src/common/editor/imaging/pixel-frame-webgl2-numeric-current-v1.ts';
import { nativeGpuRepairSceneCurrentV1 } from './lightscaper-native-gpu-repair-current-reference.ts';

type Case = Parameters<typeof nativeGpuRepairSceneCurrentV1>[0] | 'heal-mixed' | 'heal-range' | 'underflow-boundary' | 'invalid-boundary';
const bits = (pixels: Float32Array<ArrayBuffer>) => [...new Uint32Array(pixels.buffer, pixels.byteOffset, pixels.length)];
const retired = (backing: ArrayBuffer) => backing.byteLength === 0 || new Uint8Array(backing).every(n => n === 0);

/** Calls the maintained high broker with native source samples. The independent
 * CPU render finishes and retires before observation; none of its pixels feeds
 * the GPU. All instrumentation invokes real native methods unchanged. */
export async function runNativeGpuRepairBrokerCurrentV1(name: Case) {
	const input = nativeGpuRepairSceneCurrentV1(name === 'heal-mixed' || name === 'heal-range' || name === 'underflow-boundary' || name === 'invalid-boundary' ? 'heal-coupled' : name);
	if (name === 'heal-range') for (let at = 0; at < input.pixels.length; at++) if (at % 4 !== 3) input.pixels[at] = input.pixels[at]! / 4;
	if (name === 'underflow-boundary' || name === 'invalid-boundary') {
		input.width = 7; input.height = 3; input.pixels.fill(0); input.pixels = new Float32Array(7 * 3 * 4);
		const alpha = 2 ** -126, donor = 2 ** 126;
		for (let at = 3; at < input.pixels.length; at += 4) input.pixels[at] = alpha;
		input.pixels.set([donor, donor / 2, -donor, alpha], (7 + 1) * 4);
		input.spots = [{ ...input.spots[0]!, target: { x: 5.5 / 7, y: .5 }, source: { x: 1.5 / 7, y: .5 }, radius: .1 }];
		if (name === 'invalid-boundary') for (const [x, y] of [[4, 1], [6, 1], [5, 0], [5, 2]] as const) input.pixels[(y * 7 + x) * 4 + 3] = 0;
	}
	const descriptor = { schemaVersion: 1 as const, width: input.width, height: input.height,
		sampleFormat: 'float32' as const, transfer: 'linear' as const, primaries: 'srgb' as const };
	const develop = { ...defaultImageDevelopStateV2(), processVersion: 3, repairs: { schemaVersion: 1, spots: input.spots },
		...(name === 'heal-mixed' || name === 'heal-range' ? {
			...(name === 'heal-mixed' ? { geometry: { crop: { x: .5, y: 0, width: .5, height: 1 }, rotationDegrees: 90, flipHorizontal: false, flipVertical: false } } : {}),
			effects: [{ id: 'tone', type: 'tone-ladder-v1', enabled: true, params: { exposure: 1 } }],
			masks: [{ schemaVersion: 1, id: 'mask', kind: 'mask', inputs: [], nodes: [name === 'heal-range' ? { id: 'gradient', kind: 'luminance-range', lower: .125, upper: .5, falloff: 0 } : { id: 'gradient', kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }], outputNodeId: 'gradient' }],
			maskBindings: [{ maskId: 'mask', effectId: 'tone' }],
		} : {}) };
	const selected = name === 'heal-mixed' || name === 'heal-range' ? { maskOverlay: { maskId: 'mask', effectId: 'tone' } } : {};
	const request = { frame: { descriptor, pixels: input.pixels }, develop, ...selected }, before = bits(input.pixels);
	let expected: number[] | undefined, expectedOverlay: number[] | undefined, cpuError: string | undefined;
	try {
		expected = await withImageDevelopLinearCurrentV1(request, (frame, overlay) => {
			expectedOverlay = overlay && [...overlay.coverage]; return bits(frame.pixels);
		}, PROFILE);
	} catch (error) { if (name !== 'invalid-boundary' || !(error instanceof RangeError)) throw error; cpuError = error.message; }
	const restores: (() => void)[] = [], handles = new Set<object>(), readbacks = new Set<ArrayBuffer>(), uploads = new Set<ArrayBuffer>();
	const programs = new Set<object>(), deltaPrograms = new Set<object>(), renderers = new Set<string>(), statuses: number[] = [];
	let current: object | undefined, nativeJacobi = 0, sourceUploads = 0, callbacks = 0, backing: ArrayBuffer | undefined, overlayBacking: ArrayBuffer | undefined;
	const patch = (key: string, observe: (gl: WebGL2RenderingContext, args: unknown[], value: unknown) => void) => {
		let owner: object | null = WebGL2RenderingContext.prototype;
		while (owner && !Object.hasOwn(owner, key)) owner = Object.getPrototypeOf(owner) as object | null;
		if (!owner) throw new TypeError(`Native repair broker observation requires ${key}.`);
		const target = owner, property = Object.getOwnPropertyDescriptor(target, key)!, invoke = property.value as (...args: unknown[]) => unknown;
		restores.push(() => { Object.defineProperty(target, key, property); });
		Object.defineProperty(target, key, { ...property, value: function(this: WebGL2RenderingContext, ...args: unknown[]) {
			const result = Reflect.apply(invoke, this, args); observe(this, args, result); return result;
		} });
	};
	try {
		for (const [create, remove] of [['createTexture', 'deleteTexture'], ['createShader', 'deleteShader'], ['createProgram', 'deleteProgram'],
			['createFramebuffer', 'deleteFramebuffer'], ['createVertexArray', 'deleteVertexArray'], ['fenceSync', 'deleteSync']] as const) {
			patch(create, (gl, _args, handle) => { if (handle && typeof handle === 'object') handles.add(handle);
				const debug = gl.getExtension('WEBGL_debug_renderer_info'); renderers.add(String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER))); });
			patch(remove, (_gl, args) => { handles.delete(args[0] as object); });
		}
		patch('getUniformLocation', (_gl, args, result) => { if (result && args[1] === 'uPrevious') programs.add(args[0] as object); if (result && args[1] === 'uBoundaryTarget') deltaPrograms.add(args[0] as object); });
		patch('useProgram', (_gl, args) => { current = args[0] as object | undefined; });
		patch('drawArrays', () => { if (current && programs.has(current)) nativeJacobi++; });
		patch('texImage2D', (_gl, args) => { if (args[8] instanceof Float32Array) { uploads.add(args[8].buffer as ArrayBuffer);
			if (args[3] === input.width && args[4] === input.height) sourceUploads++; } });
		patch('readPixels', (_gl, args) => { if (args[6] instanceof Float32Array) { readbacks.add(args[6].buffer as ArrayBuffer); if (current && deltaPrograms.has(current)) statuses.push(args[6][3]!); } });
		let result: unknown, error: string | undefined;
		try {
			result = await withImageDevelopGpuCurrentV1(request, (frame, execution, overlay) => {
				callbacks++; backing = frame.pixels.buffer; overlayBacking = overlay?.coverage.buffer;
				const actual = bits(frame.pixels), normative = new Float32Array(Uint32Array.from(expected ?? []).buffer);
				try { return { ...execution, actual, descriptor: frame.descriptor, overlay: overlay && [...overlay.coverage],
					actualReadback: readbacks.has(backing), handlesAtDelivery: handles.size,
					matched: frame.pixels.length === normative.length && frame.pixels.every((n, at) => at % 4 === 3 ? Object.is(n, normative[at]) : equivalent(normative[at]!, n)) };
				} finally { normative.fill(0); }
			}, PROFILE);
		} catch (reason) { if (name !== 'invalid-boundary' || !(reason instanceof RangeError)) throw reason; error = reason.message; }
		return { result, error, cpuError, expected, expectedOverlay, callbacks, sourceUploads, nativeJacobi, statuses, renderers: [...renderers],
			aliveHandles: handles.size, sourceUnchanged: bits(input.pixels).every((word, at) => word === before[at]),
			readbacksRetired: [...readbacks].every(retired), uploadsRetired: [...uploads].every(retired),
			outputRetired: backing === undefined || retired(backing), overlayRetired: overlayBacking === undefined || retired(overlayBacking) };
	} finally { for (const restore of restores.reverse()) restore(); input.pixels.fill(0); }
}
