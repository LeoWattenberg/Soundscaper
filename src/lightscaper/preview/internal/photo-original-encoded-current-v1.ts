/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../../common/editor/closed-domain-value.ts';
import { IMAGE_IMPORT_LIMITS } from '../../../common/editor/image-import-admission.ts';
import { planPixelFrameV1 } from '../../../common/editor/imaging/pixel-frame-contract-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1 } from '../../../common/editor/imaging/pixel-frame-repair-lifetime-v1.ts';
import { probeRawSourceV1, type RawSourceAdmissionV1 } from '../../../common/editor/raw/raw-source-v1.ts';
import { canonicalMediaContentBlob } from '../../../common/editor/storage/media-content-digest.ts';
import { normalizePhotoPreviewOriginalBindingV1, type PhotoPreviewOriginalBindingV1 } from '../photo-preview-plan-v1.ts';

export const PHOTO_ORIGINAL_DERIVED_LIMITS_CURRENT_V1 = Object.freeze({ maximumSidePixels: 8192,
	maximumPixels: 16_777_216, maximumBytes: 256 * 1024 * 1024 });
const MAXIMUM = 1024n * 1024n * 1024n, MIB = 1024n * 1024n;
const BUFFER_SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const RESIZABLE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')!.get!;
const READ = Blob.prototype.arrayBuffer, NativeBytes = Uint8Array;

export interface PhotoOriginalEncodedViewCurrentV1 {
	readonly binding: Readonly<PhotoPreviewOriginalBindingV1>;
	readonly bytes: Uint8Array<ArrayBuffer>;
	readonly rawSource: RawSourceAdmissionV1;
	readonly signal: AbortSignal;
	readonly assertCurrent: () => Promise<void>;
	readonly finishDecode: () => void;
}
export interface PhotoOriginalEncodedPortsCurrentV1 { readonly assertCurrent?: () => void | Promise<void> }

/** Declared admission precedes retained-body IO. ABI 1's word plane retires
 * before ABI 2; the larger decode phase charges the held Blob, owned encoded
 * snapshot and worker input copy, 512 MiB Wasm, 256 MiB host RGBA and 32 MiB
 * reserve. These are physical ownership bounds, not browser RSS predictions. */
export function admitPhotoOriginalEncodedBindingCurrentV1(value: unknown): Readonly<PhotoPreviewOriginalBindingV1> {
	const binding = normalizePhotoPreviewOriginalBindingV1(value);
	if (binding.width < 16 || binding.height < 16) throw new RangeError('Derived RAW Originals require at least sixteen pixels per side.');
	planPixelFrameV1({ schemaVersion: 1, width: binding.width, height: binding.height,
		sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' }, PHOTO_ORIGINAL_DERIVED_LIMITS_CURRENT_V1);
	if (512n * MIB + 256n * MIB + 32n * MIB + 3n * BigInt(binding.byteLength) > MAXIMUM) {
		throw new RangeError('Derived RAW Original decode exceeds its one-GiB physical phase bound.');
	}
	return binding;
}

/** Encoded authority only. Native receipt proof belongs to the caller's ABI 1
 * phase; neither a decoded frame nor a mutable byte body escapes this scope. */
export async function withPhotoOriginalEncodedCurrentV1<Result>(value: unknown,
	consume: (view: Readonly<PhotoOriginalEncodedViewCurrentV1>) => Result | Promise<Result>,
	dependencies: Readonly<PhotoOriginalEncodedPortsCurrentV1> = {}): Promise<Result> {
	const ownSignal = typeof value === 'object' && value !== null ? Object.getOwnPropertyDescriptor(value, 'signal') : undefined;
	if (ownSignal && !Object.hasOwn(ownSignal, 'value')) throw new TypeError('Encoded Original signal must be own data.');
	const external = captureRepairSignalV1(ownSignal?.value);
	const input = record(value, 'encoded Current Original', ['binding', 'body', 'signal'], ['binding', 'body']);
	const binding = admitPhotoOriginalEncodedBindingCurrentV1(field(input, 'binding', 'encoded Current Original'));
	if (typeof consume !== 'function') throw new TypeError('Encoded Original requires a scoped consumer.');
	const ports = record(dependencies, 'encoded Original ports', ['assertCurrent'], []);
	const current = Object.hasOwn(ports, 'assertCurrent') ? field(ports, 'assertCurrent', 'encoded Original ports') : undefined;
	if (current !== undefined && typeof current !== 'function') throw new TypeError('Encoded Original requires an inert current fence.');
	const body = canonicalMediaContentBlob(field(input, 'body', 'encoded Current Original'));
	if (body.size !== binding.byteLength) throw new RangeError('Retained Original Blob length differs from its binding.');
	const deadline = new AbortController(), signal = external ? AbortSignal.any([external, deadline.signal]) : deadline.signal;
	const timer = setTimeout(() => { deadline.abort(new DOMException('Derived Original exceeded its decode deadline.', 'TimeoutError')); },
		IMAGE_IMPORT_LIMITS.maximumDecodeMillisecondsPerFile);
	let backing: ArrayBuffer | undefined, length = 0, bytes: Uint8Array<ArrayBuffer> | undefined;
	let outcome: { value: Result } | { error: unknown };
	const authenticate = () => {
		checkRepairSignalV1(signal);
		if (!backing || Reflect.apply(BUFFER_SIZE, backing, []) !== length) throw new TypeError('Encoded Original backing detached or changed.');
		if (length !== binding.byteLength || bytesToHex(sha256(new NativeBytes(backing))) !== binding.contentSha256) {
			throw new RangeError('Retained Original SHA-256 or byte length differs from its binding.');
		}
	};
	const fence = async () => {
		checkRepairSignalV1(signal);
		if (current) await Reflect.apply(current, dependencies, []);
		checkRepairSignalV1(signal); if (bytes) authenticate();
	};
	try {
		await fence();
		const loaded: unknown = await Reflect.apply(READ, body, []);
		if (!(loaded instanceof ArrayBuffer) || Reflect.apply(RESIZABLE, loaded, [])) throw new TypeError('Encoded Original requires fixed nonshared storage.');
		backing = loaded; length = Number(Reflect.apply(BUFFER_SIZE, loaded, []));
		bytes = new NativeBytes(backing); authenticate();
		const rawSource = probeRawSourceV1(bytes);
		if (!rawSource) throw new TypeError('Derived Original requires an authenticated supported RAW container.');
		await fence();
		outcome = { value: await consume(Object.freeze({ binding, bytes, rawSource, signal, assertCurrent: fence,
			finishDecode() { clearTimeout(timer); } })) };
		await fence();
	} catch (error) { outcome = { error }; }
	clearTimeout(timer);
	const failures: unknown[] = 'error' in outcome ? [outcome.error] : [];
	try {
		if (backing) {
			if (Reflect.apply(BUFFER_SIZE, backing, []) !== length) throw new TypeError('Encoded Original detached before physical retirement.');
			new NativeBytes(backing).fill(0);
		}
	} catch (error) { failures.push(error); }
	if (failures.length === 1) throw failures[0];
	if (failures.length > 1) throw new AggregateError(failures, 'Derived Original operation and encoded retirement failed.', { cause: failures[0] });
	if ('value' in outcome) return outcome.value;
	throw new Error('Encoded Original scope has no outcome.');
}
