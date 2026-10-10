/* SPDX-License-Identifier: AGPL-3.0-only */

import type { CubeLutSourcePortV1 } from '../../common/editor/imaging/cube-lut-source-port-v1.ts';
import { withCubeLutResourceV1 } from '../../common/editor/imaging/cube-lut-resource-v1.ts';
import { normalizeVideoColorGradeV1 } from '../../common/editor/video-color-management-v27.ts';
import type { VideoCubeLutReferenceV1 } from '../../common/editor/video-color-cube-lut-v27.ts';
import { readPhotoDevelopSignalOptionsV2 } from '../storage/photo-develop-preset-read-v2.ts';
import type { PhotoLibrarySessionPortsV2 } from './photo-library-session-ports-v2.ts';

const CHECK = AbortSignal.prototype.throwIfAborted;
function check(signal: AbortSignal): void { Reflect.apply(CHECK, signal, []); }

/** Shared selected-Session resource scope. The owning caller admits its exact
 * unique reference closure and byte bound first. Pin the native source before
 * prepare can yield, authenticate every active/disabled body, then lend one
 * scoped reader. One active read and one settled failure witness bound tracking;
 * forgotten children join before return, with opaque failures preserved. */
export async function withPhotoLibraryImageHandoffResourcesV1<Result>(
	ports: PhotoLibrarySessionPortsV2, lutReferences: readonly Readonly<VideoCubeLutReferenceV1>[], signal: AbortSignal,
	prepare: () => Promise<void>, consume: (withLutBytes: CubeLutSourcePortV1['withBytes']) => Result | Promise<Result>,
): Promise<Result> {
	check(signal);
	let source: Readonly<CubeLutSourcePortV1> | undefined, loadLut: CubeLutSourcePortV1['withBytes'] | undefined;
	if (lutReferences.length) {
		if (!ports.cubeLutResources) throw new Error('Image handoff LUT source is unavailable.');
		check(signal);
		source = (await ports.cubeLutResources()).source; check(signal);
		const descriptor = Object.getOwnPropertyDescriptor(source, 'withBytes');
		if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') throw new TypeError('Image handoff requires an own callable LUT source.');
		loadLut = descriptor.value as CubeLutSourcePortV1['withBytes'];
	}
	check(signal);
	await prepare(); check(signal);
	const readLut = async <Value>(reference: Readonly<VideoCubeLutReferenceV1>, borrower: (bytes: Uint8Array<ArrayBuffer>) => Value | Promise<Value>): Promise<Value> => {
		if (!source || !loadLut) throw new Error('Image handoff LUT source is unavailable.');
		check(signal);
		type Outcome = { readonly ok: true; readonly value: Value } | { readonly ok: false; readonly reason: unknown };
		const delivery: { entered: boolean; settled: Promise<Outcome> | null } = { entered: false, settled: null };
		let acceptingBody = true, failed = false, primary: unknown;
		try {
			await (Reflect.apply(loadLut, source, [reference, (bytes: Uint8Array<ArrayBuffer>) => {
				if (!acceptingBody || delivery.entered) throw new Error('Image handoff LUT source requires exactly one joined body delivery.');
				delivery.entered = true;
				const work = withCubeLutResourceV1({ reference, bytes, signal }, () => borrower(bytes));
				delivery.settled = work.then(value => ({ ok: true, value }), reason => ({ ok: false, reason }));
				return work;
			}, { signal }]) as Promise<unknown>);
		} catch (error) { failed = true; primary = error; }
		acceptingBody = false;
		const outcome = await delivery.settled;
		if (failed) {
			if (outcome?.ok === false && outcome.reason !== primary) throw new AggregateError([primary, outcome.reason], 'Image handoff LUT transport and borrower failed.', { cause: primary });
			throw primary;
		}
		if (outcome === null) throw new Error('Image handoff LUT source did not deliver its authenticated body.');
		if (!outcome.ok) throw outcome.reason;
		check(signal); return outcome.value;
	};
	for (const reference of lutReferences) { await readLut(reference, () => undefined); check(signal); }
	let accepting = true, reading = false, resourceFailed = false, resourceFailure: unknown;
	let joined: Promise<void> | null = null;
	const withLutBytes: CubeLutSourcePortV1['withBytes'] = (value, borrower, options) => {
		try {
			if (!accepting) throw new Error('Image handoff resource capability is closed.');
			check(signal);
			const { signal: caller } = readPhotoDevelopSignalOptionsV2(options ?? {});
			if (caller !== undefined && caller !== signal) throw new TypeError('Image handoff resource reads use their captured lifetime signal.');
			const reference = normalizeVideoColorGradeV1({ ...normalizeVideoColorGradeV1(), lut: value }).lut;
			if (!reference || !lutReferences.some(expected => JSON.stringify(expected) === JSON.stringify(reference))) {
				throw new Error('Image handoff resource reference is outside the captured closure.');
			}
			if (typeof borrower !== 'function') throw new TypeError('Image handoff resource requires a callable consumer.');
			if (reading) throw new Error('An image handoff LUT read is already pending.');
			reading = true;
			const work = readLut(reference, borrower);
			// Capture one fulfilled join witness before caller continuations run.
			joined = work.then(() => { reading = false; }, error => {
				reading = false; if (!resourceFailed) { resourceFailed = true; resourceFailure = error; }
			});
			return work;
		} catch (error) { return Promise.reject(error); }
	};
	let result!: Result, failed = false, primary: unknown;
	try {
		result = await consume(withLutBytes);
	} catch (error) { failed = true; primary = error; }
	accepting = false;
	await joined;
	if (failed) {
		if (resourceFailed && resourceFailure !== primary) throw new AggregateError([primary, resourceFailure], 'Image handoff consumer and resource read failed.', { cause: primary });
		throw primary;
	}
	if (resourceFailed) throw resourceFailure;
	check(signal); return result;

}
