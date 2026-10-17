/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { readPixelFrameDescriptorV1, readPixelFrameV1, type PixelFrameDescriptorV1 } from '../../common/editor/imaging/pixel-frame-contract-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1, RepairTaskBudgetV1, withRepairPixelFrameLifetimeV1 } from '../../common/editor/imaging/pixel-frame-repair-lifetime-v1.ts';
import { normalizePhotoHdrPreviewPlanCurrentV1, type PhotoHdrPreviewPlanCurrentV1 } from './photo-hdr-preview-plan-current-v1.ts';
import { normalizePhotoOriginalBindingCurrentV1, PHOTO_HDR_ORIGINAL_SOURCE_LIMITS_CURRENT_V1, type PhotoHdrOriginalBindingCurrentV1 } from './photo-original-binding-current-v1.ts';
import type { PhotoPreviewTierV1 } from './photo-preview-plan-v1.ts';

export interface PreparedPhotoHdrPreviewCurrentV1 {
	readonly schemaVersion: 1; readonly kind: 'photo-preview'; readonly key: string;
	readonly binding: Readonly<PhotoHdrOriginalBindingCurrentV1>; readonly tier: PhotoPreviewTierV1;
	readonly recipe: PhotoHdrPreviewPlanCurrentV1['recipe']; readonly descriptor: Readonly<PixelFrameDescriptorV1>;
	readonly byteLength: number; readonly outputSha256: string; readonly body: Blob;
}
const NativeFloats = Float32Array, NativeBytes = Uint8Array;
const TYPED = Object.getPrototypeOf(NativeBytes.prototype) as object;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!, OFFSET = Object.getOwnPropertyDescriptor(TYPED, 'byteOffset')!.get!;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const MAXIMUM = 512n * 1024n * 1024n;

/** Snapshot only selected native samples before the first yield. Original RGB
 * never enters a byte intermediate; output conversion is a final cache policy.
 * The physical bound includes the full borrowed native backing, fitted Float32
 * snapshot, output bytes and the immutable returned Blob's copy. */
export async function preparePhotoHdrPreviewCurrentV1(value: unknown): Promise<Readonly<PreparedPhotoHdrPreviewCurrentV1>> {
	const ownSignal = typeof value === 'object' && value !== null ? Object.getOwnPropertyDescriptor(value, 'signal') : undefined;
	if (ownSignal && !Object.hasOwn(ownSignal, 'value')) throw new TypeError('HDR preview signal requires own data.');
	const signal = captureRepairSignalV1(ownSignal?.value), check = () => { checkRepairSignalV1(signal); }; check();
	const input = record(value, 'HDR preview preparation', ['plan', 'binding', 'frame', 'signal'], ['plan', 'binding', 'frame']);
	const plan = normalizePhotoHdrPreviewPlanCurrentV1(field(input, 'plan', 'HDR preview preparation'));
	const binding = normalizePhotoOriginalBindingCurrentV1(field(input, 'binding', 'HDR preview preparation'));
	if (JSON.stringify(binding) !== JSON.stringify(plan.binding)) throw new RangeError('HDR preview Original binding changed.');
	const rawValue = field(input, 'frame', 'HDR preview preparation');
	if (rawValue === null || typeof rawValue !== 'object') throw new TypeError('HDR preview requires a native source frame.');
	const descriptor = readPixelFrameDescriptorV1(field(rawValue as Readonly<Record<string, unknown>>, 'descriptor', 'HDR preview source'));
	if (JSON.stringify(descriptor) !== JSON.stringify(plan.source)) throw new RangeError('HDR preview native source profile or geometry changed.');
	const snapshotBytes = plan.output.width * plan.output.height * 16;
	const declaredBytes = descriptor.width * descriptor.height * 16;
	if (BigInt(declaredBytes) + BigInt(snapshotBytes) + 2n * BigInt(plan.byteLength) + 4096n > MAXIMUM) throw new RangeError('HDR preview exceeds its physical preparation budget.');
	const raw = record(rawValue, 'HDR preview source', ['descriptor', 'pixels']);
	const frame = readPixelFrameV1({ descriptor, pixels: field(raw, 'pixels', 'HDR preview source') }, PHOTO_HDR_ORIGINAL_SOURCE_LIMITS_CURRENT_V1);
	if (!(frame.pixels instanceof NativeFloats)) throw new TypeError('HDR previews require native Float32 source samples.');
	const backing = Reflect.apply(BUFFER, frame.pixels, []) as ArrayBuffer, physicalBytes = Number(Reflect.apply(SIZE, backing, []));
	if (BigInt(physicalBytes) + BigInt(snapshotBytes) + 2n * BigInt(plan.byteLength) + 4096n > MAXIMUM) throw new RangeError('HDR preview source backing exceeds its physical preparation budget.');
	const source = new NativeFloats(backing, Number(Reflect.apply(OFFSET, frame.pixels, [])), declaredBytes / 4);
	check();
	return withRepairPixelFrameLifetimeV1(async owner => {
		const snapshot = new NativeFloats(owner.bytes(snapshotBytes).buffer);
		for (let y = 0; y < plan.output.height; y++) for (let x = 0; x < plan.output.width; x++) {
			const from = (Math.floor(y * descriptor.height / plan.output.height) * descriptor.width + Math.floor(x * descriptor.width / plan.output.width)) * 4;
			const to = (y * plan.output.width + x) * 4;
			for (let channel = 0; channel < 4; channel++) snapshot[to + channel] = source[from + channel]!;
		}
		check();
		const pixels = owner.bytes(plan.byteLength), budget = new RepairTaskBudgetV1(check);
		for (let at = 0; at < snapshot.length; at += 4) {
			for (let channel = 0; channel < 3; channel++) {
				const linear = Math.max(0, Math.min(1, snapshot[at + channel]!));
				pixels[at + channel] = Math.round(255 * (linear <= .0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - .055));
			}
			pixels[at + 3] = Math.round(snapshot[at + 3]! * 255);
			if (budget.visit()) await budget.yield();
		}
		check(); const outputSha256 = bytesToHex(sha256(pixels)), body = new Blob([pixels], { type: 'application/vnd.scaper.rgba8' }); check();
		return Object.freeze({ schemaVersion: 1, kind: 'photo-preview', key: plan.key, binding: plan.binding, tier: plan.tier,
			recipe: plan.recipe, descriptor: plan.output, byteLength: plan.byteLength, outputSha256, body });
	});
}
