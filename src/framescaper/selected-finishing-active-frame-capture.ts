/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../common/editor/closed-domain-value.ts';
import { admitPixelFrameV1 } from '../common/editor/imaging/pixel-frame-admission-v1.ts';
import { readPixelFrameV1 } from '../common/editor/imaging/pixel-frame-contract-v1.ts';
import type { UnifiedExactRenderRgbaFrameV13 as Frame } from '../common/editor/unified-exact-render-finishing-consumers-v13.ts';

const CHECK = AbortSignal.prototype.throwIfAborted, FILL = Uint8Array.prototype.fill;
const LIMITS = Object.freeze({ maximumSidePixels: 65_536, maximumPixels: 33_554_432, maximumBytes: 128 * 1024 * 1024 });

/** Start every admitted drawable capture before any resource consumer await.
 * Each result becomes an independent native byte snapshot. The complete active
 * capture ledger is bounded to the fixed Frame128MiB profile, then retired
 * only after every started callback and the scoped consumer have joined. */
export async function withFramescaperActiveFrameCapturesV1<Entry, Result>(entries: readonly Entry[],
	capture: (entry: Entry, signal: AbortSignal) => Frame | PromiseLike<Frame>, signal: AbortSignal,
	consume: (frames: readonly Frame[]) => Result | PromiseLike<Result>): Promise<Result> {
	const check = () => { Reflect.apply(CHECK, signal, []); };
	check();
	if (!Array.isArray(entries) || entries.length > 100_000 || typeof capture !== 'function' || typeof consume !== 'function') {
		throw new TypeError('A bounded active Frame capture list and scoped callbacks are required.');
	}
	const frames: Frame[] = [], pending: Promise<void>[] = [], failures: unknown[] = [];
	let totalBytes = 0;
	const fail = (error: unknown) => { if (!failures.some(value => Object.is(value, error))) failures.push(error); };
	function accept(value: unknown, index: number): void {
		const raw = record(value, 'Active Frame capture', ['width', 'height', 'pixels']);
		const plan = admitPixelFrameV1({ schemaVersion: 1, width: field(raw, 'width', 'Active Frame capture'),
			height: field(raw, 'height', 'Active Frame capture'), sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, { limits: LIMITS });
		if (totalBytes + plan.byteLength > LIMITS.maximumBytes) throw new RangeError('Active Frame captures exceed their128MiB byte ledger.');
		const source = readPixelFrameV1({ descriptor: plan.descriptor, pixels: field(raw, 'pixels', 'Active Frame capture') }, LIMITS);
		check();
		const native = new Uint8Array(source.pixels.buffer, source.pixels.byteOffset, plan.byteLength);
		const pixels = new Uint8Array(native);
		frames[index] = Object.freeze({ width: plan.descriptor.width, height: plan.descriptor.height, pixels });
		totalBytes += plan.byteLength;
	}
	try {
		for (let index = 0; index < entries.length; index++) {
			try {
				check();
				if (!Object.hasOwn(entries, index)) throw new TypeError('Active Frame captures must retain dense authored order.');
				const value = capture(entries[index]!, signal);
				// Real synchronous captures detach before this API returns. Async
				// callbacks are all started first and their actual settlement joins.
				if (Object.hasOwn(value, 'pixels')) accept(value, index);
				else pending.push(Promise.resolve(value).then(result => { accept(result, index); }, fail).catch(fail));
			} catch (error) { fail(error); break; }
		}
		await Promise.all(pending);
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) throw new AggregateError(failures, 'Active Frame capture failures.');
		check();
		const result = await consume(Object.freeze(frames));
		check();
		return result;
	} finally {
		for (const frame of frames) if (frame) Reflect.apply(FILL, frame.pixels, [0]);
	}
}
