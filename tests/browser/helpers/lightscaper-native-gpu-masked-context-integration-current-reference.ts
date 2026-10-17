/* SPDX-License-Identifier: AGPL-3.0-only */
import { prepareLinearDevelopMetadataCurrentV1 } from '../../../src/common/editor/imaging/image-develop-linear-metadata-current-v1.ts';
import { defaultImageDevelopStateV2 } from '../../../src/common/editor/imaging/image-develop-state-v2.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1 as PROFILE } from '../../../src/common/editor/photo-library-develop-linear-port-v1.ts';
import { preparePixelFrameWebGl2MaskPlanCurrentV1 } from '../../../src/common/editor/imaging/pixel-frame-webgl2-mask-plan-current-v1.ts';
import { preparePixelFrameWebGl2MaskContextCurrentV1 } from '../../../src/common/editor/imaging/pixel-frame-webgl2-mask-context-plan-current-v1.ts';
import { preparePixelFrameWebGl2MaskOverlayCurrentV1 } from '../../../src/common/editor/imaging/pixel-frame-webgl2-mask-overlay-plan-current-v1.ts';
import { withPixelFrameWebGl2MaskOverlayCurrentV1, type PixelFrameWebGl2MaskOverlayStorageCurrentV1 } from '../../../src/common/editor/imaging/pixel-frame-webgl2-mask-overlay-current-v1.ts';
import { prepareImageDevelopGpuMaskPhasePlanCurrentV1 } from '../../../src/common/editor/imaging/image-develop-gpu-mask-phase-plan-current-v1.ts';
import { preparePixelFrameWebGl2MaskedExecutionCurrentV1 } from '../../../src/common/editor/imaging/pixel-frame-webgl2-masked-execution-current-v1.ts';
import { withPixelFrameWebGl2MaskReceiptsCurrentV1 } from '../../../src/common/editor/imaging/pixel-frame-webgl2-mask-checkpoint-current-v1.ts';
import { openPixelFrameWebGl2ContextCurrentV1 } from '../../../src/common/editor/imaging/pixel-frame-webgl2-context-current-v1.ts';
import { withImageDevelopLinearCurrentV1 } from '../../../src/common/editor/imaging/image-develop-linear-current-v1.ts';
import { withPixelFrameWebGl2LutsCurrentV1, isPixelFrameWebGl2LutCurrentV1, type PixelFrameWebGl2LutResourcesCurrentV1 } from '../../../src/common/editor/imaging/pixel-frame-webgl2-lut-current-v1.ts';
import type { CubeLutSourcePortV1 } from '../../../src/common/editor/imaging/cube-lut-source-port-v1.ts';

interface Request {
	readonly width: number; readonly height: number; readonly words: readonly number[];
	readonly effects: readonly unknown[]; readonly masks: readonly unknown[];
	readonly maskBindings: readonly Readonly<{ maskId: string; effectId: string }>[];
	readonly selected?: Readonly<{ maskId: string; effectId: string }>;
	readonly lutBody?: readonly number[];
}
const bits = (value: Float32Array<ArrayBuffer>) => [...new Uint32Array(value.buffer, value.byteOffset, value.length)];
export async function runMaskedContextIntegrationCurrentV1(request: Request) {
	const words = Uint32Array.from(request.words), pixels = new Float32Array(words.buffer), before = bits(pixels);
	const descriptor = Object.freeze({ schemaVersion: 1 as const, width: request.width, height: request.height, sampleFormat: 'float32' as const, primaries: 'srgb' as const, transfer: 'linear' as const });
	const frame = Object.freeze({ descriptor, pixels }), develop = { ...defaultImageDevelopStateV2(), effects: request.effects, masks: request.masks, maskBindings: request.maskBindings };
	let sourceActive = 0, sourceActiveAtGl = 0, sourceReads = 0;
	const source: CubeLutSourcePortV1 = { async withBytes(_reference, consume) {
		if (!request.lutBody || sourceActive) throw new TypeError('Integration LUT body is missing or overlaps another borrow.');
		sourceActive++; sourceReads++; const owned = Uint8Array.from(request.lutBody);
		try { return await consume(owned); } finally { owned.fill(0); sourceActive--; }
	} };
	const metadata = prepareLinearDevelopMetadataCurrentV1({ frame, develop, ...(request.selected ? { maskOverlay: request.selected } : {}) }, PROFILE, request.lutBody ? { source } : {});
	const checkpoints = preparePixelFrameWebGl2MaskPlanCurrentV1(metadata), contextPlan = preparePixelFrameWebGl2MaskContextCurrentV1(checkpoints);
	const overlayPlan = request.selected ? preparePixelFrameWebGl2MaskOverlayCurrentV1(checkpoints) : undefined;
	const phase = prepareImageDevelopGpuMaskPhasePlanCurrentV1(checkpoints, contextPlan, overlayPlan, pixels.buffer.byteLength);
	if (!phase.eligible || !checkpoints.executedCheckpoints.length) throw new RangeError('Mandatory integration witness requires its admitted native mask phase.');
	let expectedOverlay: number[] | undefined;
	const expected = await withImageDevelopLinearCurrentV1({ frame, develop, ...(request.selected ? { maskOverlay: request.selected } : {}) }, (output, overlay) => {
		expectedOverlay = overlay ? [...overlay.coverage] : undefined; return bits(output.pixels);
	}, PROFILE, request.lutBody ? { source } : {});
	const textures = new Set<WebGLTexture>(), programs = new Set<WebGLProgram>(), framebuffers = new Set<WebGLFramebuffer>(), vaos = new Set<WebGLVertexArrayObject>();
	const formats = new Map<WebGLTexture, number>(), proto = WebGL2RenderingContext.prototype, restore: (() => void)[] = [];
	const renderers = new Set<string>();
	let imagePeak = 0, imageLive = 0, imageDraws = 0, readbackBeforeMaskRetired = false, deliveryAfterResources = false;
	const imageAllocated = new Set<WebGLTexture>(), uintScratch = new Set<ArrayBuffer>(), readbacks: Float32Array<ArrayBuffer>[] = [];
	const uniformNames = new Map<WebGLUniformLocation, string>(), spatialKinds: number[] = [];
	for (const name of ['createTexture', 'createProgram', 'createFramebuffer', 'createVertexArray', 'getUniformLocation', 'uniform1i', 'texImage2D', 'drawArrays', 'readPixels', 'deleteTexture', 'deleteProgram', 'deleteFramebuffer', 'deleteVertexArray'] as const) {
		const property = Object.getOwnPropertyDescriptor(proto, name)!, original = property.value as (...args: unknown[]) => unknown;
		Object.defineProperty(proto, name, { ...property, value: function (this: WebGL2RenderingContext, ...args: unknown[]) {
			const result = Reflect.apply(original, this, args); sourceActiveAtGl = Math.max(sourceActiveAtGl, sourceActive);
			if (name === 'createTexture' && result) { textures.add(result as WebGLTexture); const debug = this.getExtension('WEBGL_debug_renderer_info'); renderers.add(String(this.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? this.RENDERER))); }
			if (name === 'createProgram' && result) programs.add(result as WebGLProgram);
			if (name === 'createFramebuffer' && result) framebuffers.add(result as WebGLFramebuffer);
			if (name === 'createVertexArray' && result) vaos.add(result as WebGLVertexArrayObject);
			if (name === 'getUniformLocation' && result) uniformNames.set(result as WebGLUniformLocation, args[1] as string);
			if (name === 'uniform1i' && uniformNames.get(args[0] as WebGLUniformLocation) === 'uSpatialKind') spatialKinds.push(Number(args[1]));
			if (name === 'texImage2D') { const texture = this.getParameter(this.TEXTURE_BINDING_2D) as WebGLTexture; formats.set(texture, args[2] as number);
				if (args[2] === this.RGBA32F && Number(args[3]) === request.width && Number(args[4]) === request.height && !imageAllocated.has(texture)) {
					imageAllocated.add(texture); imageLive++; imagePeak = Math.max(imagePeak, imageLive);
				}
			}
			if (name === 'drawArrays') { const target = this.getFramebufferAttachmentParameter(this.FRAMEBUFFER, this.COLOR_ATTACHMENT0, this.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME) as WebGLTexture;
				if (formats.get(target) === this.RGBA32F) imageDraws++;
			}
			if (name === 'readPixels' && args[5] === this.UNSIGNED_INT && args[6] instanceof Uint32Array) uintScratch.add(args[6].buffer as ArrayBuffer);
			if (name === 'readPixels' && args[6] instanceof Float32Array && readbacks.some(value => Object.is(value, args[6]))) {
				readbackBeforeMaskRetired = [...textures].some(texture => formats.get(texture) === this.R8UI || formats.get(texture) === this.R32UI);
			}
			if (name === 'deleteTexture') { const texture = args[0] as WebGLTexture; textures.delete(texture); if (imageAllocated.delete(texture)) imageLive--; }
			if (name === 'deleteProgram') programs.delete(args[0] as WebGLProgram);
			if (name === 'deleteFramebuffer') framebuffers.delete(args[0] as WebGLFramebuffer);
			if (name === 'deleteVertexArray') vaos.delete(args[0] as WebGLVertexArrayObject);
			return result;
		} }); restore.push(() => { Object.defineProperty(proto, name, property); });
	}
	let opened: Awaited<ReturnType<typeof openPixelFrameWebGl2ContextCurrentV1>> | undefined;
	let actualOverlay: number[] | undefined, result: number[] = [];
	const attempt = async (overlay?: Readonly<PixelFrameWebGl2MaskOverlayStorageCurrentV1>) => {
		const open = async (resources?: Readonly<PixelFrameWebGl2LutResourcesCurrentV1>) => withPixelFrameWebGl2MaskReceiptsCurrentV1(checkpoints, async receipts => {
			const token = preparePixelFrameWebGl2MaskedExecutionCurrentV1({ phase, receipts, ...(overlay ? { overlay } : {}), checkCurrent() {} });
			opened = await openPixelFrameWebGl2ContextCurrentV1(frame, checkpoints.passes, () => { const plane = new Float32Array(checkpoints.finalDescriptor.width * checkpoints.finalDescriptor.height * 4); readbacks.push(plane); return plane; }, undefined, resources, token);
		});
		const luts = checkpoints.passes.filter(isPixelFrameWebGl2LutCurrentV1);
		if (luts.length) await withPixelFrameWebGl2LutsCurrentV1(luts, source, open); else await open();
		// Actual auth/LUT/receipt scopes have now retired. Only parent image/LUT
		// GL objects + readback and optional private overlay host remain.
		deliveryAfterResources = sourceActive === 0; const accepted = opened!;
		try { accepted.assertCurrent(); result = bits(accepted.pixels);
			if (overlay) await overlay.withCoverage(view => { actualOverlay = [...view.coverage]; }); accepted.assertCurrent();
		} finally { accepted.dispose(); opened = undefined; }
	};
	try {
		if (overlayPlan) await withPixelFrameWebGl2MaskOverlayCurrentV1(overlayPlan, attempt); else await attempt();
		return { renderers: [...renderers], result, expected, actualOverlay, expectedOverlay, source: bits(pixels), before, imagePeak, imageDraws, spatialKinds, readbackBeforeMaskRetired, deliveryAfterResources, sourceActiveAtGl, sourceReads,
			privateRetired: textures.size + programs.size + framebuffers.size + vaos.size === 0,
			nativeScratchWiped: [...uintScratch].every(backing => backing.byteLength === 0 || new Uint8Array(backing).every(byte => byte === 0)) };
	} finally { try { opened?.dispose(); } finally { restore.reverse().forEach(work => { work(); }); for (const plane of readbacks) plane.fill(0); pixels.fill(0); } }
}
