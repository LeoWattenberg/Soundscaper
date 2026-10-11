/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../src/common/editor/closed-domain-value.ts';
import { admitStaticImageSourceV1 } from '../../src/common/editor/imaging/static-image-source-admission-v1.ts';
import { normalizeFramescaperImageSourceV2 } from '../../src/common/editor/timeline-image-model-v2.ts';
import { canonicalMediaContentBlob } from '../../src/common/editor/storage/media-content-digest.ts';
import { createFramescaperScapeNativeRuntime } from '../../src/framescaper/editor-scape-native.ts';
import { createFramescaperProjectStore } from '../../src/framescaper/editor-project-store.ts';
import { cloneFramescaperProject } from '../../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../src/framescaper/editor-project-runtime-profile.ts';
import { openFramescaperCurrentImageFrameSource, type FramescaperCurrentImageFrameReader } from '../../src/framescaper/timeline-image-current-frame-source.ts';
import { readPhotoDevelopSignalOptionsV2 } from '../../src/lightscaper/storage/photo-develop-preset-read-v2.ts';
import {
	validateDevelopFullResolutionRgbaV1,
	type DevelopFullResolutionReferenceStageV1,
	type DevelopFullResolutionReferenceValidationV1,
} from '../browser/helpers/lightscaper-develop-full-resolution-reference.ts';

export interface DevelopFullResolutionNativeRequestV1 {
	readonly body: Blob; readonly stage: DevelopFullResolutionReferenceStageV1; readonly signal?: AbortSignal;
}
export interface DevelopFullResolutionNativeOptionsV1 { readonly beforeClose?: () => Promise<void> }
interface CapturedNativeRequest {
	readonly body: Blob; readonly size: number; readonly stage: DevelopFullResolutionReferenceStageV1;
	readonly signal: AbortSignal | undefined; readonly beforeClose: (() => Promise<void>) | undefined;
}
const SIZE = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!, SLICE = Blob.prototype.slice, READ = Blob.prototype.arrayBuffer;
const LENGTH = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype) as object, 'byteLength')!.get!;
const FILL = Uint8Array.prototype.fill, CHECK = AbortSignal.prototype.throwIfAborted;
const WIDTH = 4096, HEIGHT = 3072, PIXEL_BYTES = 50_331_648;
function check(signal?: AbortSignal): void { if (signal !== undefined) Reflect.apply(CHECK, signal, []); }
function wipe(bytes: Uint8Array | Uint8ClampedArray | null): void {
	if (bytes && Number(Reflect.apply(LENGTH, bytes, [])) !== 0) Reflect.apply(FILL, bytes, [0]);
}
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

function capture(value: unknown, options: unknown, maximum: number): Readonly<CapturedNativeRequest> {
	const label = 'Full-resolution native observation', input = record(value, label, ['body', 'stage', 'signal'], ['body', 'stage']);
	const stage = field(input, 'stage', label);
	if (stage !== 'before' && stage !== 'dehaze' && stage !== 'sharpen50') throw new TypeError('Unsupported full-resolution reference stage.');
	const { signal } = readPhotoDevelopSignalOptionsV2(Object.hasOwn(input, 'signal') ? { signal: field(input, 'signal', label) } : {});
	const raw = field(input, 'body', label), size: unknown = Reflect.apply(SIZE, raw, []);
	if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 1 || size > maximum) throw new RangeError('Native observation body exceeds its admitted byte bound.');
	const body = Reflect.apply(SLICE, raw, [0, size]) as Blob;
	const ports = record(options, 'Native observation ports', ['beforeClose'], []);
	const before = Object.hasOwn(ports, 'beforeClose') ? field(ports, 'beforeClose', 'Native observation ports') : undefined;
	if (before !== undefined && typeof before !== 'function') throw new TypeError('Native observation requires a callable beforeClose port.');
	const beforeClose = before === undefined ? undefined : () => Reflect.apply(before, options, []) as Promise<void>;
	return { body, size, stage, signal, beforeClose };
}

function cleanupMethod(owner: object, key: string): () => void {
	for (let current: object | null = owner, depth = 0; current && depth < 32; depth++) {
		const descriptor = Object.getOwnPropertyDescriptor(current, key);
		if (descriptor) {
			if (!Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') throw new TypeError('Native cleanup must be a data method.');
			const method = descriptor.value as (...args: unknown[]) => unknown;
			return () => { Reflect.apply(method, owner, []); };
		}
		current = Object.getPrototypeOf(current) as object | null;
	}
	throw new TypeError('Native cleanup method is missing.');
}

function finish<Result>(result: Result | undefined, failed: boolean, primary: unknown, cleanup: readonly unknown[]): Result {
	if (failed && cleanup.length) throw new AggregateError([primary, ...cleanup], 'Native observation and joined cleanup failed.', { cause: primary });
	if (failed) throw primary;
	if (cleanup.length > 1) throw new AggregateError(cleanup, 'Native observation cleanup failed.');
	if (cleanup.length === 1) throw cleanup[0];
	if (result === undefined) throw new Error('Native observation produced no result.');
	return result;
}

function pngContainer(bytes: Uint8Array) {
	const admitted = admitStaticImageSourceV1(bytes);
	if (admitted.format !== 'png' || admitted.width !== WIDTH || admitted.height !== HEIGHT) throw new RangeError('PNG must have the fixed full-resolution extent.');
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let srgbIntent: number | null = null, iccProfileCount = 0;
	for (let offset = 8; offset < bytes.byteLength;) {
		const length = view.getUint32(offset), type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
		if (type === 'sRGB') srgbIntent = bytes[offset + 8]!;
		if (type === 'iCCP') iccProfileCount++;
		offset += length + 12;
	}
	return Object.freeze({ width: admitted.width, height: admitted.height, bitDepth: bytes[24]!, colorType: bytes[25]!, srgbIntent, iccProfileCount });
}

/** Decode the actual downloaded PNG through native ImageBitmap and an explicit
 * sRGB canvas, then compare every channel with the independent fixed reference.
 * Encoded input is <=64MiB; the owned readback is exactly48MiB. Native codec and
 * canvas storage are separate. No binary body or platform handle escapes. */
export async function inspectDevelopFullResolutionPngNativeV1(value: Readonly<DevelopFullResolutionNativeRequestV1>,
	options: Readonly<DevelopFullResolutionNativeOptionsV1> = {}) {
	const input = capture(value, options, 64 * 1024 * 1024);
	const createBitmap = globalThis.createImageBitmap, Canvas = globalThis.OffscreenCanvas;
	if (typeof createBitmap !== 'function' || typeof Canvas !== 'function') throw new TypeError('Native PNG observation requires ImageBitmap and OffscreenCanvas.');
	let bytes: Uint8Array<ArrayBuffer> | null = null, pixels: Uint8ClampedArray<ArrayBufferLike> | null = null;
	let bitmap: ImageBitmap | null = null, closeBitmap: (() => void) | null = null, canvas: OffscreenCanvas | null = null;
	let result: Readonly<{ encodedByteLength: number; encodedSha256: string; container: ReturnType<typeof pngContainer>;
		validation: DevelopFullResolutionReferenceValidationV1 }> | undefined;
	let failed = false, primary: unknown; const cleanup: unknown[] = [];
	try {
		check(input.signal); bytes = new Uint8Array(await (Reflect.apply(READ, input.body, []) as Promise<ArrayBuffer>)); check(input.signal);
		assert(bytes.byteLength === input.size, 'Native PNG snapshot byte length changed.');
		const container = pngContainer(bytes), encodedSha256 = bytesToHex(sha256(bytes));
		const body = Reflect.apply(SLICE, input.body, [0, input.size, 'image/png']) as Blob;
		bitmap = await Reflect.apply(createBitmap, globalThis, [body, {
			imageOrientation: 'from-image', premultiplyAlpha: 'none', colorSpaceConversion: 'default',
		}]) as ImageBitmap;
		closeBitmap = cleanupMethod(bitmap, 'close'); check(input.signal);
		assert(bitmap.width === WIDTH && bitmap.height === HEIGHT, 'Decoded native PNG dimensions differ from the full-resolution container.');
		canvas = new Canvas(WIDTH, HEIGHT);
		const context = canvas.getContext('2d', { alpha: true, willReadFrequently: true, colorSpace: 'srgb' });
		assert(context !== null, 'Native PNG observation has no sRGB canvas context.');
		context.clearRect(0, 0, WIDTH, HEIGHT); context.drawImage(bitmap, 0, 0, WIDTH, HEIGHT); check(input.signal);
		pixels = context.getImageData(0, 0, WIDTH, HEIGHT, { colorSpace: 'srgb' }).data;
		const validation = validateDevelopFullResolutionRgbaV1(pixels, input.stage); check(input.signal);
		result = Object.freeze({ encodedByteLength: input.size, encodedSha256, container, validation });
	} catch (error) { failed = true; primary = error; }
	if (bitmap) try { await input.beforeClose?.(); } catch (error) { cleanup.push(error); }
	if (canvas) {
		try { canvas.width = 0; } catch (error) { cleanup.push(error); }
		try { canvas.height = 0; } catch (error) { cleanup.push(error); }
	}
	try { closeBitmap?.(); } catch (error) { cleanup.push(error); }
	try { wipe(pixels); } catch (error) { cleanup.push(error); }
	try { wipe(bytes); } catch (error) { cleanup.push(error); }
	try { check(input.signal); } catch (error) { if (!failed) { failed = true; primary = error; } }
	return finish(result, failed, primary, cleanup);
}

/** Hash retained pack storage in64KiB owned spans, wiping every span. The
 * current Frame reader independently authenticates the pack before rendering. */
async function digestBlob(body: Blob, signal?: AbortSignal): Promise<string> {
	const size = Number(Reflect.apply(SIZE, body, [])), hash = sha256.create();
	try {
		for (let offset = 0; offset < size; offset += 65_536) {
			check(signal); const end = Math.min(size, offset + 65_536);
			const part = Reflect.apply(SLICE, body, [offset, end]) as Blob;
			const bytes = new Uint8Array(await (Reflect.apply(READ, part, []) as Promise<ArrayBuffer>));
			try { check(signal); assert(bytes.byteLength === end - offset, 'Retained pack span length changed.'); hash.update(bytes); }
			finally { wipe(bytes); }
		}
		return bytesToHex(hash.digest());
	} finally { hash.destroy(); }
}

/** Import the real menu-produced .fscape through current Frame Scape/storage
 * owners, then render its saved recipe at natural dimensions. This is a Frame
 * owner contract in the Light origin, not a separate-origin Frame UI claim.
 * ReadOriginal and ReadFrame storage are retired sequentially; the reader's
 * encoded snapshot and native store close are joined before scalar delivery. */
export async function inspectDevelopFullResolutionFramescaperNativeV1(value: Readonly<DevelopFullResolutionNativeRequestV1>,
	options: Readonly<DevelopFullResolutionNativeOptionsV1> = {}) {
	const input = capture(value, options, 256 * 1024 * 1024);
	check(input.signal);
	const store = createFramescaperProjectStore(PROFILE, { indexedDB: globalThis.indexedDB });
	const held: { reader: FramescaperCurrentImageFrameReader | null } = { reader: null };
	let originalBytes: Uint8Array | null = null, pixels: Uint8Array | null = null;
	let result: Awaited<ReturnType<typeof observeFrame>> | undefined;
	let failed = false, primary: unknown; const cleanup: unknown[] = [];
	async function observeFrame() {
		const imported = await createFramescaperScapeNativeRuntime(PROFILE).importScapeProject(input.body, store,
			input.signal === undefined ? {} : { signal: input.signal }); check(input.signal);
		assert(!imported.readOnly, 'The downloaded Frame copy must be editable.');
		const project = cloneFramescaperProject(PROFILE, imported.project);
		assert(project.sources.length === 1 && project.clips.length === 1 && project.projectBin.clips.length === 0
			&& project.sequences.length === 1 && project.tracks.length === 1, 'The full-resolution fixture requires one actual source and timeline placement.');
		const source = normalizeFramescaperImageSourceV2(project.sources[0]), clip = project.clips[0]!, sequence = project.sequences[0]!;
		assert(clip.kind === 'image' && clip.sourceId === source.id && clip.sequenceId === sequence.id
			&& project.primarySequenceId === sequence.id, 'The recipient image clip and sequence do not bind its actual source.');
		assert(source.canonical.width === WIDTH && source.canonical.height === HEIGHT && !source.canonical.hasAlpha
			&& source.canonical.frameCount === 1 && source.developed.width === WIDTH && source.developed.height === HEIGHT,
		'The saved source must retain the fixed opaque canonical and natural geometry.');
		const savedValue = await store.loadProject(project.id, input.signal === undefined ? {} : { signal: input.signal }); check(input.signal);
		assert(savedValue !== null, 'The actual recipient did not retain its project.');
		const saved = cloneFramescaperProject(PROFILE, savedValue);
		assert(JSON.stringify(saved) === JSON.stringify(project), 'The actual saved recipient differs from its imported project.');
		const packed = await store.loadMediaAsset(source.storageKey, input.signal === undefined ? {} : { signal: input.signal }); check(input.signal);
		assert(packed !== null, 'The retained native source pack is missing.');
		const packBody = canonicalMediaContentBlob(packed);
		assert(Reflect.apply(SIZE, packBody, []) === source.assetByteLength, 'The retained native source pack length changed.');
		const packSha = await digestBlob(packBody, input.signal);
		assert(packSha === source.contentSha256, 'The retained native source pack SHA-256 changed.');
		const reader = await openFramescaperCurrentImageFrameSource(store, source, input.signal);
		held.reader = reader; check(input.signal);
		originalBytes = await reader.readOriginal(input.signal); check(input.signal);
		const originalSha = bytesToHex(sha256(originalBytes)), originalSize = Number(Reflect.apply(LENGTH, originalBytes, []));
		assert(originalSha === source.original.sha256 && originalSize === source.original.byteLength,
			'The actual recipient original differs from its retained source identity.');
		const original = Object.freeze({ sha256: originalSha, byteLength: originalSize, exactName: source.provenance.original.exactName });
		wipe(originalBytes); originalBytes = null;
		pixels = await reader.readFrame(0, input.signal); check(input.signal);
		assert(Number(Reflect.apply(LENGTH, pixels, [])) === PIXEL_BYTES, 'The natural recipient frame byte extent changed.');
		const validation = validateDevelopFullResolutionRgbaV1(pixels, input.stage); check(input.signal);
		return Object.freeze({ project: Object.freeze({ id: project.id, revision: project.revision,
			savedRevision: saved.revision, primarySequenceId: project.primarySequenceId }), source, clip: Object.freeze(clip),
			sequence: Object.freeze(sequence), original, pack: Object.freeze({ sha256: packSha, byteLength: source.assetByteLength }), validation });
	}
	try { result = await observeFrame(); } catch (error) { failed = true; primary = error; }
	try { await input.beforeClose?.(); } catch (error) { cleanup.push(error); }
	try { await held.reader?.closeAndJoin(); } catch (error) { cleanup.push(error); }
	try { await store.close(); } catch (error) { cleanup.push(error); }
	try { wipe(originalBytes); } catch (error) { cleanup.push(error); }
	try { wipe(pixels); } catch (error) { cleanup.push(error); }
	try { check(input.signal); } catch (error) { if (!failed) { failed = true; primary = error; } }
	return finish(result, failed, primary, cleanup);
}
