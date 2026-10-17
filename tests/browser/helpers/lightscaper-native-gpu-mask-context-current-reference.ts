/* SPDX-License-Identifier: AGPL-3.0-only */
import { prepareLinearDevelopMetadataCurrentV1 } from '../../../src/common/editor/imaging/image-develop-linear-metadata-current-v1.ts';
import { preparePixelFrameWebGl2MaskPlanCurrentV1 } from '../../../src/common/editor/imaging/pixel-frame-webgl2-mask-plan-current-v1.ts';
import { preparePixelFrameWebGl2MaskContextCurrentV1 } from '../../../src/common/editor/imaging/pixel-frame-webgl2-mask-context-plan-current-v1.ts';
import { withPixelFrameWebGl2MaskContextCurrentV1, readPixelFrameWebGl2MaskSelectedTextureCurrentV1, type PixelFrameWebGl2MaskCoverageCurrentV1 } from '../../../src/common/editor/imaging/pixel-frame-webgl2-mask-context-current-v1.ts';
import { withLinearMaskCoverageV1 } from '../../../src/common/editor/imaging/pixel-frame-linear-mask-v1.ts';
import { withImageDevelopLinearCurrentV1 } from '../../../src/common/editor/imaging/image-develop-linear-current-v1.ts';
import { defaultImageDevelopStateV2 } from '../../../src/common/editor/imaging/image-develop-state-v2.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1 as PROFILE } from '../../../src/common/editor/photo-library-develop-linear-port-v1.ts';
import { withMaskRasterSourceScopeV1 } from '../../../src/common/editor/imaging/mask-raster-source-scope-v1.ts';
import { withPreparedBrushMaskResourceV1 } from '../../../src/common/editor/imaging/brush-mask-resource-v1.ts';
import { PixelFrameWebGl2UnavailableCurrentV1 } from '../../../src/common/editor/imaging/pixel-frame-webgl2-context-current-v1.ts';
import type { MaskRasterSourcePortV1 } from '../../../src/common/editor/imaging/mask-raster-source-port-v1.ts';

interface Request {
	readonly width: number; readonly height: number; readonly words: readonly number[]; readonly graph: Readonly<Record<string, unknown>>;
	readonly brush?: Readonly<{ width: number; height: number; alpha: readonly number[] }>;
	readonly fault?: 'preabort' | 'held-abort' | 'opaque' | 'detach-opaque' | 'finish-opaque' | 'late-view';
}
const bits = (pixels: Float32Array<ArrayBuffer>) => [...new Uint32Array(pixels.buffer, pixels.byteOffset, pixels.length)];
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(accept => { resolve = accept; }); return { promise, resolve }; };
const contains = (error: unknown, target: unknown): boolean => Object.is(error, target) || error instanceof AggregateError && error.errors.some((child: unknown) => contains(child, target));
export async function runMaskContextCurrentV1(value: Request) {
	if (value.width < 1 || value.height < 1 || value.width > 8192 || value.height > 8192 || value.words.length !== value.width * value.height * 4) throw new RangeError('Mask test source extent is invalid.');
	const words = Uint32Array.from(value.words), pixels = new Float32Array(words.buffer), before = bits(pixels);
	const descriptor = { schemaVersion: 1 as const, width: value.width, height: value.height, sampleFormat: 'float32' as const, primaries: 'srgb' as const, transfer: 'linear' as const }, frame = { descriptor, pixels };
	const run = async (brush?: Readonly<{ key: string; body: Uint8Array<ArrayBuffer> }>) => {
		const graph = brush ? { ...value.graph, inputs: [{ name: 'Brush', kind: 'alpha', sourceRef: brush.key }] } : value.graph;
		let active = 0, reads = 0;
		const maskSource: MaskRasterSourcePortV1 = { async withBytes(_reference, consume) {
			if (!brush || active) throw new Error('Mask test source is missing or overlapping.'); reads++; active++;
			const copy = brush.body.slice(); try { return await consume(copy); } finally { copy.fill(0); active--; }
		} };
		const effect = { id: 'tone', type: 'tone-ladder-v1', enabled: true, params: { exposure: 1 } };
		const develop = { ...defaultImageDevelopStateV2(), effects: [effect], masks: [graph], maskBindings: [{ maskId: graph.id, effectId: 'tone' }] };
		const options = brush ? { maskSource } : {};
		const metadata = prepareLinearDevelopMetadataCurrentV1({ frame, develop, maskOverlay: { maskId: graph.id, effectId: 'tone' } }, PROFILE, options);
		const checkpoints = preparePixelFrameWebGl2MaskPlanCurrentV1(metadata), prepared = preparePixelFrameWebGl2MaskContextCurrentV1(checkpoints);
		let expectedCoverage: number[] = [];
		const expected = await withImageDevelopLinearCurrentV1({ frame, develop }, output => bits(output.pixels), PROFILE, options);
		const candidateWords = await withImageDevelopLinearCurrentV1({ frame, develop: { ...defaultImageDevelopStateV2(), effects: [effect] } }, output => bits(output.pixels), PROFILE);
		const candidate = new Float32Array(Uint32Array.from(candidateWords).buffer);
		const canvas = document.createElement('canvas'), gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: false });
		if (!gl || !gl.getExtension('EXT_color_buffer_float')) throw new Error('Mandatory context test requires real Float32 WebGL2.');
		const hostTextures: WebGLTexture[] = [], hostFbo = gl.createFramebuffer(); if (!hostFbo) throw new Error('Native host framebuffer unavailable.');
		const host = (data: Float32Array<ArrayBuffer> | null) => {
			const texture = gl.createTexture(); if (!texture) throw new Error('Host native bank unavailable.'); hostTextures.push(texture); gl.bindTexture(gl.TEXTURE_2D, texture);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, value.width, value.height, 0, gl.RGBA, gl.FLOAT, data);
			return Object.freeze({ texture, width: value.width, height: value.height });
		};
		const incoming = host(pixels), staged = host(candidate), destination = host(null), privateTextures: WebGLTexture[] = [], uintBuffers = new Set<ArrayBuffer>();
		const restore: (() => void)[] = []; let draws = 0, sourceActiveAtDraw = 0, integerClears = 0, integerDeletedWithoutZeroClear = 0, detached = false;
		const integerTextures = new Set<WebGLTexture>(), zeroCleared = new Set<WebGLTexture>(), clearedAt = new Map<WebGLTexture, number>();
		let commandSerial = 0, finishedAt = 0, integerDeletedBeforeFinish = 0;
		const prototype = WebGL2RenderingContext.prototype;
		for (const key of ['createTexture', 'drawArrays', 'clearBufferuiv', 'readPixels', 'texImage2D', 'texSubImage2D', 'deleteTexture', 'finish'] as const) {
			const descriptor = Object.getOwnPropertyDescriptor(prototype, key)!; const original = descriptor.value as (...args: unknown[]) => unknown;
			Object.defineProperty(prototype, key, { ...descriptor, value: function (this: WebGL2RenderingContext, ...args: unknown[]) {
				const result = Reflect.apply(original, this, args); if (this !== gl) return result;
				if (key === 'createTexture' && result) privateTextures.push(result as WebGLTexture);
				if (key === 'drawArrays') { draws++; sourceActiveAtDraw = Math.max(sourceActiveAtDraw, active);
					zeroCleared.delete(gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME) as WebGLTexture); }
				if (key === 'texImage2D' && (args[2] === gl.R8UI || args[2] === gl.R32UI)) {
					const texture = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture; integerTextures.add(texture); zeroCleared.delete(texture);
				}
				if (key === 'texSubImage2D') zeroCleared.delete(gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture);
				if (key === 'clearBufferuiv') { integerClears++; const texture = gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME) as WebGLTexture;
					if (args[2] instanceof Uint32Array && [...args[2]].every(n => n === 0) && !gl.isEnabled(gl.SCISSOR_TEST)
						&& (gl.getParameter(gl.COLOR_WRITEMASK) as boolean[]).every(Boolean)) { zeroCleared.add(texture); clearedAt.set(texture, ++commandSerial); } else zeroCleared.delete(texture); }
				if (key === 'finish') { finishedAt = commandSerial; if (value.fault === 'finish-opaque') throw opaque; }
				if (key === 'deleteTexture' && integerTextures.has(args[0] as WebGLTexture)) {
					if (!zeroCleared.has(args[0] as WebGLTexture)) integerDeletedWithoutZeroClear++;
					if ((clearedAt.get(args[0] as WebGLTexture) ?? Infinity) > finishedAt) integerDeletedBeforeFinish++;
				}
				if (key === 'readPixels' && args[5] === gl.UNSIGNED_INT && args[6] instanceof Uint32Array) {
					const backing = args[6].buffer as ArrayBuffer; uintBuffers.add(backing);
					if (value.fault === 'detach-opaque' && !detached && backing.byteLength === 65_536) { detached = true; structuredClone(backing, { transfer: [backing] }); throw opaque; }
				}
				return result;
			} }); restore.push(() => { Object.defineProperty(prototype, key, descriptor); });
		}
		const abort = new AbortController(), revoked = Proxy.revocable({}, {}); revoked.revoke(); const opaque: unknown = revoked.proxy;
		const entered = deferred(), release = deferred(); let selectedLive = false, selectedTexture: WebGLTexture | undefined;
		let selectedGuardLive = false, selectedGuardExpired = false, selectedGuardForged = false, cleanupRetained = false;
		let actualCoverage: number[] = [], oldView: Readonly<PixelFrameWebGl2MaskCoverageCurrentV1> | undefined, rejected = false, primary = false;
		const body = async (scope?: unknown) => {
			await withLinearMaskCoverageV1(checkpoints.executedCheckpoints[0]!.binding, frame, coverage => { expectedCoverage = [...coverage]; }, undefined, scope);
			if (value.fault === 'preabort') abort.abort(opaque);
			const task = withPixelFrameWebGl2MaskContextCurrentV1({ gl, prepared, scope, signal: abort.signal, checkCurrent() {}, unavailable(reason) { throw new PixelFrameWebGl2UnavailableCurrentV1(reason); } }, executor =>
				executor.withCoverage(checkpoints.executedCheckpoints[0]!, incoming, async coverage => {
					oldView = coverage; const bytes = new Uint8Array(value.width * value.height);
					try { const rows = Math.max(1, Math.floor(65_536 / value.width)); for (let top = 0; top < value.height; top += rows) {
						const count = Math.min(rows, value.height - top), stripe = new Uint8Array(value.width * count); try { coverage.readStripe(top, count, stripe); bytes.set(stripe, top * value.width); } finally { stripe.fill(0); }
					} actualCoverage = [...bytes]; } finally { bytes.fill(0); }
					coverage.blend(staged, destination);
					await coverage.withTexture(texture => {
						selectedLive = gl.isTexture(texture); selectedTexture = texture;
						const selected = readPixelFrameWebGl2MaskSelectedTextureCurrentV1(texture, gl, checkpoints.executedCheckpoints[0]!);
						selectedGuardLive = selected.texture === texture && selected.width === value.width && selected.height === value.height;
						try { readPixelFrameWebGl2MaskSelectedTextureCurrentV1(incoming.texture, gl, checkpoints.executedCheckpoints[0]!); }
						catch (error) { selectedGuardForged = error instanceof TypeError; }
					});
					try { readPixelFrameWebGl2MaskSelectedTextureCurrentV1(selectedTexture, gl, checkpoints.executedCheckpoints[0]!); }
					catch (error) { selectedGuardExpired = error instanceof TypeError; }
					if (value.fault === 'opaque') throw opaque;
					if (value.fault === 'held-abort') { entered.resolve(); await release.promise; }
				}));
			if (value.fault === 'held-abort') { await Promise.race([entered.promise, task]); abort.abort(opaque); release.resolve(); }
			try { await task; } catch (error) { rejected = true; primary = contains(error, opaque);
				cleanupRetained = !Object.is(error, opaque) && error instanceof AggregateError && error.errors.some((item: unknown) => !Object.is(item, opaque) && item instanceof TypeError);
			}
		};
		try {
			if (brush) await withMaskRasterSourceScopeV1(metadata.masks.references, metadata.masks.retainedStorageKeys, maskSource, body); else await body();
			let lateRefused = false; if (oldView) try { oldView.readStripe(0, 1, new Uint8Array(value.width)); } catch (error) { lateRefused = error instanceof TypeError; }
			const privateRetired = privateTextures.every(texture => !gl.isTexture(texture)); restore.reverse().forEach(run => { run(); });
			gl.bindFramebuffer(gl.FRAMEBUFFER, hostFbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, destination.texture, 0);
			const output = new Float32Array(pixels.length); try { gl.readPixels(0, 0, value.width, value.height, gl.RGBA, gl.FLOAT, output);
				const debug = gl.getExtension('WEBGL_debug_renderer_info');
				return { renderer: String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER)), actualCoverage, expectedCoverage, expected, output: bits(output), before, source: bits(pixels), rejected, primary, cleanupRetained, lateRefused, privateRetired, draws, integerClears, integerDeletedWithoutZeroClear, integerDeletedBeforeFinish, selectedLive, selectedGuardLive, selectedGuardExpired, selectedGuardForged, selectedRetired: selectedTexture !== undefined && !gl.isTexture(selectedTexture), sourceActiveAtDraw, reads,
					nativeScratchWiped: [...uintBuffers].every(buffer => buffer.byteLength === 0 || new Uint8Array(buffer).every(byte => byte === 0)) };
			} finally { output.fill(0); }
		} finally { release.resolve(); restore.reverse().forEach(run => { run(); }); candidate.fill(0); gl.bindFramebuffer(gl.FRAMEBUFFER, hostFbo);
			for (const texture of hostTextures) { gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0); gl.clearBufferfv(gl.COLOR, 0, new Float32Array(4)); gl.deleteTexture(texture); }
			gl.deleteFramebuffer(hostFbo); canvas.width = 0; canvas.height = 0;
		}
	};
	try { return value.brush ? await withPreparedBrushMaskResourceV1({ width: value.brush.width, height: value.brush.height, alpha: Uint8Array.from(value.brush.alpha) }, prepared => run({ key: prepared.reference.storageKey, body: prepared.bytes })) : await run(); }
	finally { pixels.fill(0); }
}
