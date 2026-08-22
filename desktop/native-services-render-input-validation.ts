/* SPDX-License-Identifier: AGPL-3.0-only */

/** Streaming validation for selected-V20 renderer-derived V7/V8 carriers. */

import { createHash } from 'node:crypto';
import { lstat, open } from 'node:fs/promises';

import type { NativeMediaPlanEnvelopeV1 } from '../src/common/editor/native-media-plan-envelope.ts';
import { nativeMediaEvaluatedCarrierCadenceV1 } from '../src/common/editor/native-media-evaluated-carrier-v1.ts';
import { HELPER_DATA_CHUNK_MAXIMUM_BYTES } from './helper-data-plane.ts';
import type { HelperNativeFileIdentity } from './helper-native-job-contract.ts';

export const FRAMESCAPER_NATIVE_RENDER_AUDIO_MAXIMUM_BYTES = 2 * 1_024 ** 3;
const CARRIER_MAGIC = Buffer.from('framescaper-rgba-frame-pack-v1\n', 'ascii');
const HEADER_BYTES = 59;
const FRAME_HEADER_BYTES = 32;

export type FramescaperNativeDerivedRenderInputRole =
	| 'evaluated-rgba-frame-pack'
	| 'staged-audio-mix';

export interface FramescaperNativeRenderInputDescriptorV1 {
	readonly role: FramescaperNativeDerivedRenderInputRole;
	readonly byteLength: number;
	readonly sha256: string;
}

export async function inspectNativeRenderDerivedFile(
	path: string,
	descriptor: FramescaperNativeRenderInputDescriptorV1,
	envelope: NativeMediaPlanEnvelopeV1 & Readonly<{ planVersion: 7 | 8 }>,
): Promise<void> {
	await inspectExactNativeRenderInputFile(path, descriptor);
	if (descriptor.role === 'evaluated-rgba-frame-pack') await inspectFramePack(path, envelope);
	else await inspectFloat32Wav(path, envelope);
}

export async function inspectExactNativeRenderInputFile(
	path: string,
	descriptor: FramescaperNativeRenderInputDescriptorV1,
): Promise<void> {
	const details = await lstat(path);
	if (!details.isFile() || details.isSymbolicLink() || details.size !== descriptor.byteLength) {
		throw new Error('A staged native render input changed type or length.');
	}
	const handle = await open(path, 'r');
	try {
		const hash = createHash('sha256');
		const buffer = Buffer.allocUnsafe(Math.min(HELPER_DATA_CHUNK_MAXIMUM_BYTES, descriptor.byteLength));
		let offset = 0;
		while (offset < descriptor.byteLength) {
			const length = Math.min(buffer.byteLength, descriptor.byteLength - offset);
			const result = await handle.read(buffer, 0, length, offset);
			if (result.bytesRead !== length) throw new Error('A staged native render input ended early.');
			hash.update(buffer.subarray(0, length)); offset += length;
		}
		if (hash.digest('hex') !== descriptor.sha256) {
			throw new Error('A staged native render input changed digest.');
		}
	} finally { await handle.close(); }
}

export async function nativeRenderInputFileIdentity(path: string): Promise<HelperNativeFileIdentity> {
	const details = await lstat(path);
	if (!details.isFile() || details.isSymbolicLink()) throw new Error('A staged render input is not a regular file.');
	return Object.freeze({ dev: details.dev, ino: details.ino });
}

export function sameNativeRenderInputFileIdentity(
	left: HelperNativeFileIdentity,
	right: HelperNativeFileIdentity,
): boolean {
	return left.dev === right.dev && left.ino === right.ino;
}

async function inspectFramePack(
	path: string,
	envelope: NativeMediaPlanEnvelopeV1 & Readonly<{ planVersion: 7 | 8 }>,
): Promise<void> {
	const cadence = nativeMediaEvaluatedCarrierCadenceV1(envelope);
	const handle = await open(path, 'r');
	try {
		const header = await readExactly(handle, 0, HEADER_BYTES);
		if (!header.subarray(0, CARRIER_MAGIC.byteLength).equals(CARRIER_MAGIC)
			|| header.readUInt32LE(31) !== 1
			|| header.readUInt32LE(35) !== envelope.summary.width
			|| header.readUInt32LE(39) !== envelope.summary.height
			|| header.readBigUInt64LE(43) !== BigInt(envelope.summary.outputFrameCount)
			|| header.readUInt32LE(51) !== cadence.den
			|| header.readUInt32LE(55) !== cadence.num) {
			throw new Error('The evaluated RGBA carrier header disagrees with its selected-V20 plan.');
		}
		const frameBytes = BigInt(envelope.summary.width) * BigInt(envelope.summary.height) * 4n;
		const expectedBytes = BigInt(HEADER_BYTES)
			+ BigInt(envelope.summary.outputFrameCount) * (BigInt(FRAME_HEADER_BYTES) + frameBytes);
		const details = await handle.stat();
		if (BigInt(details.size) !== expectedBytes) {
			throw new Error('The evaluated RGBA carrier length disagrees with its exact cadence.');
		}
		let offset = BigInt(HEADER_BYTES);
		for (let ordinal = 0; ordinal < envelope.summary.outputFrameCount; ordinal += 1) {
			const row = await readExactly(handle, Number(offset), FRAME_HEADER_BYTES);
			if (row.readBigUInt64LE(0) !== BigInt(ordinal)
				|| row.readBigInt64LE(8) !== BigInt(ordinal)
				|| row.readBigInt64LE(16) !== 1n
				|| row.readBigUInt64LE(24) !== frameBytes) {
				throw new Error('The evaluated RGBA carrier has non-canonical frame cadence.');
			}
			offset += BigInt(FRAME_HEADER_BYTES) + frameBytes;
		}
	} finally { await handle.close(); }
}

async function inspectFloat32Wav(
	path: string,
	envelope: NativeMediaPlanEnvelopeV1 & Readonly<{ planVersion: 7 | 8 }>,
): Promise<void> {
	const handle = await open(path, 'r');
	try {
		const details = await handle.stat();
		const head = await readExactly(handle, 0, 12);
		if (head.toString('ascii', 0, 4) !== 'RIFF' || head.toString('ascii', 8, 12) !== 'WAVE'
			|| head.readUInt32LE(4) !== details.size - 8) invalidWav();
		let offset = 12; let chunks = 0; let format: { channels: number; blockAlign: number } | null = null;
		let dataBytes: number | null = null;
		while (offset < details.size) {
			if (++chunks > 64 || details.size - offset < 8) invalidWav();
			const chunk = await readExactly(handle, offset, 8);
			const name = chunk.toString('ascii', 0, 4); const length = chunk.readUInt32LE(4);
			const payload = offset + 8; const padded = length + (length & 1);
			if (padded > details.size - payload) invalidWav();
			if (name === 'fmt ') {
				if (format || length !== 16) invalidWav();
				const bytes = await readExactly(handle, payload, length);
				const channels = bytes.readUInt16LE(2); const rate = bytes.readUInt32LE(4);
				const blockAlign = bytes.readUInt16LE(12);
				if (bytes.readUInt16LE(0) !== 3 || bytes.readUInt16LE(14) !== 32
					|| channels < 1 || channels > 32 || rate !== envelope.summary.projectSampleRate
					|| blockAlign !== channels * 4 || bytes.readUInt32LE(8) !== rate * blockAlign) invalidWav();
				format = { channels, blockAlign };
			} else if (name === 'data') {
				if (dataBytes !== null) invalidWav(); dataBytes = length;
			}
			offset = payload + padded;
		}
		const inputs = envelope.plan.inputs;
		if (!Array.isArray(inputs)) invalidWav();
		const audio = inputs.at(-1) as Record<string, unknown>;
		if (!format || dataBytes === null || dataBytes < 1 || dataBytes % format.blockAlign !== 0
			|| dataBytes / format.blockAlign !== envelope.summary.durationFrames
			|| (audio.channelLayout === 'mono' && format.channels !== 1)
			|| (audio.channelLayout === 'stereo' && format.channels !== 2)) invalidWav();
	} finally { await handle.close(); }
}

async function readExactly(
	handle: Awaited<ReturnType<typeof open>>, offset: number, length: number,
): Promise<Buffer> {
	const bytes = Buffer.allocUnsafe(length); const result = await handle.read(bytes, 0, length, offset);
	if (result.bytesRead !== length) throw new Error('A staged native render input ended early.');
	return bytes;
}

function invalidWav(): never {
	throw new Error('The staged audio mix is not a canonical plan-exact float32 WAV.');
}
