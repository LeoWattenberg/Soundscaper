/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../common/editor/closed-domain-value.ts';
import { normalizeFramescaperImageSourceV2, framescaperImageSourceResourceReferencesV2 } from '../common/editor/timeline-image-model-v2.ts';
import { FRAMESCAPER_IMAGE_MODEL_LIMITS_V1 as LIMITS, type FramescaperImageSourceV1 } from '../common/editor/timeline-image-model.ts';
import { openFramescaperImageFramePackV1 } from '../common/editor/timeline-image-frame-pack-v1.ts';
import { withImageDevelopFrameV2, captureImageDevelopCubeLutSourceV2, type ImageDevelopFrameOptionsV2 } from '../common/editor/imaging/image-develop-frame-v2.ts';
import { withCubeLutResourceV1 } from '../common/editor/imaging/cube-lut-resource-v1.ts';
import type { ImageDevelopFrameViewV1 } from '../common/editor/imaging/image-develop-frame-core.ts';
import { planImageDevelopMasksV1 } from '../common/editor/imaging/image-develop-mask-plan-v1.ts';

const CHECK = AbortSignal.prototype.throwIfAborted;
const SIGNAL_PROTOTYPE = AbortSignal.prototype;
const BUFFER_SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const FILL = Uint8Array.prototype.fill;
const PIXEL_LIMITS = Object.freeze({ maximumSidePixels: LIMITS.maximumDimension, maximumPixels: LIMITS.maximumPixelsPerFrame, maximumBytes: LIMITS.maximumPixelsPerFrame * 4 });
const PROFILE = Object.freeze({ source: PIXEL_LIMITS, render: PIXEL_LIMITS });

/** Evaluate one authenticated canonical static original at natural recipe dimensions.
 * The V1 pack reader remains the byte authority; no legacy project/archive source is upgraded.
 * Every declared LUT, including disabled references, is authenticated through its selected
 * source owner. No frame or resource body survives the awaited consumer. */
export async function withFramescaperImageDevelopFrameV2<Result>(value: unknown,
	consume: (view: Readonly<ImageDevelopFrameViewV1>) => Result | Promise<Result>, optionsValue: ImageDevelopFrameOptionsV2 = {}): Promise<Result> {
	const input = record(value, 'Frame editable image request', ['source', 'read', 'assertCurrent', 'signal'], ['source', 'read']);
	const signal = Object.hasOwn(input, 'signal') ? field(input, 'signal', 'Frame editable image request') : undefined;
	if (signal !== undefined) assertSignal(signal);
	const check = () => { if (signal !== undefined) Reflect.apply(CHECK, signal, []); };
	check(); if (typeof consume !== 'function') throw new TypeError('Editable image delivery requires a scoped consumer.');
	const source = normalizeFramescaperImageSourceV2(field(input, 'source', 'Frame editable image request'));
	planImageDevelopMasksV1(source.develop, source.canonical.width, source.canonical.height, PIXEL_LIMITS);
	const rawRead = field(input, 'read', 'Frame editable image request');
	if (typeof rawRead !== 'function') throw new TypeError('Editable image requires an authenticated range reader.');
	const rawCurrent = Object.hasOwn(input, 'assertCurrent') ? field(input, 'assertCurrent', 'Frame editable image request') : undefined;
	if (rawCurrent !== undefined && typeof rawCurrent !== 'function') throw new TypeError('Editable image currentness requires a method.');
	const current = async () => { check(); if (rawCurrent) await Reflect.apply(rawCurrent, value, []); check(); };
	const read = (offset: number, length: number) => Reflect.apply(rawRead, value, [offset, length]) as Uint8Array | Promise<Uint8Array>;
	const options = record(optionsValue, 'Photo develop resource options', ['source'], []);
	const references = framescaperImageSourceResourceReferencesV2(source);
	const lutSource = references.length ? captureImageDevelopCubeLutSourceV2(field(options, 'source', 'Photo develop resource source')) : undefined;
	// This projection admits pack metadata only, never an editable source to a legacy host.
	const { develop: _develop, developed: _developed, provenance: _provenance, ...packed } = source;
	const packSource: FramescaperImageSourceV1 = { ...packed, schemaVersion: 1 };
	await current();
	const pack = await openFramescaperImageFramePackV1({ source: packSource, read, assertCurrent: current, ...(signal === undefined ? {} : { signal }) });
	for (const reference of references) {
		let verified = false;
		await lutSource!.withBytes(reference, bytes => withCubeLutResourceV1({ reference, bytes, ...(signal === undefined ? {} : { signal }) }, () => { verified = true; }),
			signal === undefined ? undefined : { signal });
		if (!verified) throw new Error('Editable image resource source did not authenticate its declared body.');
		await current();
	}
	const pixels = await pack.readFrame(0, signal);
	const backing = pixels.buffer;
	try {
		await current();
		return await withImageDevelopFrameV2({ frame: { descriptor: { schemaVersion: 1, width: source.canonical.width, height: source.canonical.height,
			sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels }, develop: source.develop, ...(signal === undefined ? {} : { signal }) }, async view => {
			if (view.frame.descriptor.width !== source.developed.width || view.frame.descriptor.height !== source.developed.height) {
				throw new Error('Editable image natural output differs from its declared dimensions.');
			}
			await current(); const result = await consume(view); await current(); return result;
		}, PROFILE, lutSource === undefined ? {} : { source: lutSource });
	} finally { if (Number(Reflect.apply(BUFFER_SIZE, backing, [])) > 0) Reflect.apply(FILL, pixels, [0]); }
}

function assertSignal(value: unknown): asserts value is AbortSignal {
	if (typeof value !== 'object' || value === null) throw new TypeError('Editable image requires a native cancellation signal.');
	Reflect.apply(CHECK, value, []);
	if (Object.getPrototypeOf(value) !== SIGNAL_PROTOTYPE || ['aborted', 'reason', 'throwIfAborted', 'addEventListener', 'removeEventListener'].some(key => Object.hasOwn(value, key))) {
		throw new TypeError('Editable image requires native cancellation behavior without overrides.');
	}
}
