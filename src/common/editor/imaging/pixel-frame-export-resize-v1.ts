/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { admitPixelFrameV1 } from './pixel-frame-admission-v1.ts';
import { readPixelFrameV1, type PixelFrameLimitsV1 } from './pixel-frame-contract-v1.ts';
import { planImageExportSizeV1 } from './image-export-size-v1.ts';
import { withGeometryPixelFrameV1, type GeometryPixelFrameV1 } from './pixel-frame-geometry-v1.ts';
import { resizeRgba8NearestAsyncV1 } from './pixel-frame-resize-v1.ts';

const IDENTITY = Object.freeze({ schemaVersion: 1, crop: null, rotationDegrees: 0,
	flipHorizontal: false, flipVertical: false, perspective: null });
const CHECK = AbortSignal.prototype.throwIfAborted;
const BUFFER_SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;

/** Output-only resampling of an already developed frame, under one captured
 * capacity. Nearest retains its established top-left sampling; bilinear reuses
 * the shared encoded-sRGB premultiplied geometry renderer's centered contain
 * convention. An unchanged size copies exact bytes, including hidden RGB.
 * One output is borrowed until the consumer settles, then wiped. This never
 * mutates, crops or revises the source photo or its develop recipe. */
export async function withExportResizedPixelFrameV1<Result>(value: unknown,
	consume: (frame: GeometryPixelFrameV1) => Result | Promise<Result>,
	optionsValue: Readonly<{ limits: PixelFrameLimitsV1 }>): Promise<Result> {
	const input = record(value, 'export resize request', ['frame', 'sizing', 'quality', 'signal'], ['frame', 'sizing', 'quality']);
	const signalValue = Object.hasOwn(input, 'signal') ? field(input, 'signal', 'export resize request') : undefined;
	if (signalValue !== undefined && !(signalValue instanceof AbortSignal)) throw new TypeError('Export resize requires a native cancellation signal.');
	const signal = signalValue;
	const check = () => { if (signal) Reflect.apply(CHECK, signal, []); };
	check(); if (typeof consume !== 'function') throw new TypeError('Export resize requires a scoped pixel consumer.');
	const quality = field(input, 'quality', 'export resize request');
	if (quality !== 'nearest' && quality !== 'bilinear') throw new RangeError('Unsupported export resize quality.');
	const options = record(optionsValue, 'export resize options', ['limits']);
	const limitRecord = record(field(options, 'limits', 'export resize options'), 'export resize limits', ['maximumSidePixels', 'maximumPixels', 'maximumBytes']);
	const limit = (key: string): number => {
		const value = field(limitRecord, key, 'export resize limits');
		if (typeof value !== 'number') throw new TypeError('Export resize limits require numbers.');
		return value;
	};
	const limits = Object.freeze({ maximumSidePixels: limit('maximumSidePixels'),
		maximumPixels: limit('maximumPixels'), maximumBytes: limit('maximumBytes') });
	const raw = record(field(input, 'frame', 'export resize request'), 'export resize source', ['descriptor', 'pixels']);
	const admitted = admitPixelFrameV1(field(raw, 'descriptor', 'export resize source'), { limits });
	const source = readPixelFrameV1({ descriptor: admitted.descriptor, pixels: field(raw, 'pixels', 'export resize source') }, limits);
	if (source.descriptor.sampleFormat !== 'unorm8') throw new RangeError('Export resize requires UNORM8 encoded sRGB.');
	const plan = planImageExportSizeV1(source.descriptor, field(input, 'sizing', 'export resize request'), limits);
	const borrowed = new Uint8Array(source.pixels.buffer, source.pixels.byteOffset, admitted.byteLength), sourceBuffer = borrowed.buffer;
	const checkSource = () => {
		check(); if (Number(Reflect.apply(BUFFER_SIZE, sourceBuffer, [])) === 0) throw new RangeError('Export resize source buffer was detached.');
	};
	checkSource();
	if (quality === 'bilinear' && (plan.target.width !== source.descriptor.width || plan.target.height !== source.descriptor.height)) {
		return withGeometryPixelFrameV1({ frame: { descriptor: source.descriptor, pixels: borrowed }, geometry: IDENTITY, signal },
			async output => { checkSource(); const result = await consume(output); checkSource(); return result; },
			{ limits, delivery: { width: plan.target.width, height: plan.target.height } });
	}
	const pixels = await resizeRgba8NearestAsyncV1(borrowed, source.descriptor.width, source.descriptor.height, plan.target.width, plan.target.height, signal);
	const buffer = pixels.buffer;
	try {
		checkSource();
		const descriptor = Object.freeze({ ...plan.target, sampleFormat: 'unorm8' as const });
		const result = await consume(Object.freeze({ descriptor, pixels })); checkSource(); return result;
	} finally { if (Number(Reflect.apply(BUFFER_SIZE, buffer, [])) > 0) new Uint8Array(buffer).fill(0); }
}
