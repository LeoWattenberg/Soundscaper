/* SPDX-License-Identifier: AGPL-3.0-only */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { addRationals, compareRationals, divideRationals, multiplyRationals } from './timeline-time.ts';
import { motionDigest, motionId, motionInteger, motionRational, motionRecord } from './motion-values.ts';
import type { MotionNativeFramePlan, MotionNativeFrameIdentity } from './motion-native-frame-carrier-v1.ts';
import type { MotionAudioMixBlock } from './motion-audio-contract.ts';
import { readScapeArchiveByteRange, type ScapeArchiveByteSource } from './scape-archive-byte-source.ts';
import type { Rational } from './timeline-time.ts';

/** Carrier samples are identified by document digest and composition/sequence coordinate, independent of editor revision counters. */
export type MotionNativePcmBlock = Omit<MotionAudioMixBlock, 'revision'>;
const MAGIC = new TextEncoder().encode('motionscaper-interleaved-pcm-pack-v1\n');
export const MOTION_NATIVE_PCM_PACKET_SAMPLES = 4096;
export const MOTION_NATIVE_PCM_MAXIMUM_SAMPLES = 32768 * MOTION_NATIVE_PCM_PACKET_SAMPLES;
export interface MotionNativePcmOptions { readonly sampleRate: number; readonly channels: 1 | 2 }
export interface MotionNativePcmPlan extends MotionNativePcmOptions {
	readonly identity: MotionNativeFrameIdentity; readonly frameRate: Rational;
	readonly firstFrame: number; readonly frameCount: number; readonly sampleCount: number;
}
export interface MotionNativePcmHeader extends MotionNativePcmPlan {
	readonly format: 'motionscaper-interleaved-pcm-pack'; readonly version: 1; readonly sampleFormat: 'f32le';
}
export interface MotionNativePcmReceipt { readonly byteLength: number; readonly sha256: string; readonly sampleCount: number }
export function motionNativePcmPlan(frames: Pick<MotionNativeFramePlan, 'identity' | 'frameRate' | 'firstFrame' | 'frameCount'>, options: MotionNativePcmOptions): MotionNativePcmPlan {
	const sampleRate = motionInteger(options.sampleRate, 'native PCM sample rate', 8000, 192000);
	const channels = motionInteger(options.channels, 'native PCM channels', 1, 2) as 1 | 2;
	const record = motionRecord(frames.identity, ['projectId', 'revisionDigest', 'compositionId'], 'native PCM identity');
	const identity = Object.freeze({ projectId: motionId(record.projectId), revisionDigest: motionDigest(record.revisionDigest), compositionId: motionId(record.compositionId) });
	const frameRate = motionRational(frames.frameRate, 'native PCM frame rate', true);
	if (frameRate.num > 0x7fffffff || frameRate.den > 0x7fffffff) throw new RangeError('Native PCM frame cadence exceeds the codec rational range.');
	const firstFrame = motionInteger(frames.firstFrame, 'native PCM first frame');
	const frameCount = motionInteger(frames.frameCount, 'native PCM frame count', 1);
	if (!Number.isSafeInteger(firstFrame + frameCount)) throw new RangeError('Native PCM range exceeds exact frame coordinates.');
	const numerator = BigInt(frameCount) * BigInt(sampleRate) * BigInt(frameRate.den);
	const count = (numerator + BigInt(frameRate.num) - 1n) / BigInt(frameRate.num);
	if (count > BigInt(MOTION_NATIVE_PCM_MAXIMUM_SAMPLES)) throw new RangeError('Native PCM exceeds the bounded MOV sample index.');
	multiplyRationals(divideRationals(firstFrame, frameRate), sampleRate);
	return Object.freeze({ identity, frameRate, firstFrame, frameCount, sampleRate, channels, sampleCount: Number(count) });
}
function header(value: unknown): MotionNativePcmHeader {
	const record = motionRecord(value, ['identity', 'frameRate', 'firstFrame', 'frameCount', 'sampleRate', 'channels', 'sampleCount', 'format', 'version', 'sampleFormat'], 'native PCM header');
	if (record.format !== 'motionscaper-interleaved-pcm-pack' || record.version !== 1 || record.sampleFormat !== 'f32le') throw new Error('Unsupported native PCM version or precision.');
	const normalized = motionNativePcmPlan(record as unknown as MotionNativePcmPlan, record as unknown as MotionNativePcmOptions);
	if (record.sampleCount !== normalized.sampleCount) throw new Error('Native PCM sample count differs from its exact cadence.');
	return Object.freeze({ ...normalized, format: 'motionscaper-interleaved-pcm-pack', version: 1, sampleFormat: 'f32le' });
}
/** Raw interleaved float samples retain mix headroom; only the native PCM24 delivery quantizes/clamps. */
export async function createMotionNativePcmWriter(inputPlan: MotionNativePcmPlan, writable: WritableStream<Uint8Array>, signal?: AbortSignal) {
	const description = header({ ...inputPlan, format: 'motionscaper-interleaved-pcm-pack', version: 1, sampleFormat: 'f32le' });
	const plan = description;
	const json = new TextEncoder().encode(JSON.stringify(description));
	const prefix = new Uint8Array(MAGIC.length + 4 + json.length); prefix.set(MAGIC);
	new DataView(prefix.buffer).setUint32(MAGIC.length, json.length, true); prefix.set(json, MAGIC.length + 4);
	const writer = writable.getWriter(); void writer.closed.catch(() => undefined);
	const digest = sha256.create(); let next = 0; let state: 'open' | 'closed' = 'open'; let busy = false;
	const active = () => { if (state !== 'open') throw new Error('Native PCM carrier is closed.'); signal?.throwIfAborted(); };
	const abort = async (reason: unknown) => { if (state === 'closed') return; state = 'closed'; try { await writer.abort(reason); } finally { writer.releaseLock(); } };
	const writeBytes = async (bytes: Uint8Array) => { active(); await writer.write(bytes); digest.update(bytes); active(); };
	try { await writeBytes(prefix); } catch (error) { await abort(error); throw error; }
	const start = multiplyRationals(divideRationals(plan.firstFrame, plan.frameRate), plan.sampleRate);
	return { header: description, abort,
		async write(block: MotionNativePcmBlock) {
			active(); if (busy) throw new Error('Native PCM writes must be sequential.');
			if (block.projectId !== plan.identity.projectId || block.revisionDigest !== plan.identity.revisionDigest || block.compositionId !== plan.identity.compositionId
				|| block.sampleRate !== plan.sampleRate || block.channels !== plan.channels) throw new Error('Native PCM block differs from its pinned plan.');
			if (compareRationals(block.startSample, addRationals(start, next)) !== 0 || !Number.isSafeInteger(block.sampleCount) || block.sampleCount < 1
				|| !(block.interleaved instanceof Float32Array) || block.sampleCount > 65536 || block.sampleCount > plan.sampleCount - next || block.interleaved.length !== block.sampleCount * plan.channels) throw new Error('Native PCM samples must be bounded and sequential.');
			if (!block.interleaved.every(Number.isFinite)) throw new Error('Native PCM samples must be finite.');
			busy = true;
			try {
				for (let offset = 0; offset < block.interleaved.length; offset += 16384) {
					const count = Math.min(16384, block.interleaved.length - offset); const bytes = new Uint8Array(count * 4); const view = new DataView(bytes.buffer);
					for (let index = 0; index < count; index++) view.setFloat32(index * 4, block.interleaved[offset + index]!, true);
					await writeBytes(bytes);
				}
				next += block.sampleCount;
			} catch (error) { await abort(error); throw error; } finally { busy = false; }
		},
		async finish(): Promise<MotionNativePcmReceipt> {
			active(); if (busy || next !== plan.sampleCount) throw new Error('Native PCM carrier is incomplete.');
			try { await writer.close(); state = 'closed'; writer.releaseLock(); return { sampleCount: next, byteLength: prefix.length + next * plan.channels * 4, sha256: bytesToHex(digest.digest()) }; }
			catch (error) { await abort(error); throw error; }
		},
	};
}
/** Call only on authenticated custody; whole-carrier SHA-256 is enforced by main and the native host. */
export async function openMotionNativePcmReader(source: ScapeArchiveByteSource, expected: MotionNativePcmPlan, signal?: AbortSignal) {
	const prefix = await readScapeArchiveByteRange(source, { offset: 0, length: MAGIC.length + 4, signal });
	if (!MAGIC.every((value, index) => prefix[index] === value)) throw new Error('Native PCM magic differs from version 1.');
	const length = new DataView(prefix.buffer, prefix.byteOffset, prefix.length).getUint32(MAGIC.length, true);
	if (length < 1 || length > 65536) throw new Error('Native PCM header length is invalid.');
	const json = new TextDecoder('utf-8', { fatal: true }).decode(await readScapeArchiveByteRange(source, { offset: prefix.length, length, signal }));
	const description = header(JSON.parse(json) as unknown);
	const expectedHeader = header({ ...expected, format: 'motionscaper-interleaved-pcm-pack', version: 1, sampleFormat: 'f32le' });
	if (JSON.stringify(description) !== json || JSON.stringify(description) !== JSON.stringify(expectedHeader)) throw new Error('Native PCM header differs from its canonical pinned plan.');
	const start = prefix.length + length;
	if (source.size !== start + description.sampleCount * description.channels * 4) throw new Error('Native PCM exact length differs from its sample count.');
	let next = 0; let busy = false; let failed = false;
	return { header: description, async read(offset: number, readSignal = signal): Promise<Float32Array> {
		if (busy || failed || offset !== next || offset >= description.sampleCount) throw new Error('Native PCM reads must be sequential.');
		busy = true;
		try {
			const count = Math.min(MOTION_NATIVE_PCM_PACKET_SAMPLES, description.sampleCount - next);
			const bytes = await readScapeArchiveByteRange(source, { offset: start + next * description.channels * 4, length: count * description.channels * 4, signal: readSignal });
			const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length); const values = new Float32Array(count * description.channels);
			for (let index = 0; index < values.length; index++) { const value = view.getFloat32(index * 4, true); if (!Number.isFinite(value)) throw new Error('Native PCM sample must be finite.'); values[index] = value; }
			next += count; return values;
		} catch (error) { failed = true; throw error; } finally { busy = false; }
	} };
}
