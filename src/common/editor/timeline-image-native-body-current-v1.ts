/* SPDX-License-Identifier: AGPL-3.0-only */
import { normalizeFramescaperImageSourceCurrentV1 } from './timeline-image-model-current-v1.ts';
import { prepareFramescaperRawImageOriginalCurrentV1 } from './timeline-image-raw-original-plan-current-v1.ts';
import { prepareFramescaperHdrImageOriginalCurrentV1 } from './timeline-image-model-hdr-current-v1.ts';
import { canonicalMediaContentBlob } from './storage/media-content-digest.ts';
import { captureRepairSignalV1, checkRepairSignalV1 } from './imaging/pixel-frame-repair-lifetime-v1.ts';

export const FRAMESCAPER_NATIVE_IMAGE_WORKING_BYTES_CURRENT_V1 = 1024 * 1024 * 1024;
/** Scalar native authority only. No decoder or range/body capability is loaded. */
export function prepareFramescaperNativeImageBodyCurrentV1(value: unknown) {
	const source = normalizeFramescaperImageSourceCurrentV1(value);
	if (source.schemaVersion !== 4 && source.schemaVersion !== 5) throw new TypeError('Native Frame body proof requires Source4 or Source5.');
	const plan = source.schemaVersion === 4 ? prepareFramescaperRawImageOriginalCurrentV1(source) : prepareFramescaperHdrImageOriginalCurrentV1(source);
	if (BigInt(source.assetByteLength) * 3n + plan.decodeWorkingBytes > BigInt(FRAMESCAPER_NATIVE_IMAGE_WORKING_BYTES_CURRENT_V1)) {
		throw new RangeError(`Frame ${source.schemaVersion === 4 ? 'RAW' : 'HDR'} archive pack and decode exceed their 1 GiB working bound.`);
	}
	return Object.freeze({ ...plan, source, maximumWorkingBytes: FRAMESCAPER_NATIVE_IMAGE_WORKING_BYTES_CURRENT_V1 });
}

/** The same native body proof serves archive staging, export and transactional
 * resource audit. The complete source remains separate from its Source1 pack. */
export async function validateFramescaperNativeImageBodyCurrentV1(value: unknown, bodyValue: unknown, external?: AbortSignal): Promise<void> {
	const signal = captureRepairSignalV1(external); checkRepairSignalV1(signal);
	const { source } = prepareFramescaperNativeImageBodyCurrentV1(value), body = canonicalMediaContentBlob(bodyValue);
	const size = Number(Reflect.apply(Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!, body, []));
	if (size !== source.assetByteLength) throw new RangeError('Frame native archive body differs from its exact native size.');
	const slice = Blob.prototype.slice, readBody = Blob.prototype.arrayBuffer;
	const request = { source, ...(signal ? { signal } : {}), read: async (offset: number, length: number) =>
		new Uint8Array(await Reflect.apply(readBody, Reflect.apply(slice, body, [offset, offset + length]) as Blob, []) as ArrayBuffer) };
	if (source.schemaVersion === 4) {
		const owner = await import('./timeline-image-raw-pack-current-v1.ts'); checkRepairSignalV1(signal);
		await owner.withFramescaperRawImageOriginalCurrentV1(request, () => undefined);
	} else {
		const owner = await import('./timeline-image-hdr-original-current-v1.ts'); checkRepairSignalV1(signal);
		await owner.withFramescaperHdrImageOriginalCurrentV1(request, () => undefined);
	}
	checkRepairSignalV1(signal);
}
