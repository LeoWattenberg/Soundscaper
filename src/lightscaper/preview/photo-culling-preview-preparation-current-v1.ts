/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { admitPixelFrameV1 } from '../../common/editor/imaging/pixel-frame-admission-v1.ts';
import { readPixelFrameV1, type PixelFrameDescriptorV1 } from '../../common/editor/imaging/pixel-frame-contract-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1, withRepairPixelFrameLifetimeV1 } from '../../common/editor/imaging/pixel-frame-repair-lifetime-v1.ts';
import { normalizePhotoPreviewOriginalBindingV1, PHOTO_PREVIEW_SOURCE_LIMITS_V1,
	type PhotoPreviewOriginalBindingV1, type PhotoPreviewTierV1 } from './photo-preview-plan-v1.ts';
import { normalizePhotoCullingPreviewPlanCurrentV1, type PhotoCullingPreviewPlanCurrentV1 } from './photo-culling-preview-plan-current-v1.ts';

export const PHOTO_CULLING_PREVIEW_WORKING_BYTES_CURRENT_V1 = 192 * 1024 * 1024;
export type PhotoCullingPreviewRepresentationCurrentV1 = 'camera-embedded' | 'neutral-original';
export interface PreparedPhotoCullingPreviewCurrentV1 {
	readonly schemaVersion: 1; readonly kind: 'photo-preview'; readonly key: string;
	readonly binding: Readonly<PhotoPreviewOriginalBindingV1>; readonly tier: PhotoPreviewTierV1;
	readonly recipe: PhotoCullingPreviewPlanCurrentV1['recipe']; readonly descriptor: Readonly<PixelFrameDescriptorV1>;
	readonly byteLength: number; readonly outputSha256: string; readonly body: Blob;
}
const TYPED = Object.getPrototypeOf(Uint8Array.prototype) as object;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!;
const OFFSET = Object.getOwnPropertyDescriptor(TYPED, 'byteOffset')!.get!;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;

/** Borrow actual already-oriented camera pixels independently of sensor extent.
 * The native Original fallback preserves the legacy exact nearest operation.
 * Only the fixed target body survives physical snapshot/output retirement. */
export async function preparePhotoCullingPreviewCurrentV1(value: unknown): Promise<Readonly<PreparedPhotoCullingPreviewCurrentV1>> {
	const signalField = typeof value === 'object' && value !== null ? Object.getOwnPropertyDescriptor(value, 'signal') : undefined;
	if (signalField && !Object.hasOwn(signalField, 'value')) throw new TypeError('Current culling cancellation must be own data.');
	const signal = captureRepairSignalV1(signalField?.value), check = () => { checkRepairSignalV1(signal); };
	const admitted = (() => { try {
		check(); const input = record(value, 'Current culling preparation', ['plan', 'binding', 'frame', 'signal', 'representation'], ['plan', 'binding', 'frame']);
		const plan = normalizePhotoCullingPreviewPlanCurrentV1(field(input, 'plan', 'Current culling preparation'));
		const binding = normalizePhotoPreviewOriginalBindingV1(field(input, 'binding', 'Current culling preparation'));
		if (JSON.stringify(binding) !== JSON.stringify(plan.binding)) throw new RangeError('Current culling Original binding changed.');
		const representation = Object.hasOwn(input, 'representation') ? field(input, 'representation', 'Current culling preparation') : 'camera-embedded';
		if (representation !== 'camera-embedded' && representation !== 'neutral-original') throw new TypeError('Unknown Current culling representation.');
		const raw = field(input, 'frame', 'Current culling preparation');
		if (typeof raw !== 'object' || raw === null) throw new TypeError('Current culling requires a byte frame.');
		const metadata = admitPixelFrameV1(field(raw as Readonly<Record<string, unknown>>, 'descriptor', 'Current culling frame'), { limits: PHOTO_PREVIEW_SOURCE_LIMITS_V1 });
		if (representation === 'neutral-original' && (metadata.descriptor.width !== binding.width || metadata.descriptor.height !== binding.height)) {
			throw new RangeError('Current culling fallback differs from its Original extent.');
		}
		const captured = record(raw, 'Current culling frame', ['descriptor', 'pixels']);
		const pixels = field(captured, 'pixels', 'Current culling frame');
		const frame = readPixelFrameV1({ descriptor: metadata.descriptor, pixels }, PHOTO_PREVIEW_SOURCE_LIMITS_V1);
		if (frame.descriptor.sampleFormat !== 'unorm8') throw new RangeError('Current culling requires encoded sRGB RGBA8.');
		const backing = Reflect.apply(BUFFER, frame.pixels, []) as ArrayBuffer, sourceBytes = Number(Reflect.apply(SIZE, backing, []));
		if (sourceBytes + metadata.byteLength + plan.byteLength * 2 + 4096 > PHOTO_CULLING_PREVIEW_WORKING_BYTES_CURRENT_V1) {
			throw new RangeError('Current culling preparation exceeds its physical working byte bound.');
		}
		check(); return { plan, frame, metadata, backing, offset: Number(Reflect.apply(OFFSET, frame.pixels, [])), representation };
	} catch (error) { check(); throw error; } })();
	return withRepairPixelFrameLifetimeV1(async owner => {
		const { plan, frame, metadata, backing, offset, representation } = admitted;
		const snapshot = owner.copy(new Uint8Array(backing, offset, metadata.byteLength), metadata.byteLength), output = owner.bytes(plan.byteLength);
		const sourceWidth = frame.descriptor.width, sourceHeight = frame.descriptor.height, targetWidth = plan.output.width, targetHeight = plan.output.height;
		const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
		const width = representation === 'neutral-original' ? targetWidth : Math.max(1, Math.min(targetWidth, Math.round(sourceWidth * scale)));
		const height = representation === 'neutral-original' ? targetHeight : Math.max(1, Math.min(targetHeight, Math.round(sourceHeight * scale)));
		const left = Math.floor((targetWidth - width) / 2), top = Math.floor((targetHeight - height) / 2);
		const task = async () => { check(); await new Promise<void>(resolve => { setTimeout(resolve, 0); }); check(); };
		try {
			await task();
			for (let y = 0; y < targetHeight; y++) {
				for (let x = 0; x < targetWidth; x++) {
					const target = (y * targetWidth + x) * 4;
					if (x < left || x >= left + width || y < top || y >= top + height) { output[target + 3] = 255; continue; }
					const sx = Math.min(sourceWidth - 1, Math.floor((x - left) * sourceWidth / width));
					const sy = Math.min(sourceHeight - 1, Math.floor((y - top) * sourceHeight / height));
					const source = (sy * sourceWidth + sx) * 4;
					for (let channel = 0; channel < 4; channel++) output[target + channel] = snapshot[source + channel]!;
				}
				if ((y + 1) % 16 === 0 && y + 1 < targetHeight) await task();
			}
			check(); const outputSha256 = bytesToHex(sha256(output)), body = new Blob([output], { type: 'application/vnd.scaper.rgba8' }); check();
			return Object.freeze({ schemaVersion: 1 as const, kind: 'photo-preview' as const, key: plan.key, binding: plan.binding, tier: plan.tier,
				recipe: plan.recipe, descriptor: plan.output, byteLength: plan.byteLength, outputSha256, body });
		} catch (error) { check(); throw error; }
	});
}
