/* SPDX-License-Identifier: AGPL-3.0-only */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { withImageDevelopGpuCurrentV1 } from '../../../src/common/editor/imaging/image-develop-gpu-current-v1.ts';
import { defaultImageDevelopStateV2 } from '../../../src/common/editor/imaging/image-develop-state-v2.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1 } from '../../../src/common/editor/photo-library-develop-linear-port-v1.ts';
import { LinearDevelopOwnerV1 } from '../../../src/common/editor/imaging/image-develop-linear-owner-v1.ts';
import { prepareLinearDevelopMetadataCurrentV1 } from '../../../src/common/editor/imaging/image-develop-linear-metadata-current-v1.ts';
import { prepareImageDevelopGpuPlanCurrentV1 } from '../../../src/common/editor/imaging/image-develop-gpu-plan-current-v1.ts';

const WIDTH = 2048, HEIGHT = 2048, RADIUS = 64, HALO = 512, FRAME_BYTES = WIDTH * HEIGHT * 16;
const SCRATCH_BYTES = 105 * HALO * HALO + 4096;
const SOURCE = Object.freeze([.125, .25, .5, 1]), DEFECT = Object.freeze([.75, .875, 1, 1]);
const COLUMNS = Object.freeze([0, 32, 64, 511, 1023, 1024, 1536, 1983, 2047]), ROWS = Object.freeze([0, 1024, 2047]);
interface TextureState { format: number; width: number; height: number; last: 'allocated' | 'written' | 'cleared'; clear: number; gl: WebGL2RenderingContext; }
interface ContextState { program: object | null; finish: number; }
function digest(bytes: Uint8Array<ArrayBuffer>): string { const result = sha256(bytes); try { return bytesToHex(result); } finally { result.fill(0); } }
function retired(buffer: ArrayBuffer): boolean { return buffer.byteLength === 0 || new Uint8Array(buffer).every(value => value === 0); }
function coverageAt(x: number): number {
	// Independent129-sample replicated box sum. Rows are identical, so the
	// vertical mean is identity. No production coverage/image plane is made.
	let total = 0;
	for (let at = x - RADIUS; at <= x + RADIUS; at++) total += Math.round((Math.max(0, Math.min(WIDTH - 1, at)) + .5) * 255 / WIDTH);
	return Math.round(total / (2 * RADIUS + 1));
}
function expectedWords(q: number): readonly number[] {
	const values = new Float32Array(4);
	try {
		for (let channel = 0; channel < 3; channel++) {
			const incoming = SOURCE[channel]!, candidate = Math.fround(incoming * 2);
			values[channel] = incoming + q / 255 * (candidate - incoming);
		} values[3] = 1; return [...new Uint32Array(values.buffer)];
	} finally { values.fill(0); }
}

/** Transparent native calls and maintained allocation methods: unchanged
 * arguments, receivers and results; existing backing identities only. */
function observe() {
	const renderers = new Set<string>(), restores: (() => void)[] = [];
	const proto = typeof WebGL2RenderingContext === 'undefined' ? undefined : WebGL2RenderingContext.prototype;
	const live = { texture: new Set<object>(), program: new Set<object>(), shader: new Set<object>(), framebuffer: new Set<object>(), vao: new Set<object>(), sync: new Set<object>() };
	const textureStates = new Map<object, TextureState>(), contexts = new Map<WebGL2RenderingContext, ContextState>(), locations = new Map<object, string>();
	const nodePrograms = new Set<object>(), featherPrograms = new Set<object>(), blendPrograms = new Set<object>(), globalPrograms = new Set<object>();
	const jacobiPrograms = new Set<object>(), healPrograms = new Set<object>(), radius = new Map<object, number>(), kinds = new Map<object, number>();
	const largeHandles = new Set<object>(), repairOutputs = new Set<object>(), authoredOutputs = new Set<object>();
	const haloHandles = new Set<object>(), haloFloats = new Set<object>(), haloBytes = new Set<object>();
	const stableBackings = new Set<ArrayBuffer>(), nativeScratch = new Set<ArrayBuffer>(), fullReadbacks = new Set<ArrayBuffer>();
	const referenceBackings = new Set<ArrayBuffer>(), repairScratchBackings = new Set<ArrayBuffer>();
	const referenceLive = new Set<ArrayBuffer>();
	let serial = 0, imageLive = 0, imagePeak = 0, haloLive = 0, haloPeak = 0;
	let nodes = 0, horizontal = 0, vertical = 0, blends = 0, tones = 0, uploads = 0, jacobi = 0, healBlends = 0;
	let integerReads = 0, maximumUintBacking = 0, fullReads = 0, incompleteClears = 0, cpuCoverageUploads = 0;
	let haloBeforeGraph = false, haloBeforeReference = false, scratchBeforeIntegerRetirement = false, readbackBeforeIntegerRetirement = false;
	let cpuRepairScratchAllocations = 0, referencePlaneAllocations = 0, referencePlanePeak = 0, lateImageAllocations = 0;
	let repairScratchBeforeAuthoredReplay = false, rawReadbackSha256: string | undefined;
	let normalProbeCopies = 0, normalProbeArithmetic = 0, mixedProbeEndpoints = 0, maximumTexture = 0, viewportWidth = 0, viewportHeight = 0;
	const context = (gl: WebGL2RenderingContext) => { let state = contexts.get(gl); if (!state) { state = { program: null, finish: 0 }; contexts.set(gl, state); } return state; };
	const target = (gl: WebGL2RenderingContext): object | undefined => {
		if (!gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING)) return undefined;
		const value: unknown = gl.getFramebufferAttachmentParameter(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME);
		return value !== null && typeof value === 'object' ? value : undefined;
	};
	const large = (value: TextureState | undefined) => value?.width === WIDTH && value.height === HEIGHT;
	const halo = (value: TextureState | undefined) => value?.width === HALO && value.height === HALO;
	const hasInteger = () => [...live.texture].some(texture => { const value = textureStates.get(texture); return value?.format === 0x8232 || value?.format === 0x8236; });
	const handles: Readonly<Record<string, keyof typeof live>> = { createTexture: 'texture', deleteTexture: 'texture', createProgram: 'program', deleteProgram: 'program',
		createShader: 'shader', deleteShader: 'shader', createFramebuffer: 'framebuffer', deleteFramebuffer: 'framebuffer', createVertexArray: 'vao', deleteVertexArray: 'vao', fenceSync: 'sync', deleteSync: 'sync' };
	const after = (name: string, gl: WebGL2RenderingContext, args: unknown[], result: unknown) => {
		serial++; const state = context(gl), kind = handles[name];
		if (name === 'createTexture' && result) { const debug = gl.getExtension('WEBGL_debug_renderer_info'); renderers.add(String(gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER))); }
		if (kind) {
			if (name.startsWith('create') || name === 'fenceSync') { if (result !== null && typeof result === 'object') live[kind].add(result); }
			else if (args[0] !== null && typeof args[0] === 'object') {
				const handle = args[0], texture = textureStates.get(handle);
				if (name === 'deleteTexture' && (large(texture) || halo(texture))) {
					if (texture!.last !== 'cleared' || context(texture!.gl).finish < texture!.clear) incompleteClears++;
					if (large(texture) && texture!.format === gl.RGBA32F) imageLive--; if (halo(texture)) haloLive--;
				} live[kind].delete(handle);
			}
		}
		if (name === 'useProgram') state.program = args[0] !== null && typeof args[0] === 'object' ? args[0] : null;
		if (name === 'getUniformLocation' && result !== null && typeof result === 'object' && args[0] !== null && typeof args[0] === 'object' && typeof args[1] === 'string') {
			locations.set(result, args[1]); if (args[1] === 'uNodeKind') nodePrograms.add(args[0]); if (args[1] === 'uRadius') featherPrograms.add(args[0]);
			if (args[1] === 'uBlendPolicy') blendPrograms.add(args[0]); if (args[1] === 'uKind') globalPrograms.add(args[0]);
			if (args[1] === 'uPrevious') jacobiPrograms.add(args[0]); if (args[1] === 'uSolution') healPrograms.add(args[0]);
		}
		if (name === 'uniform1i' && state.program && args[0] !== null && typeof args[0] === 'object') {
			const field = locations.get(args[0]); if (field === 'uRadius') radius.set(state.program, Number(args[1])); if (field === 'uKind') kinds.set(state.program, Number(args[1]));
		}
		if (name === 'texImage2D') {
			const texture: unknown = gl.getParameter(gl.TEXTURE_BINDING_2D); if (texture === null || typeof texture !== 'object') return;
			const previous = textureStates.get(texture), format = Number(args[2]), width = Number(args[3]), height = Number(args[4]);
			const record = { format, width, height, last: args[8] === null ? 'allocated' as const : 'written' as const, clear: 0, gl }; textureStates.set(texture, record);
			if (format === gl.RGBA32F && large(record)) {
				if (healBlends > 0 && !largeHandles.has(texture)) lateImageAllocations++;
				largeHandles.add(texture); if (!large(previous) || previous!.format !== gl.RGBA32F) { imageLive++; imagePeak = Math.max(imagePeak, imageLive); }
				if (args[8] instanceof Float32Array) { const backing = args[8].buffer; if (!(backing instanceof ArrayBuffer)) throw new TypeError('Native upload needs fixed ArrayBuffer.'); stableBackings.add(backing); uploads++; }
			}
			if (halo(record)) {
				haloHandles.add(texture); if (format === gl.RGBA32F) haloFloats.add(texture); if (format === gl.R8UI) haloBytes.add(texture);
				if (!halo(previous)) { haloLive++; haloPeak = Math.max(haloPeak, haloLive); }
			}
			if ((large(record) || halo(record)) && (format === gl.R8UI || format === gl.R32UI) && args[8] !== null) cpuCoverageUploads++;
		}
		if (name === 'texSubImage2D' && args[8] !== null) {
			const texture: unknown = gl.getParameter(gl.TEXTURE_BINDING_2D);
			const record = texture !== null && typeof texture === 'object' ? textureStates.get(texture) : undefined;
			if ((large(record) || halo(record)) && (record!.format === gl.R8UI || record!.format === gl.R32UI)) cpuCoverageUploads++;
		}
		if (name === 'drawArrays' || name === 'clearBufferfv' || name === 'clearBufferuiv') {
			const texture = target(gl), record = texture && textureStates.get(texture);
			if (record) { record.last = name === 'drawArrays' ? 'written' : 'cleared'; if (name !== 'drawArrays') record.clear = serial; }
			if (name === 'drawArrays' && large(record) && state.program) {
				if (healPrograms.has(state.program)) { healBlends++; repairOutputs.add(texture!); }
				if (globalPrograms.has(state.program) && kinds.get(state.program) === 2 || blendPrograms.has(state.program)) authoredOutputs.add(texture!);
				if (nodePrograms.has(state.program)) { nodes++; haloBeforeGraph ||= haloLive !== 0; }
				if (featherPrograms.has(state.program) && radius.get(state.program) === RADIUS) { if (record!.format === gl.R32UI) horizontal++; if (record!.format === gl.R8UI) vertical++; }
				if (blendPrograms.has(state.program)) blends++; if (globalPrograms.has(state.program) && kinds.get(state.program) === 2) tones++;
			}
			if (name === 'drawArrays' && halo(record) && state.program && jacobiPrograms.has(state.program)) jacobi++;
		}
		if (name === 'finish') state.finish = serial;
		if (name === 'readPixels') {
			const width = Number(args[2]), height = Number(args[3]), type = Number(args[5]), array = args[6];
			if (type === gl.UNSIGNED_INT && array instanceof Uint32Array) {
				const backing = array.buffer; if (!(backing instanceof ArrayBuffer)) throw new TypeError('Native integer readback needs ArrayBuffer.');
				nativeScratch.add(backing); maximumUintBacking = Math.max(maximumUintBacking, backing.byteLength); if (width === WIDTH) integerReads++;
			}
			if (type === gl.FLOAT && array instanceof Float32Array) {
				const backing = array.buffer; if (!(backing instanceof ArrayBuffer)) throw new TypeError('Native float readback needs ArrayBuffer.');
				if (width === WIDTH && height === HEIGHT) {
					fullReads++; fullReadbacks.add(backing); rawReadbackSha256 = digest(new Uint8Array(backing, array.byteOffset, array.byteLength)); readbackBeforeIntegerRetirement ||= hasInteger();
				}
				if (width === 4 && height === 1 && array.length === 16 && state.program && globalPrograms.has(state.program)) {
					const mode = kinds.get(state.program), scale = mode === 1 ? 2 : 1;
					if ((mode === 0 || mode === 1) && Object.is(array[0], -0) && array[1] === 3.5 * scale && array[2] === -2 * scale && Object.is(array[3], 0)
						&& array[6] === Math.fround(2 ** -126 * scale) && array[7] === .5 && array[11] === 1) { if (mode === 0) normalProbeCopies++; else normalProbeArithmetic++; }
				}
				if (width === 1 && height === 1 && array.length === 4 && state.program && blendPrograms.has(state.program)
					&& Object.is(array[0], -0) && array[1] === 2 && array[2] === -1 && Object.is(array[3], -0)) mixedProbeEndpoints++;
			}
		}
		if (name === 'getParameter') {
			if (args[0] === gl.MAX_TEXTURE_SIZE) maximumTexture = Math.max(maximumTexture, Number(result));
			if (args[0] === gl.MAX_VIEWPORT_DIMS && result instanceof Int32Array) { viewportWidth = Math.max(viewportWidth, result[0]!); viewportHeight = Math.max(viewportHeight, result[1]!); }
		}
	};
	try {
		const floats = LinearDevelopOwnerV1.prototype.floats, bytes = LinearDevelopOwnerV1.prototype.bytes, retire = LinearDevelopOwnerV1.prototype.retire;
		LinearDevelopOwnerV1.prototype.floats = function(this: LinearDevelopOwnerV1, length: number) {
			const values = Reflect.apply(floats, this, [length]) as Float32Array<ArrayBuffer>;
			if (length * 4 === FRAME_BYTES && fullReadbacks.size > 0) {
				referencePlaneAllocations++; referenceBackings.add(values.buffer); referenceLive.add(values.buffer);
				referencePlanePeak = Math.max(referencePlanePeak, referenceLive.size); haloBeforeReference ||= haloLive !== 0;
				if (referencePlaneAllocations === 3) repairScratchBeforeAuthoredReplay = ![...repairScratchBackings].every(retired);
			} return values;
		}; restores.push(() => { LinearDevelopOwnerV1.prototype.floats = floats; });
		LinearDevelopOwnerV1.prototype.bytes = function(this: LinearDevelopOwnerV1, length: number) {
			const values = Reflect.apply(bytes, this, [length]) as Uint8Array<ArrayBuffer>;
			if (length === SCRATCH_BYTES) { cpuRepairScratchAllocations++; repairScratchBackings.add(values.buffer); haloBeforeReference ||= haloLive !== 0; scratchBeforeIntegerRetirement ||= hasInteger(); }
			return values;
		}; restores.push(() => { LinearDevelopOwnerV1.prototype.bytes = bytes; });
		LinearDevelopOwnerV1.prototype.retire = function(this: LinearDevelopOwnerV1, buffer: ArrayBuffer) {
			Reflect.apply(retire, this, [buffer]); referenceLive.delete(buffer);
		}; restores.push(() => { LinearDevelopOwnerV1.prototype.retire = retire; });
		if (proto) for (const name of [...Object.keys(handles), 'getUniformLocation', 'uniform1i', 'useProgram', 'texImage2D', 'texSubImage2D', 'drawArrays', 'readPixels', 'clearBufferfv', 'clearBufferuiv', 'finish', 'getParameter']) {
			let owner: object | null = proto; while (owner && !Object.hasOwn(owner, name)) owner = Object.getPrototypeOf(owner) as object | null;
			const descriptor = owner && Object.getOwnPropertyDescriptor(owner, name); if (!owner || !descriptor || typeof descriptor.value !== 'function') throw new TypeError(`Missing actual native method: ${name}.`);
			const target = owner, method = descriptor.value as (...args: unknown[]) => unknown;
			restores.push(() => { Object.defineProperty(target, name, descriptor); });
			Object.defineProperty(target, name, { ...descriptor, value: function(this: WebGL2RenderingContext, ...args: unknown[]) { const result = Reflect.apply(method, this, args); after(name, this, args, result); return result; } });
		}
	} catch (error) { for (const restore of restores.reverse()) restore(); throw error; }
	return {
		read() { return { renderers: [...renderers], nodes, horizontal, vertical, blends, tones, uploads, imagePeak, integerReads, maximumUintBacking, fullReads, readbackBeforeIntegerRetirement,
			jacobi, healBlends, haloLive, haloPeak, haloTextureCount: haloHandles.size, haloFloatCount: haloFloats.size, haloByteCount: haloBytes.size,
			imageTextureCount: largeHandles.size, imageBanksReused: [...repairOutputs, ...authoredOutputs].every(texture => largeHandles.has(texture)),
			repairImageOutputCount: repairOutputs.size, authoredImageOutputCount: authoredOutputs.size,
				haloBeforeGraph, haloBeforeReference, scratchBeforeIntegerRetirement, repairScratchBeforeAuthoredReplay,
				cpuRepairScratchAllocations, referencePlaneAllocations, referencePlanePeak, lateImageAllocations, cpuCoverageUploads,
			referenceRetired: [...referenceBackings].every(retired), repairScratchRetired: [...repairScratchBackings].every(retired),
			privateRetired: Object.values(live).every(handles => handles.size === 0), imageLive, incompleteClears,
			stableUploadsRetired: [...stableBackings].every(retired), nativeScratchRetired: [...nativeScratch].every(retired), readbacksRetired: [...fullReadbacks].every(retired),
			rawReadbackSha256, normalFloatSupported: normalProbeCopies > 0 && normalProbeArithmetic > 0, mixedSamplersSupported: mixedProbeEndpoints >= 2,
			maximumTexture, viewportWidth, viewportHeight }; },
		containsReadback(buffer: ArrayBuffer) { return fullReadbacks.has(buffer); },
		stop() { for (const restore of restores.reverse()) restore(); },
	};
}

export async function qualifyNativeGpuRepairLargeCurrentV1() {
	const pixels = new Float32Array(WIDTH * HEIGHT * 4), original = pixels.buffer;
	let observation: ReturnType<typeof observe> | undefined, facts: ReturnType<ReturnType<typeof observe>['read']> | undefined;
	let backend = '', reason: string | undefined, rejected = false, errorText: string | undefined, callbacks = 0, deliveredSha256: string | undefined;
	let descriptor: unknown, admission: unknown, output: ArrayBuffer | undefined, actualReadback = false;
	let before: string | undefined, sourceSha256: string | undefined;
	const samples: { x: number; y: number; coverage: number; bits: readonly number[]; expected: readonly number[] }[] = [];
	try {
		for (let at = 0; at < pixels.length; at += 4) { pixels[at] = SOURCE[0]!; pixels[at + 1] = SOURCE[1]!; pixels[at + 2] = SOURCE[2]!; pixels[at + 3] = SOURCE[3]!; }
		pixels.set(DEFECT, (1024 * WIDTH + 1024) * 4);
		const frame = Object.freeze({ descriptor: Object.freeze({ schemaVersion: 1 as const, width: WIDTH, height: HEIGHT, sampleFormat: 'float32' as const, primaries: 'srgb' as const, transfer: 'linear' as const }), pixels });
		const develop = { ...defaultImageDevelopStateV2(), processVersion: 3, repairs: { schemaVersion: 1, spots: [{ id: 'large-heal', mode: 'heal', enabled: true,
			target: { x: .5, y: .5 }, source: { x: .125, y: .5 }, radius: 255 / WIDTH, feather: 0, opacity: 1 }] },
			effects: [{ id: 'large-tone', type: 'tone-ladder-v1', enabled: true, params: { exposure: 1 } }],
			masks: [{ schemaVersion: 1, id: 'large-mask', kind: 'mask', inputs: [], nodes: [
				{ id: 'gradient', kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
				{ id: 'feather', kind: 'feather', inputNodeId: 'gradient', radius: RADIUS }], outputNodeId: 'feather' }],
			maskBindings: [{ effectId: 'large-tone', maskId: 'large-mask' }] };
		const metadata = prepareLinearDevelopMetadataCurrentV1({ frame, develop }, PHOTO_DEVELOP_LINEAR_LIMITS_V1, {});
		const plan = prepareImageDevelopGpuPlanCurrentV1(metadata, original.byteLength), phase = plan.maskPhase;
		if (!phase?.repairPrefix) throw new TypeError('Capacity witness requires its private complete repair phase.');
		admission = { supported: !plan.unsupported, eligible: plan.eligible, peakWorkingBytes: phase.peakWorkingBytes,
			maximumMaskComponentBytes: phase.maximumMaskComponentBytes, imageTextureCount: phase.imageTextureCount, imageTextureBytes: phase.imageTextureBytes,
			referenceBytes: phase.referenceBytes, floatCaptureBytes: phase.floatCaptureBytes, repairGpuHaloBytes: phase.repairGpuHaloBytes,
			repairCpuScratchBytes: phase.repairCpuScratchBytes, halo: phase.repairPrefix.spots[0]!.halo, phases: phase.phases };
		before = digest(new Uint8Array(original)); const observed = observe(); observation = observed;
		try {
			await withImageDevelopGpuCurrentV1({ frame, develop }, (result, execution, overlay) => {
				callbacks++; backend = execution.backend; reason = execution.reason; descriptor = result.descriptor;
				if (overlay !== undefined) throw new TypeError('This4MP capacity witness must not request a selected overlay.');
				output = result.pixels.buffer; actualReadback = observed.containsReadback(output);
				deliveredSha256 = digest(new Uint8Array(output, result.pixels.byteOffset, result.pixels.byteLength));
				const words = new Uint32Array(output, result.pixels.byteOffset, result.pixels.length);
				for (const y of ROWS) for (const x of COLUMNS) { const at = (y * WIDTH + x) * 4, q = coverageAt(x);
					samples.push({ x, y, coverage: q, bits: [words[at]!, words[at + 1]!, words[at + 2]!, words[at + 3]!], expected: expectedWords(q) }); }
			}, PHOTO_DEVELOP_LINEAR_LIMITS_V1);
		} catch (error) { rejected = true; try { errorText = error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 512) : typeof error; } catch { errorText = 'opaque'; } }
		sourceSha256 = digest(new Uint8Array(original)); facts = observed.read();
	} finally { try { observation?.stop(); } finally { pixels.fill(0); } }
	if (!facts || before === undefined || sourceSha256 === undefined) throw new TypeError('Large native repair witness has no joined observation.');
	return { backend, reason, rejected, errorText, callbacks, descriptor, samples, actualReadback, before, sourceSha256, deliveredSha256, admission,
		sourceRetired: retired(original), outputRetired: output !== undefined && retired(output), observation: facts };
}
