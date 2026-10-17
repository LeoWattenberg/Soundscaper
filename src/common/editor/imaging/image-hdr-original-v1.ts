/* SPDX-License-Identifier: AGPL-3.0-only */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { admitPixelFrameV1 } from './pixel-frame-admission-v1.ts';
import { readPixelFrameV1, type PixelFrameDescriptorV1 } from './pixel-frame-contract-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1, RepairTaskBudgetV1, withRepairPixelFrameLifetimeV1 } from './pixel-frame-repair-lifetime-v1.ts';
import { IMAGE_HDR_ORIGINAL_MAGIC_V1, IMAGE_HDR_ORIGINAL_LIMITS_V1 as LIMITS } from './image-hdr-original-profile-v1.ts';
import { normalizeImageHdrOriginalProvenanceV1,
	serializeImageHdrOriginalProvenanceV1, type ImageHdrOriginalProvenanceV1 } from './image-hdr-original-contract-v1.ts';

export interface ImageHdrOriginalFrameV1 {
	readonly descriptor: Readonly<PixelFrameDescriptorV1 & { sampleFormat: 'float32'; primaries: 'srgb'; transfer: 'linear' }>;
	readonly pixels: Float32Array<ArrayBuffer>;
}
export interface ImageHdrOriginalReadV1 {
	readonly descriptor: ImageHdrOriginalFrameV1['descriptor'];
	readonly provenance: Readonly<ImageHdrOriginalProvenanceV1>;
	readonly payloadOffset: number;
	readonly payloadBytes: number;
	/** SHA256 of the stored RGBFloat32LE payload, excluding header/metadata. */
	readonly pixelsSha256: string;
	readonly metadataSha256: string;
}
export interface ImageHdrOriginalDecodedV1 {
	readonly frame: Readonly<ImageHdrOriginalFrameV1>;
	readonly provenance: Readonly<ImageHdrOriginalProvenanceV1>;
	readonly pixelsSha256: string;
	readonly metadataSha256: string;
}
interface Binary { readonly bytes: Uint8Array<ArrayBuffer>; readonly physicalBytes: number; }
type Envelope = Omit<ImageHdrOriginalReadV1, 'pixelsSha256'>;
const NativeBytes = Uint8Array, NativeFloats = Float32Array, NativeView = DataView;
const TYPED = Object.getPrototypeOf(NativeBytes.prototype) as object;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!, OFFSET = Object.getOwnPropertyDescriptor(TYPED, 'byteOffset')!.get!;
const LENGTH = Object.getOwnPropertyDescriptor(TYPED, 'byteLength')!.get!;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!, RESIZABLE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')!.get!;
const SET = NativeBytes.prototype.set, FILL = NativeBytes.prototype.fill;
const GET32 = NativeView.prototype.getUint32, PUT32 = NativeView.prototype.setUint32, GETFLOAT = NativeView.prototype.getFloat32, PUTFLOAT = NativeView.prototype.setFloat32;
const HEADER = new TextEncoder().encode(IMAGE_HDR_ORIGINAL_MAGIC_V1), RESERVE = 256 * 1024, HASH_SPAN = 65_532;
const FRAME_LIMITS = Object.freeze({ maximumSidePixels: LIMITS.maximumSide, maximumPixels: LIMITS.maximumPixels, maximumBytes: LIMITS.maximumDecodedBytes });
const PROFILES = Object.freeze([{ sampleFormat: 'float32', transfer: 'linear', primaries: 'srgb' }]);

/** Lossless generated Original, never a tone-mapped export. Source samples and
 * metadata are captured before the first await. Only the returned body escapes;
 * the private native snapshot is physically retired on every outcome. */
export async function encodeImageHdrOriginalV1(frameValue: unknown, provenanceValue: unknown,
	options: Readonly<{ signal?: AbortSignal }> = {}): Promise<Uint8Array<ArrayBuffer>> {
	const signal = signalBeforeMetadata(options), check = () => { checkRepairSignalV1(signal); };
	const prepared = (() => { try {
		check(); record(options, 'HDR encode options', ['signal'], []);
		const provenance = normalizeImageHdrOriginalProvenanceV1(provenanceValue);
		const raw = field(frameValue as Readonly<Record<string, unknown>>, 'descriptor', 'HDR source frame');
		const plan = admitPixelFrameV1(raw, { profiles: PROFILES, limits: FRAME_LIMITS });
		if (plan.descriptor.width !== provenance.output.width || plan.descriptor.height !== provenance.output.height) throw new RangeError('HDR frame extent differs from its provenance.');
		const input = record(frameValue, 'HDR source frame', ['descriptor', 'pixels']);
		const source = readPixelFrameV1({ descriptor: plan.descriptor, pixels: field(input, 'pixels', 'HDR source frame') }, FRAME_LIMITS);
		if (source.descriptor.sampleFormat !== 'float32') throw new TypeError('HDR source requires Float32 samples.');
		const metadata = new TextEncoder().encode(serializeImageHdrOriginalProvenanceV1(provenance));
		const payloadOffset = aligned(LIMITS.headerBytes + metadata.byteLength), payloadBytes = plan.pixelCount * 12, length = payloadOffset + payloadBytes;
		const backing = Reflect.apply(BUFFER, source.pixels, []) as ArrayBuffer, sourceBytes = Number(Reflect.apply(SIZE, backing, []));
		if (length > LIMITS.maximumEncodedBytes || sourceBytes + plan.byteLength + length + RESERVE > LIMITS.maximumWorkingBytes) throw new RangeError('HDR encoding exceeds its encoded or physical working budget.');
		check(); return { source, backing, sourceBytes, plan, metadata, payloadOffset, payloadBytes, length };
	} catch (error) { check(); throw error; } })();
	const output = new NativeBytes(prepared.length), outputBacking = output.buffer;
	try {
		await withRepairPixelFrameLifetimeV1(async owner => {
			const snapshot = owner.bytes(prepared.plan.byteLength);
			const offset = Number(Reflect.apply(OFFSET, prepared.source.pixels, []));
			Reflect.apply(SET, snapshot, [new NativeBytes(prepared.backing, offset, prepared.plan.byteLength)]);
			const samples = new NativeFloats(snapshot.buffer), view = new NativeView(outputBacking), budget = new RepairTaskBudgetV1(check);
			Reflect.apply(SET, output, [HEADER]);
			for (const [at, value] of [[8, 64], [12, 1], [16, prepared.plan.descriptor.width], [20, prepared.plan.descriptor.height],
				[24, prepared.metadata.byteLength], [28, prepared.payloadBytes]] as const) Reflect.apply(PUT32, view, [at, value, true]);
			const metadataHash = sha256(prepared.metadata);
			try { Reflect.apply(SET, output, [metadataHash, 32]); } finally { Reflect.apply(FILL, metadataHash, [0]); }
			Reflect.apply(SET, output, [prepared.metadata, 64]);
			for (let pixel = 0; pixel < prepared.plan.pixelCount; pixel++) {
				if (samples[pixel * 4 + 3] !== 1) throw new RangeError('HDR Original requires opaque alpha exactly one.');
				for (let channel = 0; channel < 3; channel++) Reflect.apply(PUTFLOAT, view, [prepared.payloadOffset + (pixel * 3 + channel) * 4, samples[pixel * 4 + channel]!, true]);
				if (budget.visit()) await budget.yield();
			}
			check();
		});
		check(); return output;
	} catch (error) {
		let retirement: { readonly error: unknown } | undefined;
		try { retire(outputBacking, prepared.length); }
		catch (cleanup) { retirement = { error: cleanup }; }
		if (retirement) throw new AggregateError([error, retirement.error], 'HDR encoding and physical retirement failed.', { cause: error });
		throw error;
	}
}

/** Inert format/body admission. This proves exact internal consistency, not
 * the external Original SHA or authenticity of the claimed source inputs. */
export function readImageHdrOriginalV1(value: unknown): Readonly<ImageHdrOriginalReadV1> {
	const source = binary(value), plan = envelope(source.bytes);
	if (source.physicalBytes + RESERVE > LIMITS.maximumWorkingBytes) throw new RangeError('HDR body exceeds its physical read budget.');
	const view = new NativeView(source.bytes.buffer, source.bytes.byteOffset, source.bytes.byteLength);
	for (let at = plan.payloadOffset; at < source.bytes.byteLength; at += 4) {
		if ((Number(Reflect.apply(GET32, view, [at, true])) & 0x7f800000) === 0x7f800000) throw new RangeError('HDR Original RGB samples must be finite.');
	}
	return Object.freeze({ ...plan, pixelsSha256: digest(new NativeBytes(source.bytes.buffer, source.bytes.byteOffset + plan.payloadOffset, plan.payloadBytes)) });
}

/** Snapshot first, then decode into an independently owned RGBA plane. The
 * encoded snapshot fully retires BEFORE consume begins. No encoded-source
 * read or detachment check occurs during/after consume, so its caller may
 * release/wipe/transfer that source at callback entry before Develop starts. */
export async function withDecodedImageHdrOriginalV1<Result>(value: unknown,
	consume: (view: Readonly<ImageHdrOriginalDecodedV1>) => Result | Promise<Result>): Promise<Result> {
	const signal = signalBeforeMetadata(value), check = () => { checkRepairSignalV1(signal); };
	const prepared = (() => { try {
		check(); const input = record(value, 'HDR decode request', ['bytes', 'signal'], ['bytes']);
		if (typeof consume !== 'function') throw new TypeError('HDR decoding requires a scoped consumer.');
		const source = binary(field(input, 'bytes', 'HDR decode request')), plan = envelope(source.bytes);
		const decodedBytes = plan.descriptor.width * plan.descriptor.height * 16;
		if (source.physicalBytes + source.bytes.byteLength + decodedBytes + RESERVE > LIMITS.maximumWorkingBytes) throw new RangeError('HDR decoding exceeds its physical working budget.');
		check(); return { source, plan, decodedBytes };
	} catch (error) { check(); throw error; } })();
	return withRepairPixelFrameLifetimeV1(async decodedOwner => {
		let frame: Readonly<ImageHdrOriginalFrameV1> | undefined;
		const parsed = await withRepairPixelFrameLifetimeV1(async encodedOwner => {
			const snapshot = encodedOwner.bytes(prepared.source.bytes.byteLength); Reflect.apply(SET, snapshot, [prepared.source.bytes]);
			const plan = envelope(snapshot), bytes = decodedOwner.bytes(prepared.decodedBytes), pixels = new NativeFloats(bytes.buffer);
			const view = new NativeView(snapshot.buffer), hash = sha256.create(), budget = new RepairTaskBudgetV1(check);
			let hashed = plan.payloadOffset;
			try {
				for (let pixel = 0; pixel < plan.payloadBytes / 12; pixel++) {
					for (let channel = 0; channel < 3; channel++) {
						const sample = Number(Reflect.apply(GETFLOAT, view, [plan.payloadOffset + (pixel * 3 + channel) * 4, true]));
						if (!Number.isFinite(sample)) throw new RangeError('HDR Original RGB samples must be finite.'); pixels[pixel * 4 + channel] = sample;
					}
					pixels[pixel * 4 + 3] = 1;
					const end = plan.payloadOffset + (pixel + 1) * 12;
					if (end - hashed >= HASH_SPAN) { hash.update(new NativeBytes(snapshot.buffer, hashed, end - hashed)); hashed = end; }
					if (budget.visit()) await budget.yield();
				}
				if (hashed < snapshot.length) hash.update(new NativeBytes(snapshot.buffer, hashed, snapshot.length - hashed));
				check(); frame = Object.freeze({ descriptor: plan.descriptor, pixels });
				const digestBytes = hash.digest();
				try { return Object.freeze({ ...plan, pixelsSha256: bytesToHex(digestBytes) }); } finally { Reflect.apply(FILL, digestBytes, [0]); }
			} finally { hash.destroy(); }
		});
		check(); if (!frame) throw new Error('HDR decoding has no admitted native result.');
		const backing = Reflect.apply(BUFFER, frame.pixels, []) as ArrayBuffer;
		let outcome: { value: Result } | { error: unknown };
		try {
			const result = await consume(Object.freeze({ frame, provenance: parsed.provenance, pixelsSha256: parsed.pixelsSha256, metadataSha256: parsed.metadataSha256 }));
			check(); outcome = { value: result };
		} catch (error) { outcome = { error }; }
		const failures: unknown[] = 'error' in outcome ? [outcome.error] : [];
		try { await verifyDecoded(backing, prepared.decodedBytes, parsed.pixelsSha256, signal); }
		catch (error) { if (!failures.some(reason => Object.is(reason, error))) failures.push(error); }
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) throw new AggregateError(failures, 'HDR consumer and immutable native integrity failed.', { cause: failures[0] });
		if ('value' in outcome) return outcome.value;
		throw new Error('HDR consumer has no admitted outcome.');
	});
}

/** Only the private decoded allocation is consulted after delivery. A detached
 * plane is left to its one owning physical retirement check, avoiding duplicate
 * errors for the same lost allocation. Hash scratch never exceeds64KiB. */
async function verifyDecoded(backing: ArrayBuffer, length: number, expected: string, signal?: AbortSignal): Promise<void> {
	if (Reflect.apply(SIZE, backing, []) !== length) return;
	return withRepairPixelFrameLifetimeV1(async owner => {
		const scratch = owner.bytes(HASH_SPAN), view = new NativeView(scratch.buffer), samples = new NativeFloats(backing);
		const hash = sha256.create(), budget = new RepairTaskBudgetV1(() => { checkRepairSignalV1(signal); }); let written = 0;
		try {
			for (let pixel = 0; pixel < length / 16; pixel++) {
				if (Reflect.apply(SIZE, backing, []) !== length) return;
				if (samples[pixel * 4 + 3] !== 1) throw new RangeError('HDR borrowed alpha changed from its authenticated opaque value.');
				for (let channel = 0; channel < 3; channel++) {
					const sample = samples[pixel * 4 + channel]!;
					if (!Number.isFinite(sample)) throw new RangeError('HDR borrowed RGB integrity changed to a nonfinite value.');
					Reflect.apply(PUTFLOAT, view, [written, sample, true]); written += 4;
				}
				if (written === HASH_SPAN) { hash.update(scratch); written = 0; }
				if (budget.visit()) await budget.yield();
			}
			if (written) hash.update(new NativeBytes(scratch.buffer, 0, written));
			const result = hash.digest();
			try { if (bytesToHex(result) !== expected) throw new RangeError('HDR borrowed RGB integrity changed from its authenticated payload.'); }
			finally { Reflect.apply(FILL, result, [0]); }
		} finally { hash.destroy(); }
	});
}

function envelope(bytes: Uint8Array<ArrayBuffer>): Readonly<Envelope> {
	const view = new NativeView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (HEADER.some((byte, index) => bytes[index] !== byte) || Reflect.apply(GET32, view, [8, true]) !== 64 || Reflect.apply(GET32, view, [12, true]) !== 1) throw new RangeError('Unsupported HDR Original header/version.');
	const width = Number(Reflect.apply(GET32, view, [16, true])), height = Number(Reflect.apply(GET32, view, [20, true]));
	admitPixelFrameV1(descriptor(width, height), { profiles: PROFILES, limits: FRAME_LIMITS });
	const metadataBytes = Number(Reflect.apply(GET32, view, [24, true])), payloadBytes = Number(Reflect.apply(GET32, view, [28, true]));
	const payloadOffset = aligned(64 + metadataBytes);
	if (metadataBytes < 1 || metadataBytes > LIMITS.maximumMetadataBytes || payloadBytes !== width * height * 12 || payloadOffset + payloadBytes !== bytes.byteLength) throw new RangeError('HDR body lengths disagree with their admitted extent.');
	const metadata = new NativeBytes(bytes.buffer, bytes.byteOffset + 64, metadataBytes), metadataSha256 = digest(metadata);
	if (metadataSha256 !== bytesToHex(new NativeBytes(bytes.buffer, bytes.byteOffset + 32, 32))) throw new RangeError('HDR provenance SHA256 differs from its header.');
	const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(metadata);
	const raw: unknown = JSON.parse(text), provenance = normalizeImageHdrOriginalProvenanceV1(raw);
	if (text !== serializeImageHdrOriginalProvenanceV1(provenance)) throw new RangeError('HDR metadata must use exact canonical JSON.');
	if (provenance.output.width !== width || provenance.output.height !== height) throw new RangeError('HDR header extent disagrees with its source provenance.');
	for (let at = 64 + metadataBytes; at < payloadOffset; at++) if (bytes[at] !== 0) throw new RangeError('HDR metadata alignment padding must be zero.');
	return Object.freeze({ descriptor: descriptor(width, height), provenance, payloadOffset, payloadBytes, metadataSha256 });
}
function descriptor(width: number, height: number): ImageHdrOriginalFrameV1['descriptor'] {
	return Object.freeze({ schemaVersion: 1, width, height, sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' });
}
function binary(value: unknown): Binary {
	if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== NativeBytes.prototype
		|| ['buffer', 'byteLength', 'byteOffset', 'length'].some(key => Object.hasOwn(value, key))) throw new TypeError('HDR encoded input requires an intrinsic native Uint8Array.');
	const backing = Reflect.apply(BUFFER, value, []) as ArrayBuffer, length = Number(Reflect.apply(LENGTH, value, [])), offset = Number(Reflect.apply(OFFSET, value, []));
	if (Object.getPrototypeOf(backing) !== ArrayBuffer.prototype || Reflect.apply(RESIZABLE, backing, []) !== false) throw new TypeError('HDR encoded input requires a fixed native ArrayBuffer.');
	if (length < 64 || length > LIMITS.maximumEncodedBytes) throw new RangeError('HDR Original exceeds its encoded body limit.');
	return { bytes: new NativeBytes(backing, offset, length), physicalBytes: Number(Reflect.apply(SIZE, backing, [])) };
}
function signalBeforeMetadata(value: unknown): AbortSignal | undefined {
	const own = typeof value === 'object' && value !== null ? Object.getOwnPropertyDescriptor(value, 'signal') : undefined;
	if (own && !Object.hasOwn(own, 'value')) throw new TypeError('HDR cancellation requires own signal data.');
	const signal = captureRepairSignalV1(own?.value); checkRepairSignalV1(signal);
	// Requests and option bags have separate owning closed-record admission.
	return signal;
}
function digest(bytes: Uint8Array<ArrayBuffer>): string { const hash = sha256(bytes); try { return bytesToHex(hash); } finally { Reflect.apply(FILL, hash, [0]); } }
function aligned(value: number): number { return Math.ceil(value / 4) * 4; }
function retire(backing: ArrayBuffer, length: number): void {
	if (Reflect.apply(SIZE, backing, []) !== length) throw new TypeError('HDR encoded backing changed before physical retirement.'); Reflect.apply(FILL, new NativeBytes(backing), [0]);
}
