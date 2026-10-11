/* SPDX-License-Identifier: AGPL-3.0-only */
import { motionSurfaceLength, validateMotionSurface, type MotionSurface } from './motion-surface.ts';
import { freezeMotionValue, motionDigest, motionId, motionInteger, motionRational, motionRecord } from './motion-values.ts';
import { readScapeArchiveByteRange, type ScapeArchiveByteSource } from './scape-archive-byte-source.ts';
import type { Rational } from './timeline-time.ts';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

export const MOTION_NATIVE_FRAME_CHUNK_BYTES = 4 * 1024 * 1024;
const MAGIC = new TextEncoder().encode('motionscaper-linear-rgba-frame-pack-v1\n');
const MAXIMUM_HEADER_BYTES = 64 * 1024;
const FIXED_FRAME_BYTES = 16;
const FRAME_DIGEST_BYTES = 32;
export interface MotionNativeFrameIdentity {
	readonly projectId: string; readonly revisionDigest: string; readonly compositionId: string;
}
export interface MotionNativeFramePlan {
	readonly identity: MotionNativeFrameIdentity; readonly width: number; readonly height: number;
	readonly frameRate: Rational; readonly firstFrame: number; readonly frameCount: number;
}
export interface MotionNativeFrameHeader extends MotionNativeFramePlan {
	readonly format: 'motionscaper-linear-rgba-frame-pack'; readonly version: 1;
	readonly pixelFormat: 'rgba-f32le'; readonly colorSpace: 'linear-rec709-d65'; readonly alphaMode: 'premultiplied';
}
export interface MotionNativeFrameWriter {
	readonly header: MotionNativeFrameHeader;
	write(index: number, surface: MotionSurface): Promise<void>;
	finish(): Promise<MotionNativeFrameReceipt>; abort(reason: unknown): Promise<void>;
}
export interface MotionNativeFrameReceipt { readonly byteLength: number; readonly sha256: string; readonly frameCount: number }
export interface MotionNativeFrameReader {
	readonly header: MotionNativeFrameHeader;
	read(index: number, signal?: AbortSignal): Promise<MotionSurface>;
}

/** Independent float carrier; the existing Framescaper RGBA8 format and admission remain unchanged. */
export async function createMotionNativeFrameWriter(plan: MotionNativeFramePlan, writable: WritableStream<Uint8Array>, signal?: AbortSignal): Promise<MotionNativeFrameWriter> {
	const header = normalizeHeader({ ...plan, format: 'motionscaper-linear-rgba-frame-pack', version: 1,
		pixelFormat: 'rgba-f32le', colorSpace: 'linear-rec709-d65', alphaMode: 'premultiplied' });
	const headerBytes = encodeHeader(header);
	const byteLength = exactLength(header, headerBytes.length);
	const writer = writable.getWriter();
	const digest = sha256.create();
	const writeBytes = async (bytes: Uint8Array) => { digest.update(bytes); await writer.write(bytes); };
	void writer.closed.catch(() => undefined);
	let state: 'open' | 'finished' | 'aborted' = 'open'; let next = 0; let busy = false;
	const abort = async (reason: unknown) => {
		if (state !== 'open') return;
		state = 'aborted';
		try { await writer.abort(reason); } finally { writer.releaseLock(); }
	};
	const active = () => { if (state !== 'open') throw new Error('Motion frame writer is closed.'); signal?.throwIfAborted(); };
	try { active(); await writeBytes(headerBytes); active(); }
	catch (error) { await abort(error); throw error; }
	return { header, abort,
		async write(index, surface) {
			if (busy) throw new Error('Motion frame writes must be sequential.');
			if (index !== next || index >= header.frameCount) throw new Error('Motion frame index must be sequential.');
			if (surface.width !== header.width || surface.height !== header.height) throw new Error('Motion frame dimensions disagree with the carrier.');
			validateMotionSurface(surface);
			busy = true;
			try {
				active();
				const record = new Uint8Array(FIXED_FRAME_BYTES); const view = new DataView(record.buffer);
				view.setBigUint64(0, BigInt(index), true); view.setBigUint64(8, BigInt(surface.pixels.byteLength), true);
				await writeBytes(record);
				const frameDigest = sha256.create();
				for (let offset = 0; offset < surface.pixels.length; offset += MOTION_NATIVE_FRAME_CHUNK_BYTES / 4) {
					active();
					const count = Math.min(MOTION_NATIVE_FRAME_CHUNK_BYTES / 4, surface.pixels.length - offset);
					const bytes = new Uint8Array(count * 4); const data = new DataView(bytes.buffer);
					for (let sample = 0; sample < count; sample++) data.setFloat32(sample * 4, surface.pixels[offset + sample]!, true);
					frameDigest.update(bytes); await writeBytes(bytes);
				}
				active(); await writeBytes(frameDigest.digest());
				active(); next++;
			} catch (error) { await abort(error); throw error; }
			finally { busy = false; }
		},
		async finish() {
			if (busy || next !== header.frameCount) throw new Error('Motion frame carrier is incomplete.');
			try { active(); await writer.close(); state = 'finished'; writer.releaseLock(); return Object.freeze({ byteLength, sha256: bytesToHex(digest.digest()), frameCount: next }); }
			catch (error) { await abort(error); throw error; }
		},
	};
}

/** Reads one exact frame at a time from authenticated custody; never allocates in proportion to duration. */
export async function openMotionNativeFrameReader(source: ScapeArchiveByteSource, identity: MotionNativeFrameIdentity, signal?: AbortSignal): Promise<MotionNativeFrameReader> {
	const prefix = await readScapeArchiveByteRange(source, { offset: 0, length: MAGIC.length + 4, signal });
	if (!MAGIC.every((byte, index) => prefix[index] === byte)) throw new Error('Motion native frame magic does not match version 1.');
	const headerLength = new DataView(prefix.buffer, prefix.byteOffset, prefix.length).getUint32(MAGIC.length, true);
	if (headerLength === 0 || headerLength > MAXIMUM_HEADER_BYTES) throw new Error('Motion native frame header length is invalid.');
	const bytes = await readScapeArchiveByteRange(source, { offset: prefix.length, length: headerLength, signal });
	const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	const parsed: unknown = JSON.parse(text);
	const header = normalizeHeader(parsed);
	if (JSON.stringify(header) !== text) throw new Error('Motion native frame header must use canonical fields.');
	if (JSON.stringify(header.identity) !== JSON.stringify(normalizeIdentity(identity))) throw new Error('Motion native frame identity disagrees with the pinned revision.');
	let offset = prefix.length + headerLength;
	if (source.size !== exactLength(header, offset)) throw new Error('Motion native frame carrier exact length disagrees with its frame count.');
	let next = 0; let busy = false; let failed = false;
	return { header, async read(index, frameSignal = signal) {
		if (busy || failed || index !== next || index >= header.frameCount) throw new Error('Motion native frames must be read in sequential order.');
		busy = true;
		try {
			frameSignal?.throwIfAborted();
			const record = await readScapeArchiveByteRange(source, { offset, length: FIXED_FRAME_BYTES, signal: frameSignal });
			const data = new DataView(record.buffer, record.byteOffset, record.length);
			const samples = motionSurfaceLength(header.width, header.height);
			if (data.getBigUint64(0, true) !== BigInt(index) || data.getBigUint64(8, true) !== BigInt(samples * 4)) throw new Error('Motion frame record disagrees with its ordinal or payload length.');
			offset += FIXED_FRAME_BYTES;
			const pixels = new Float32Array(samples);
			const digest = sha256.create();
			for (let sample = 0; sample < samples; sample += MOTION_NATIVE_FRAME_CHUNK_BYTES / 4) {
				const length = Math.min(MOTION_NATIVE_FRAME_CHUNK_BYTES, (samples - sample) * 4);
				const chunk = await readScapeArchiveByteRange(source, { offset, length, signal: frameSignal });
				const floats = new DataView(chunk.buffer, chunk.byteOffset, chunk.length);
				digest.update(chunk);
				for (let i = 0; i < length / 4; i++) pixels[sample + i] = floats.getFloat32(i * 4, true);
				offset += length;
			}
			const expectedDigest = await readScapeArchiveByteRange(source, { offset, length: FRAME_DIGEST_BYTES, signal: frameSignal });
			offset += FRAME_DIGEST_BYTES;
			if (bytesToHex(expectedDigest) !== bytesToHex(digest.digest())) throw new Error('Motion native frame pixel digest does not match its record.');
			const surface = Object.freeze({ width: header.width, height: header.height, pixels, colorSpace: header.colorSpace, alphaMode: header.alphaMode });
			validateMotionSurface(surface); frameSignal?.throwIfAborted(); next++;
			return surface;
		} catch (error) { failed = true; throw error; }
		finally { busy = false; }
	} };
}

function normalizeIdentity(value: unknown): MotionNativeFrameIdentity {
	const record = motionRecord(value, ['projectId', 'revisionDigest', 'compositionId'], 'motion frame identity');
	return Object.freeze({ projectId: motionId(record.projectId), revisionDigest: motionDigest(record.revisionDigest), compositionId: motionId(record.compositionId) });
}
function normalizeHeader(value: unknown): MotionNativeFrameHeader {
	const record = motionRecord(value, ['identity', 'width', 'height', 'frameRate', 'firstFrame', 'frameCount', 'format', 'version', 'pixelFormat', 'colorSpace', 'alphaMode'], 'motion native frame header');
	if (record.format !== 'motionscaper-linear-rgba-frame-pack' || record.version !== 1 || record.pixelFormat !== 'rgba-f32le'
		|| record.colorSpace !== 'linear-rec709-d65' || record.alphaMode !== 'premultiplied') throw new Error('Unsupported motion native frame version, precision, color or alpha.');
	const width = motionInteger(record.width, 'motion frame width', 1); const height = motionInteger(record.height, 'motion frame height', 1);
	motionSurfaceLength(width, height);
	const frameRate = motionRational(record.frameRate, 'motion frame rate', true);
	if (frameRate.num > 0x7fff_ffff || frameRate.den > 0x7fff_ffff) throw new RangeError('Motion native frame rate exceeds the exact codec rational domain.');
	const firstFrame = motionInteger(record.firstFrame, 'motion first frame'); const frameCount = motionInteger(record.frameCount, 'motion frame count', 1, 100_000_000);
	if (!Number.isSafeInteger(firstFrame + frameCount)) throw new RangeError('Motion native frame cadence exceeds exact coordinates.');
	return freezeMotionValue({ identity: normalizeIdentity(record.identity), width, height, frameRate, firstFrame, frameCount,
		format: 'motionscaper-linear-rgba-frame-pack', version: 1, pixelFormat: 'rgba-f32le', colorSpace: 'linear-rec709-d65', alphaMode: 'premultiplied' });
}
function encodeHeader(header: MotionNativeFrameHeader): Uint8Array {
	const json = new TextEncoder().encode(JSON.stringify(header));
	if (json.length > MAXIMUM_HEADER_BYTES) throw new Error('Motion native frame header length exceeds its bound.');
	const bytes = new Uint8Array(MAGIC.length + 4 + json.length);
	bytes.set(MAGIC); new DataView(bytes.buffer).setUint32(MAGIC.length, json.length, true); bytes.set(json, MAGIC.length + 4);
	return bytes;
}
function exactLength(header: MotionNativeFrameHeader, headerBytes: number): number {
	const length = headerBytes + header.frameCount * (FIXED_FRAME_BYTES + FRAME_DIGEST_BYTES + motionSurfaceLength(header.width, header.height) * 4);
	if (!Number.isSafeInteger(length)) throw new RangeError('Motion native frame carrier exact length exceeds its safe byte domain.');
	return length;
}
