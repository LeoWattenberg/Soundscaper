/* SPDX-License-Identifier: AGPL-3.0-only */

import { withImageDevelopGpuCurrentV1 } from '../../../src/common/editor/imaging/image-develop-gpu-current-v1.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../../../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1 } from '../../../src/common/editor/photo-library-develop-linear-port-v1.ts';
import type { MaskRasterSourcePortV1 } from '../../../src/common/editor/imaging/mask-raster-source-port-v1.ts';
import { readRawImportCustodyCurrentV1 } from './lightscaper-raw-import-current-reference.ts';
import { readRepairFramePhotoCustodyNativeV1 } from './lightscaper-repair-frame-current-reference.ts';
import { startGpuSpatialObservationCurrentV1, readGpuSpatialObservationCurrentV1, stopGpuSpatialObservationCurrentV1 } from './lightscaper-native-gpu-spatial-current-reference.ts';

const CROSS = Object.freeze([0, 255, 0, 0, 255, 255, 255, 0, 0, 255, 0, 0, 0, 0, 0, 0]);
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const bits = (pixels: Float32Array<ArrayBuffer>) => [...new Uint32Array(pixels.buffer, pixels.byteOffset, pixels.length)];
const retired = (buffer: ArrayBuffer) => Number(Reflect.apply(SIZE, buffer, [])) === 0 || new Uint8Array(buffer).every(n => n === 0);
type Body = Readonly<{ reference: Readonly<{ storageKey: string; sha256: string; width: number; height: number; byteLength: number }>; bytes: readonly number[] }>;
interface Draw { readonly program: 'node' | 'blend' | 'overlay'; readonly kind: number; readonly width: number; readonly height: number }
interface State { id: number; program: WebGLProgram | null; width: number; height: number; nodeKind: number; overlayKind: number; draws: Draw[]; serial: number; finished: number }
interface IntegerTarget { readonly id: number; version: number; readonly width: number; readonly height: number; readonly format: 'r8ui' | 'r32ui'; readonly gl: WebGL2RenderingContext }
interface IntegerRead { readonly context: number; readonly target: number; readonly version: number; readonly targetWidth: number; readonly targetHeight: number;
	readonly internalFormat: 'r8ui' | 'r32ui'; readonly x: number; readonly y: number; readonly width: number; readonly height: number;
	readonly format: 'rgba-integer'; readonly type: 'unsigned-int'; readonly coverage: readonly number[]; readonly draws: readonly Draw[] }
interface FloatRead { readonly width: number; readonly height: number; readonly bits: readonly number[]; readonly draws: readonly Draw[] }
let installed: ReturnType<typeof observe> | undefined;

/** Read-only native owners authenticate the unchanged RAW Original, retained
 * recipe and installed SCMASK01 body. No import/publication port is exposed. */
export async function readGpuMaskPhotoCustodyCurrentV1(photoId: string) {
	const raw = await readRawImportCustodyCurrentV1(photoId), resources = await readRepairFramePhotoCustodyNativeV1([photoId]);
	if (JSON.stringify(resources.photos[0]?.photo) !== JSON.stringify(raw.photo)) throw new Error('Mask custody observations crossed a Photo change.');
	return { ...raw, bodies: resources.bodies, resourceRecords: resources.resourceRecords, resources: resources.resources };
}

export function gpuMaskAuthoredEffectParamsCurrentV1() {
	return { tone: { exposure: -1, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 },
		geometry: { cropX: .25, cropY: 0, cropWidth: .5, cropHeight: .25, aspect: 0, rotationDegrees: 90,
			flipHorizontal: 1, flipVertical: 0, perspective: 0, topLeftX: 0, topLeftY: 0, topRightX: 1,
			topRightY: 0, bottomRightX: 1, bottomRightY: 1, bottomLeftX: 0, bottomLeftY: 1 } };
}

/** Literal hard-brush and power-of-two exposure oracle, independent of mask,
 * geometry, Develop, GPU and byte-display implementations. The authored crop
 * selects columns8..23/rows0..7; clockwise90 followed by horizontal flip is
 * their transpose to8×16. Nearest brush mapping expands each4×4 cell to8×8. */
export function gpuMaskWordsReferenceCurrentV1(value: Readonly<{ words: readonly number[]; suffix: boolean }>) {
	const source = native(value.words), width = value.suffix ? 8 : 32, height = value.suffix ? 16 : 32;
	const output = new Float32Array(width * height * 4), coverage = new Uint8Array(width * height);
	try {
		for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
			const sx = value.suffix ? 8 + y : x, sy = value.suffix ? x : y, at = (y * width + x) * 4, from = (sy * 32 + sx) * 4;
			const amount = CROSS[Math.floor(sy / 8) * 4 + Math.floor(sx / 8)]!; coverage[y * width + x] = amount;
			for (let channel = 0; channel < 3; channel++) output[at + channel] = amount === 255 ? source[from + channel]! / 2 : source[from + channel]!;
			output[at + 3] = 1;
		}
		return { width, height, before: display(source), after: display(output), bits: bits(output), sourceBits: bits(source), coverage: [...coverage],
			body: [83, 67, 77, 65, 83, 75, 48, 49, 4, 0, 0, 0, 4, 0, 0, 0, ...CROSS] };
	} finally { source.fill(0); output.fill(0); coverage.fill(0); }
}

/** The real shared broker receives copies of actual native words, exact saved
 * recipe and installed native body. This separate diagnostic can demand an
 * accepted webgl2 callback; none of its frames/callbacks enter application UI. */
export async function qualifyGpuMaskWordsCurrentV1(value: Readonly<{ words: readonly number[]; develop: unknown; bodies: readonly Body[] }>) {
	const pixels = native(value.words), develop = normalizeImageDevelopStateCurrentV1(value.develop);
	if (develop.maskBindings.length !== 1 || value.bodies.length !== 1) throw new RangeError('Mask UI qualification requires one installed binding/body.');
	const selection = develop.maskBindings[0]!, backings: ArrayBuffer[] = [];
	let callbacks = 0, reads = 0, active = 0, outputBacking: ArrayBuffer | undefined, overlayBacking: ArrayBuffer | undefined;
	const source: MaskRasterSourcePortV1 = { async withBytes(reference, consume, options) {
		if (this !== source || active) throw new Error('Installed brush receiver changed or borrows overlapped.');
		const body = value.bodies.find(body => body.reference.storageKey === reference.storageKey);
		if (!body || (['storageKey', 'sha256', 'width', 'height', 'byteLength'] as const).some(key => body.reference[key] !== reference[key])) throw new Error('Installed brush complete identity changed.');
		options?.signal?.throwIfAborted(); const snapshot = Uint8Array.from(body.bytes); backings.push(snapshot.buffer); reads++; active++;
		try { return await consume(snapshot); } finally { snapshot.fill(0); active--; }
	} };
	try {
		const result = await withImageDevelopGpuCurrentV1({ frame: { descriptor: { schemaVersion: 1, width: 32, height: 32,
			sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' }, pixels }, develop, maskOverlay: selection }, (frame, execution, overlay) => {
			callbacks++; outputBacking = frame.pixels.buffer;
			if (!overlay) throw new Error('Selected GPU mask overlay was not delivered.'); overlayBacking = overlay.coverage.buffer;
			return { ...execution, descriptor: frame.descriptor, bits: bits(frame.pixels), coverage: [...overlay.coverage],
				overlay: { effectId: overlay.effectId, maskId: overlay.maskId, width: overlay.width, height: overlay.height }, activeAtDelivery: active };
		}, PHOTO_DEVELOP_LINEAR_LIMITS_V1, { maskSource: source });
		return { ...result, callbacks, reads, sourceBits: bits(pixels), sourceRetired: backings.every(retired),
			outputRetired: outputBacking !== undefined && retired(outputBacking), overlayRetired: overlayBacking !== undefined && retired(overlayBacking) };
	} finally { pixels.fill(0); }
}

export function startGpuMaskUiObservationCurrentV1(): void {
	if (installed) throw new Error('Mask UI observer is already installed.'); installed = observe();
}
export function readGpuMaskUiObservationCurrentV1() {
	if (!installed) throw new Error('Mask UI observer is absent.'); return installed.read();
}
export function stopGpuMaskUiObservationCurrentV1(): void { installed?.stop(); installed = undefined; }
export function resetGpuMaskUiObservationCurrentV1(): void { stopGpuMaskUiObservationCurrentV1(); startGpuMaskUiObservationCurrentV1(); }

/** Transparent native calls only: integer graph/blend/suffix programs and real
 * R8UI/FLOAT transfers. Draws are attempts, never an accepted backend claim. */
function observe() {
	startGpuSpatialObservationCurrentV1({ width: 32, height: 32 });
	const restores: { owner: object; key: string; descriptor: PropertyDescriptor }[] = [];
	const locations = new Map<object, string>(), kinds = new Map<object, Draw['program']>(), states = new Map<WebGL2RenderingContext, State>();
	const integer: IntegerRead[] = [], floats: FloatRead[] = [], buffers = new Set<ArrayBuffer>(), textures = new Set<WebGLTexture>();
	const cleared = new Map<WebGLTexture, number>(), integerTargets = new Map<WebGLTexture, IntegerTarget>();
	let targetSerial = 0, versionSerial = 0, deletes = 0, deletesBeforeClear = 0, deletesBeforeFinish = 0;
	const state = (gl: WebGL2RenderingContext) => {
		let value = states.get(gl); if (!value) { value = { id: states.size + 1, program: null, width: 0, height: 0, nodeKind: 0, overlayKind: 0, draws: [], serial: 0, finished: 0 }; states.set(gl, value); } return value;
	};
	const attached = (gl: WebGL2RenderingContext, read = false): WebGLTexture | null => gl.getParameter(read ? gl.READ_FRAMEBUFFER_BINDING : gl.DRAW_FRAMEBUFFER_BINDING)
		? gl.getFramebufferAttachmentParameter(read ? gl.READ_FRAMEBUFFER : gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME) as WebGLTexture | null : null;
	const prototype = typeof WebGL2RenderingContext === 'undefined' ? null : WebGL2RenderingContext.prototype;
	const install = (key: string, after: (gl: WebGL2RenderingContext, args: unknown[], result: unknown) => void) => {
		let owner: object | null = prototype; while (owner && !Object.hasOwn(owner, key)) owner = Object.getPrototypeOf(owner) as object | null;
		if (!owner) return; const descriptor = Object.getOwnPropertyDescriptor(owner, key)!, original = descriptor.value as (...args: unknown[]) => unknown;
		restores.push({ owner, key, descriptor }); Object.defineProperty(owner, key, { ...descriptor, value: function (this: WebGL2RenderingContext, ...args: unknown[]) {
			const result = Reflect.apply(original, this, args); after(this, args, result); return result;
		} });
	};
	install('getUniformLocation', (_gl, args, result) => {
		if (!result || typeof result !== 'object' || typeof args[1] !== 'string' || !args[0] || typeof args[0] !== 'object') return;
		locations.set(result, args[1]); if (args[1] === 'uNodeKind') kinds.set(args[0], 'node');
		if (args[1] === 'uBlendPolicy') kinds.set(args[0], 'blend'); if (args[1] === 'uOverlayKind') kinds.set(args[0], 'overlay');
	});
	install('useProgram', (gl, args) => { state(gl).program = args[0] as WebGLProgram | null; });
	install('uniform1i', (gl, args) => { const name = args[0] && typeof args[0] === 'object' ? locations.get(args[0]) : undefined;
		if (name === 'uNodeKind') state(gl).nodeKind = Number(args[1]); if (name === 'uOverlayKind') state(gl).overlayKind = Number(args[1]); });
	install('viewport', (gl, args) => { state(gl).width = Number(args[2]); state(gl).height = Number(args[3]); });
	install('texImage2D', (gl, args) => { if (args[2] === gl.R8UI || args[2] === gl.R32UI) {
		const texture = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture; textures.add(texture); cleared.delete(texture);
		integerTargets.set(texture, { id: integerTargets.get(texture)?.id ?? ++targetSerial, version: ++versionSerial, width: Number(args[3]), height: Number(args[4]),
			format: args[2] === gl.R8UI ? 'r8ui' : 'r32ui', gl });
	} });
	install('texSubImage2D', (gl) => { const target = integerTargets.get(gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture); if (target) target.version = ++versionSerial; });
	install('drawArrays', (gl) => {
		const current = state(gl), program = current.program && kinds.get(current.program);
		if (program) { if (current.draws.length >= 256) throw new Error('Mask UI program observation exceeded256 draws.');
			current.draws.push({ program, kind: program === 'node' ? current.nodeKind : program === 'overlay' ? current.overlayKind : 0, width: current.width, height: current.height }); }
		const texture = attached(gl);
		if (texture) { cleared.delete(texture); const target = integerTargets.get(texture); if (target) target.version = ++versionSerial; }
	});
	install('readPixels', (gl, args) => {
		const current = state(gl), width = Number(args[2]), height = Number(args[3]), output = args[6];
		if (!current.draws.length || width < 1 || height < 1 || width * height > 1024) return;
		if (args[4] === gl.RGBA_INTEGER && args[5] === gl.UNSIGNED_INT && output instanceof Uint32Array) {
			if (integer.length >= 128 || output.length < width * height * 4) throw new Error('Mask UI integer readback exceeded its bound.');
			const texture = attached(gl, true), target = texture && integerTargets.get(texture);
			if (!target || target.gl !== gl) throw new Error('Mask UI integer stripe lost its actual native target.');
			integer.push({ context: current.id, target: target.id, version: target.version, targetWidth: target.width, targetHeight: target.height, internalFormat: target.format,
				x: Number(args[0]), y: Number(args[1]), width, height, format: 'rgba-integer', type: 'unsigned-int',
				coverage: Array.from({ length: width * height }, (_, at) => output[at * 4]!), draws: current.draws.map(draw => ({ ...draw })) }); buffers.add(output.buffer as ArrayBuffer);
		}
		if (args[5] === gl.FLOAT && output instanceof Float32Array) {
			if (floats.length >= 32 || output.length !== width * height * 4) throw new Error('Mask UI Float32 readback exceeded its bound.');
			floats.push({ width, height, bits: bits(output as Float32Array<ArrayBuffer>), draws: current.draws.map(draw => ({ ...draw })) }); buffers.add(output.buffer as ArrayBuffer);
		}
	});
	install('clearBufferuiv', (gl, args) => {
		const texture = attached(gl), target = texture && integerTargets.get(texture); if (target) target.version = ++versionSerial;
		if (texture && textures.has(texture) && args[2] instanceof Uint32Array && [...args[2]].every(n => n === 0)) cleared.set(texture, ++state(gl).serial);
	});
	install('finish', gl => { state(gl).finished = state(gl).serial; });
	install('deleteTexture', (gl, args) => { const texture = args[0] as WebGLTexture;
		if (textures.has(texture)) { deletes++; if (!cleared.has(texture)) deletesBeforeClear++; if ((cleared.get(texture) ?? Infinity) > state(gl).finished) deletesBeforeFinish++; }
	});
	return { read: () => ({ ...readGpuSpatialObservationCurrentV1(), integerReads: integer, maskedFloatReads: floats,
		maskDraws: [...states.values()].flatMap(value => value.draws), nativeMaskBuffersRetired: [...buffers].every(retired), integerDeletes: deletes, deletesBeforeClear, deletesBeforeFinish }),
		stop() { for (const restore of restores.reverse()) Object.defineProperty(restore.owner, restore.key, restore.descriptor); stopGpuSpatialObservationCurrentV1(); } };
}

function native(words: readonly number[]): Float32Array<ArrayBuffer> {
	if (words.length !== 4096 || words.some((n, at) => !Number.isInteger(n) || n < 0 || n > 65535 || at % 4 === 3 && n !== 65535)) throw new RangeError('Mask UI requires actual opaque32² native words.');
	return Float32Array.from(words, n => n / 65535);
}
function display(values: Float32Array<ArrayBuffer>): number[] {
	return [...values].map((n, at) => { if (at % 4 === 3) return Math.round(n * 255); const value = Math.max(0, Math.min(1, n));
		return Math.round((value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055) * 255); });
}
