/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { admitPixelFrameV1 } from '../../common/editor/imaging/pixel-frame-admission-v1.ts';
import { readPixelFrameV1, type PixelFrameDescriptorV1 } from '../../common/editor/imaging/pixel-frame-contract-v1.ts';
import { resizeRgba8NearestAsyncV1 } from '../../common/editor/imaging/pixel-frame-resize-v1.ts';
import { normalizePhotoPreviewPlanV1, normalizePhotoPreviewOriginalBindingV1, PHOTO_PREVIEW_SOURCE_LIMITS_V1,
	type PhotoPreviewPlanV1, type PhotoPreviewOriginalBindingV1, type PhotoPreviewTierV1 } from './photo-preview-plan-v1.ts';

export interface PreparedPhotoPreviewV1 {
	readonly schemaVersion: 1; readonly kind: 'photo-preview'; readonly key: string;
	readonly binding: Readonly<PhotoPreviewOriginalBindingV1>; readonly tier: PhotoPreviewTierV1;
	readonly recipe: PhotoPreviewPlanV1['recipe']; readonly descriptor: Readonly<PixelFrameDescriptorV1>;
	readonly byteLength: number; readonly outputSha256: string;
	/** Tightly packed RGBA only; the descriptor is carried separately. */
	readonly body: Blob;
}

/** Prepare an original-free disposable body from one authenticated, already oriented frame. */
export async function preparePhotoPreviewV1(value: unknown): Promise<Readonly<PreparedPhotoPreviewV1>> {
	const input = record(value, 'photo preview preparation', ['plan', 'binding', 'frame', 'signal'], ['plan', 'binding', 'frame']);
	const get = (key: string) => field(input, key, 'photo preview preparation');
	const plan = normalizePhotoPreviewPlanV1(get('plan'));
	const binding = normalizePhotoPreviewOriginalBindingV1(get('binding'));
	if (JSON.stringify(binding) !== JSON.stringify(plan.binding)) throw new RangeError('Photo preview current original binding changed.');
	const signal = Object.hasOwn(input, 'signal') ? get('signal') : undefined;
	if (signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError('Photo preview requires a cancellation signal.');
	signal?.throwIfAborted();
	const frame = record(get('frame'), 'photo preview source frame', ['descriptor', 'pixels']);
	const descriptor = admitPixelFrameV1(field(frame, 'descriptor', 'photo preview source frame'), { limits: PHOTO_PREVIEW_SOURCE_LIMITS_V1 }).descriptor;
	if (JSON.stringify(descriptor) !== JSON.stringify(plan.source)) throw new RangeError('Photo preview source changed from its admitted plan.');
	const source = readPixelFrameV1({ descriptor, pixels: field(frame, 'pixels', 'photo preview source frame') }, PHOTO_PREVIEW_SOURCE_LIMITS_V1);
	if (source.descriptor.sampleFormat !== 'unorm8') throw new RangeError('Photo preview source profile is not admitted.');
	// Own a fixed native snapshot before yielding; caller mutation cannot alter the output.
	const snapshot = new Uint8Array(new Uint8Array(source.pixels.buffer, source.pixels.byteOffset, source.pixels.byteLength));
	let pixels: Uint8Array<ArrayBuffer> | null = null;
	try {
		pixels = await resizeRgba8NearestAsyncV1(snapshot, plan.source.width, plan.source.height, plan.output.width, plan.output.height, signal);
		signal?.throwIfAborted();
		if (pixels.byteLength !== plan.byteLength) throw new RangeError('Photo preview output disagrees with its admitted plan.');
		const outputSha256 = bytesToHex(sha256(pixels));
		const body = new Blob([pixels], { type: 'application/vnd.scaper.rgba8' });
		signal?.throwIfAborted();
		return Object.freeze({ schemaVersion: 1, kind: 'photo-preview', key: plan.key, binding: plan.binding, tier: plan.tier,
			recipe: plan.recipe, descriptor: plan.output, byteLength: plan.byteLength, outputSha256, body });
	} finally { snapshot.fill(0); pixels?.fill(0); }
}
