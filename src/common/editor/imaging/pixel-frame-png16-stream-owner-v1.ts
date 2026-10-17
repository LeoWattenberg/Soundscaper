/* SPDX-License-Identifier: AGPL-3.0-only */

const NativeBytes = Uint8Array;
const TYPED = Object.getPrototypeOf(NativeBytes.prototype) as object;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const RESIZABLE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')!.get!;
const FILL = NativeBytes.prototype.fill;

/** Saved allocation geometry survives mutable views and the codec's final
 * reset. This register owns only private row/output/codec storage; a borrowed
 * source backing can never enter it. Retirement attempts every allocation. */
export class Png16StreamOwnerV1 {
	readonly #backings = new Map<ArrayBuffer, Readonly<{ length: number; role: string }>>();
	constructor(readonly source: ArrayBuffer) {}
	bytes(length: number, role: string): Uint8Array<ArrayBuffer> {
		const bytes = new NativeBytes(length); this.capture(bytes.buffer, role); return bytes;
	}
	capture(buffer: ArrayBuffer, role: string): void {
		const length = Number(Reflect.apply(SIZE, buffer, []));
		if (buffer === this.source || Reflect.apply(RESIZABLE, buffer, []) !== false) throw new TypeError('PNG16 private storage cannot alias its borrowed source or resize.');
		if (length === 0) return;
		const previous = this.#backings.get(buffer);
		if (previous && previous.length !== length) throw new TypeError('PNG16 private allocation changed.');
		if (!previous) this.#backings.set(buffer, Object.freeze({ length, role }));
	}
	retire(buffer: ArrayBuffer): void {
		const allocation = this.#backings.get(buffer);
		if (!allocation) throw new TypeError('PNG16 backing has no active private owner.');
		this.#backings.delete(buffer);
		if (Reflect.apply(SIZE, buffer, []) !== allocation.length) throw new TypeError(`PNG16 ${allocation.role} backing was detached or changed before physical retirement.`);
		Reflect.apply(FILL, new NativeBytes(buffer), [0]);
	}
	retireAll(except?: ArrayBuffer): readonly unknown[] {
		const errors: unknown[] = [];
		for (const buffer of this.#backings.keys()) {
			if (buffer === except) continue;
			try { this.retire(buffer); } catch (error) { append(errors, error); }
		}
		return errors;
	}
	release(buffer: ArrayBuffer): void {
		if (!this.#backings.delete(buffer)) throw new TypeError('PNG16 completed output has no private owner.');
	}
	/** fflate0.8.3's pinned streaming Deflate retains b and optional s.p/s.h.
	 * Its final push replaces those fields; capture before push and in ondata.
	 * Synchronous per-call entropy arrays are library internals, not retained
	 * lifecycle allocations. Their bounded residency is in the codec reserve. */
	captureCodec(codec: object): void {
		const own = Object.getOwnPropertyDescriptors(codec), body: unknown = own.b?.value, state: unknown = own.s?.value;
		if (!own.b || !Object.hasOwn(own.b, 'value') || !own.s || !Object.hasOwn(own.s, 'value')
			|| !ArrayBuffer.isView(body) || !state || typeof state !== 'object') throw new TypeError('PNG16 requires the pinned streaming codec ownership layout.');
		this.capture(Reflect.apply(BUFFER, body, []) as ArrayBuffer, 'codec rolling');
		for (const name of ['p', 'h']) {
			const descriptor = Object.getOwnPropertyDescriptor(state, name); if (!descriptor) continue;
			const values: unknown = descriptor.value;
			if (!Object.hasOwn(descriptor, 'value') || !ArrayBuffer.isView(values)) throw new TypeError('PNG16 codec state is not an owned native plane.');
			this.capture(Reflect.apply(BUFFER, values, []) as ArrayBuffer, 'codec hash');
		}
	}
}

export function appendPng16FailureV1(errors: unknown[], error: unknown): void { append(errors, error); }
export function throwPng16FailuresV1(errors: readonly unknown[]): void {
	if (errors.length === 1) throw errors[0];
	if (errors.length) throw new AggregateError(errors, 'PNG16 operation and physical retirement failed.', { cause: errors[0] });
}
function append(errors: unknown[], error: unknown): void { if (!errors.some(value => Object.is(value, error))) errors.push(error); }
