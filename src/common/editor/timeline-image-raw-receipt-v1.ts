/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import manifest from '../../../config/lightscaper-libraw-runtime-manifest.json';
import { readClosedDomainField as field, readClosedDomainRecord as record } from './closed-domain-value.ts';
import { planPixelFrameV1, readPixelFrameV1, type PixelFrameDescriptorV1 } from './imaging/pixel-frame-contract-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1 } from './imaging/pixel-frame-repair-lifetime-v1.ts';

export type FramescaperRawOriginalDescriptorV1 = Readonly<PixelFrameDescriptorV1 & {
	readonly sampleFormat: 'unorm16'; readonly primaries: 'srgb'; readonly transfer: 'linear';
}>;
export const FRAMESCAPER_RAW_DECODER_IDENTITY_V1 = Object.freeze({ id: 'libraw' as const, version: '0.22.2' as const,
	abiVersion: 1 as const, sha256: manifest.runtime.sha256 });
export interface FramescaperRawOriginalReceiptV1 {
	readonly schemaVersion: 1;
	readonly decoder: typeof FRAMESCAPER_RAW_DECODER_IDENTITY_V1;
	readonly descriptor: FramescaperRawOriginalDescriptorV1;
	readonly rawFlip: number;
	readonly pixelEncoding: 'rgba16be';
	readonly pixelsSha256: string;
}
const LIMITS = Object.freeze({ maximumSidePixels: 8192, maximumPixels: 16_777_216, maximumBytes: 134_217_728 });
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const WORDS_PER_SPAN = 32_768;

/** Closed decode facts only. Native Original/worker owners separately prove
 * these declarations against the retained bytes and same-instance raw_flip. */
export function normalizeFramescaperRawOriginalReceiptV1(value: unknown): Readonly<FramescaperRawOriginalReceiptV1> {
	const input = record(value, 'Frame RAW Original receipt', ['schemaVersion', 'decoder', 'descriptor', 'rawFlip', 'pixelEncoding', 'pixelsSha256']);
	if (field(input, 'schemaVersion', 'Frame RAW Original receipt') !== 1 || field(input, 'pixelEncoding', 'Frame RAW Original receipt') !== 'rgba16be') {
		throw new RangeError('Unsupported Frame RAW Original receipt version or native word encoding.');
	}
	const decoder = record(field(input, 'decoder', 'Frame RAW Original receipt'), 'Frame RAW decoder', ['id', 'version', 'abiVersion', 'sha256']);
	if (manifest.upstream.version !== FRAMESCAPER_RAW_DECODER_IDENTITY_V1.version || !/^[a-f0-9]{64}$/u.test(FRAMESCAPER_RAW_DECODER_IDENTITY_V1.sha256)
		|| Object.entries(FRAMESCAPER_RAW_DECODER_IDENTITY_V1).some(([key, expected]) => field(decoder, key, 'Frame RAW decoder') !== expected)) {
		throw new RangeError('Frame RAW decoder identity differs from its pinned native runtime.');
	}
	const descriptor = nativeDescriptor(field(input, 'descriptor', 'Frame RAW Original receipt'));
	const rawFlip = field(input, 'rawFlip', 'Frame RAW Original receipt'), pixelsSha256 = field(input, 'pixelsSha256', 'Frame RAW Original receipt');
	if (typeof rawFlip !== 'number' || !Number.isSafeInteger(rawFlip) || rawFlip < 0 || rawFlip > 7) throw new RangeError('Frame RAW Original requires its bounded native orientation.');
	if (typeof pixelsSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(pixelsSha256)) throw new TypeError('Frame RAW Original requires a lowercase native-word SHA256.');
	return Object.freeze({ schemaVersion: 1, decoder: FRAMESCAPER_RAW_DECODER_IDENTITY_V1, descriptor, rawFlip, pixelEncoding: 'rgba16be', pixelsSha256 });
}

/** Hash opaque top-left RGBA16 native words in explicit big-endian order. The
 * borrowed frame stays fixed through settlement; only one 64 KiB serialized
 * span is owned, never a full encoded word plane or a byte display conversion. */
export async function framescaperRawOriginalPixelsSha256V1(value: unknown, signalValue?: AbortSignal): Promise<string> {
	const signal = captureRepairSignalV1(signalValue), check = () => { checkRepairSignalV1(signal); }; check();
	let source: ReturnType<typeof readPixelFrameV1>;
	try {
		const input = record(value, 'Frame RAW native frame', ['descriptor', 'pixels']);
		const descriptor = nativeDescriptor(field(input, 'descriptor', 'Frame RAW native frame'));
		const admitted = readPixelFrameV1({ descriptor, pixels: field(input, 'pixels', 'Frame RAW native frame') }, LIMITS);
		if (admitted.descriptor.sampleFormat !== 'unorm16') throw new TypeError('Frame RAW digest requires native words.');
		source = admitted;
	} catch (error) { check(); throw error; }
	check(); const backing = source.pixels.buffer, length = source.pixels.length, allocationLength = Number(Reflect.apply(SIZE, backing, []));
	const words = new Uint16Array(backing, source.pixels.byteOffset, length), bytes = new Uint8Array(WORDS_PER_SPAN * 2), view = new DataView(bytes.buffer), hash = sha256.create();
	const current = () => { check(); if (Number(Reflect.apply(SIZE, backing, [])) !== allocationLength || allocationLength === 0) throw new TypeError('Frame RAW native words detached before digest completion.'); };
	try {
		for (let offset = 0; offset < length; offset += WORDS_PER_SPAN) {
			current(); const count = Math.min(WORDS_PER_SPAN, length - offset);
			for (let index = 0; index < count; index++) {
				const word = words[offset + index]!;
				if ((offset + index) % 4 === 3 && word !== 65535) throw new RangeError('Frame RAW native words require opaque alpha.');
				view.setUint16(index * 2, word);
			}
			hash.update(bytes.subarray(0, count * 2)); bytes.fill(0);
			if (offset + count < length) { await new Promise<void>(resolve => { setTimeout(resolve, 0); }); current(); }
		}
		current(); return bytesToHex(hash.digest());
	} finally { bytes.fill(0); hash.destroy(); }
}

function nativeDescriptor(value: unknown): FramescaperRawOriginalDescriptorV1 {
	const descriptor = planPixelFrameV1(value, LIMITS).descriptor;
	if (descriptor.sampleFormat !== 'unorm16' || descriptor.primaries !== 'srgb' || descriptor.transfer !== 'linear') {
		throw new RangeError('Frame RAW Original requires the pinned linear sRGB UNORM16 native descriptor.');
	}
	return descriptor as FramescaperRawOriginalDescriptorV1;
}
