/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from './closed-domain-value.ts';
import type { FramescaperRawImageSourceCurrentV1 } from './timeline-image-model-current-v1.ts';
import { framescaperImagePackSourceCurrentV1 } from './timeline-image-pack-source-current-v1.ts';
import { withDecodedRawOriginalV1, type RawDecodedOriginalV1 } from './raw/libraw-runtime-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1 } from './imaging/pixel-frame-repair-lifetime-v1.ts';
import { prepareFramescaperRawImageOriginalCurrentV1 } from './timeline-image-raw-original-plan-current-v1.ts';
import { withFramescaperRawImageEncodedOriginalCurrentV1, verifyFramescaperRawOriginalBindingViewCurrentV1 } from './timeline-image-raw-encoded-current-v1.ts';
export { prepareFramescaperRawImageOriginalCurrentV1 } from './timeline-image-raw-original-plan-current-v1.ts';

export interface FramescaperRawImageOriginalRequestCurrentV1 {
	readonly source: unknown;
	readonly read: (offset: number, length: number) => Uint8Array | Promise<Uint8Array>;
	readonly assertCurrent?: () => void | Promise<void>;
	readonly signal?: AbortSignal;
}
export interface FramescaperRawImageOriginalViewCurrentV1 extends RawDecodedOriginalV1 { readonly originalBytes: Uint8Array<ArrayBuffer> }
export interface FramescaperRawImageOriginalPortsCurrentV1 { readonly withRawOriginal?: typeof withDecodedRawOriginalV1 }

/** Permanent canonical proof: unchanged pinned ABI1 word digest and orientation,
 * with the complete Source4 admission retained at this public boundary. */
export async function verifyFramescaperRawOriginalViewCurrentV1(source: Readonly<FramescaperRawImageSourceCurrentV1>,
	view: Readonly<RawDecodedOriginalV1>, signal?: AbortSignal): Promise<void> {
	checkRepairSignalV1(signal);
	await verifyFramescaperRawOriginalBindingViewCurrentV1({ pack: framescaperImagePackSourceCurrentV1(source), raw: source.raw }, view, signal);
}

/** The shared byte owner authenticates only pack+receipt+encoded authority.
 * This facade preserves full Source4 validation and its one ABI1 decode. */
export async function withFramescaperRawImageOriginalCurrentV1<Result>(value: FramescaperRawImageOriginalRequestCurrentV1,
	consume: (view: Readonly<FramescaperRawImageOriginalViewCurrentV1>) => Result | Promise<Result>,
	dependencies: FramescaperRawImageOriginalPortsCurrentV1 = {}): Promise<Result> {
	const ownSignal = typeof value === 'object' && value !== null ? Object.getOwnPropertyDescriptor(value, 'signal') : undefined;
	if (ownSignal && !Object.hasOwn(ownSignal, 'value')) throw new TypeError('Frame RAW signal must be own data.');
	const signal = captureRepairSignalV1(ownSignal?.value);
	const input = record(value, 'Frame RAW Original request', ['source', 'read', 'assertCurrent', 'signal'], ['source', 'read']);
	const plan = prepareFramescaperRawImageOriginalCurrentV1(field(input, 'source', 'Frame RAW Original request'));
	const read = field(input, 'read', 'Frame RAW Original request'), current = Object.hasOwn(input, 'assertCurrent') ? field(input, 'assertCurrent', 'Frame RAW Original request') : undefined;
	if (typeof consume !== 'function' || typeof read !== 'function' || current !== undefined && typeof current !== 'function') throw new TypeError('Frame RAW Original requires inert scoped/range/current capabilities.');
	const ports = record(dependencies, 'Frame RAW Original ports', ['withRawOriginal'], []);
	const decode = Object.hasOwn(ports, 'withRawOriginal') ? field(ports, 'withRawOriginal', 'Frame RAW Original ports') : withDecodedRawOriginalV1;
	if (typeof decode !== 'function') throw new TypeError('Frame RAW Original requires a native decode method.');
	return withFramescaperRawImageEncodedOriginalCurrentV1({ binding: { pack: framescaperImagePackSourceCurrentV1(plan.source), raw: plan.source.raw },
		read: (offset, length) => Reflect.apply(read, value, [offset, length]) as Uint8Array | Promise<Uint8Array>,
		...(current ? { assertCurrent: () => Reflect.apply(current, value, []) as void | Promise<void> } : {}), ...(signal ? { signal } : {}) }, async original => {
		const result = await (Reflect.apply(decode, dependencies, [{ bytes: original.originalBytes, ...(signal ? { signal } : {}) }, async (view: Readonly<RawDecodedOriginalV1>) => {
			await original.assertCurrent(); await verifyFramescaperRawOriginalBindingViewCurrentV1(original.binding, view, signal); await original.assertCurrent();
			const result = await consume(Object.freeze({ frame: view.frame, rawFlip: view.rawFlip, originalBytes: original.originalBytes }));
			await original.assertCurrent(); return result;
		}]) as Promise<Result>);
		await original.assertCurrent(); return result;
	});
}
