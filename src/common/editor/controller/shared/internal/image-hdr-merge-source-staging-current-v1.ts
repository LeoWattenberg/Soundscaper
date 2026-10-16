/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../../closed-domain-value.ts';
import { readPixelFrameDescriptorV1, readPixelFrameV1, type PixelFrameDescriptorV1, type PixelFrameV1 } from '../../../imaging/pixel-frame-contract-v1.ts';
import { IMAGE_HDR_INPUT_LIMITS_V1 } from '../../../imaging/image-hdr-merge-contract-v1.ts';
import { LinearDevelopOwnerV1 } from '../../../imaging/image-develop-linear-owner-v1.ts';
import { checkRepairSignalV1 } from '../../../imaging/pixel-frame-repair-lifetime-v1.ts';
import type { ImageHdrPixelStagingHandleV1, ImageHdrPixelStagingStoreV1 } from '../../../storage/image-hdr-pixel-staging-v1.ts';

export const HDR_MERGE_PHASE_BYTES_CURRENT_V1 = 1024 * 1024 * 1024;
const CHUNK = 1024 * 1024, RESERVE = 32 * CHUNK;
const Bytes = Uint8Array, Words = Uint16Array, View = DataView;
const TYPED = Object.getPrototypeOf(Bytes.prototype) as object;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!, OFFSET = Object.getOwnPropertyDescriptor(TYPED, 'byteOffset')!.get!;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;

export function captureHdrCanonicalFrameCurrentV1(value: unknown, descriptor: Readonly<PixelFrameDescriptorV1>, originalBytes: number,
	heldGuideBytes: number, signal?: AbortSignal): Readonly<{ frame: PixelFrameV1; physicalBytes: number; check(): void }> {
	const rawDescriptor = readPixelFrameDescriptorV1(field(value as Readonly<Record<string, unknown>>, 'descriptor', 'HDR canonical frame'));
	if (JSON.stringify(rawDescriptor) !== JSON.stringify(descriptor)) throw new RangeError('HDR canonical source differs from its captured descriptor.');
	const raw = record(value, 'HDR canonical frame', ['descriptor', 'pixels']);
	const admitted = readPixelFrameV1({ descriptor, pixels: field(raw, 'pixels', 'HDR canonical frame') }, IMAGE_HDR_INPUT_LIMITS_V1);
	if (admitted.descriptor.sampleFormat === 'float32') throw new RangeError('HDR requires canonical byte or word Originals, not derived Float32 processing.');
	const backing = Reflect.apply(BUFFER, admitted.pixels, []) as ArrayBuffer, physicalBytes = Number(Reflect.apply(SIZE, backing, []));
	// Conservatively reserve a fixed native decoder heap and three encoded
	// Original copies. The source borrower must still own its own decode ledger.
	const decodePeak = 512 * CHUNK + 3 * originalBytes + physicalBytes + heldGuideBytes + 2 * CHUNK + RESERVE;
	const alignPeak = physicalBytes + heldGuideBytes + descriptor.width * descriptor.height + 96 * CHUNK + 2 * CHUNK + RESERVE;
	if (Math.max(decodePeak, alignPeak) > HDR_MERGE_PHASE_BYTES_CURRENT_V1) throw new RangeError('HDR canonical source exceeds its physical phase budget.');
	const pixels = admitted.descriptor.sampleFormat === 'unorm16'
		? new Words(backing, Number(Reflect.apply(OFFSET, admitted.pixels, [])), descriptor.width * descriptor.height * 4)
		: new Bytes(backing, Number(Reflect.apply(OFFSET, admitted.pixels, [])), descriptor.width * descriptor.height * 4);
	const frame: PixelFrameV1 = pixels instanceof Words ? Object.freeze({ descriptor: Object.freeze({ ...descriptor, sampleFormat: 'unorm16' }), pixels })
		: Object.freeze({ descriptor: Object.freeze({ ...descriptor, sampleFormat: 'unorm8' }), pixels });
	const check = () => { checkRepairSignalV1(signal); if (Number(Reflect.apply(SIZE, backing, [])) !== physicalBytes) throw new TypeError('HDR canonical backing detached before its borrow joined.'); };
	check(); return Object.freeze({ frame, physicalBytes, check });
}

/** Stage exact native codes, with explicit little-endian words. Each bounded
 * owned slab and the native storage copy retire before the next slab. */
export async function stageHdrCanonicalFrameCurrentV1(store: Readonly<ImageHdrPixelStagingStoreV1>, frame: PixelFrameV1,
	physicalBytes: number, check: () => void): Promise<Readonly<ImageHdrPixelStagingHandleV1>> {
	const word = frame.descriptor.sampleFormat === 'unorm16', maximum = word ? 65535 : 255;
	const samples = frame.pixels, byteLength = samples.length * (word ? 2 : 1), capacity = Math.min(CHUNK, byteLength);
	const owner = new LinearDevelopOwnerV1(physicalBytes + RESERVE, HDR_MERGE_PHASE_BYTES_CURRENT_V1);
	return owner.run(async () => {
		const slab = owner.bytes(capacity), view = new View(slab.buffer), perChunk = capacity / (word ? 2 : 1);
		return store.write(byteLength, async writer => {
			for (let from = 0; from < samples.length; from += perChunk) {
				check(); const count = Math.min(perChunk, samples.length - from);
				for (let index = 0; index < count; index++) {
					const value = samples[from + index]!;
					if ((from + index) % 4 === 3 && value !== maximum) throw new RangeError('HDR merging requires opaque canonical Originals.');
					if (word) view.setUint16(index * 2, value, true); else slab[index] = value;
				}
				await writer.write(slab.subarray(0, count * (word ? 2 : 1))); check(); slab.fill(0);
			}
		});
	});
}

/** Read groups of complete source-row spans, then copy only the requested x
 * window into its dedicated plane. Native reads remain at most one MiB. */
export async function readHdrStagedWindowCurrentV1(store: Readonly<ImageHdrPixelStagingStoreV1>, handle: Readonly<ImageHdrPixelStagingHandleV1>,
	sourceDescriptor: Readonly<PixelFrameDescriptorV1>, window: Readonly<{ x: number; y: number; descriptor: Readonly<PixelFrameDescriptorV1> }>,
	owner: LinearDevelopOwnerV1, check: () => void): Promise<PixelFrameV1> {
	const word = sourceDescriptor.sampleFormat === 'unorm16', bpp = word ? 8 : 4;
	const width = window.descriptor.width, height = window.descriptor.height, rowBytes = sourceDescriptor.width * bpp, selectedBytes = width * bpp;
	const bytes = owner.bytes(selectedBytes * height), pixels = word ? new Words(bytes.buffer) : bytes;
	const rowsPerRead = Math.floor((CHUNK - selectedBytes) / rowBytes) + 1;
	for (let y = 0; y < height; y += rowsPerRead) {
		check(); const rows = Math.min(rowsPerRead, height - y), length = (rows - 1) * rowBytes + selectedBytes;
		await store.withRead(handle, (window.y + y) * rowBytes + window.x * bpp, length, range => {
			const view = new View(range.buffer, range.byteOffset, range.byteLength);
			for (let row = 0; row < rows; row++) {
				if (word) for (let sample = 0; sample < width * 4; sample++) pixels[(y + row) * width * 4 + sample] = view.getUint16(row * rowBytes + sample * 2, true);
				else bytes.set(range.subarray(row * rowBytes, row * rowBytes + selectedBytes), (y + row) * selectedBytes);
			}
		}); check();
	}
	return pixels instanceof Words ? Object.freeze({ descriptor: Object.freeze({ ...window.descriptor, sampleFormat: 'unorm16' }), pixels })
		: Object.freeze({ descriptor: Object.freeze({ ...window.descriptor, sampleFormat: 'unorm8' }), pixels });
}
