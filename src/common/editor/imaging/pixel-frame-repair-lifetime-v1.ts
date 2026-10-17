/* SPDX-License-Identifier: AGPL-3.0-only */

import { IMAGE_DEVELOP_REPAIR_LIMITS_V1 } from './image-develop-repair-spots-v1.ts';

const NativeBytes = Uint8Array, NativeFloats = Float64Array;
const TYPED = Object.getPrototypeOf(NativeBytes.prototype) as object;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!;
const OFFSET = Object.getOwnPropertyDescriptor(TYPED, 'byteOffset')!.get!;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const SET = NativeBytes.prototype.set, FILL = NativeBytes.prototype.fill;
const CHECK = AbortSignal.prototype.throwIfAborted, SIGNAL_PROTOTYPE = AbortSignal.prototype;

/** Capture cancellation without consulting caller-owned signal methods. */
export function captureRepairSignalV1(value: unknown): AbortSignal | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== 'object' || value === null) throw new TypeError('Repair requires a native cancellation signal.');
	Reflect.apply(CHECK, value, []);
	if (Object.getPrototypeOf(value) !== SIGNAL_PROTOTYPE
		|| ['aborted', 'reason', 'throwIfAborted', 'addEventListener', 'removeEventListener'].some(key => Object.hasOwn(value, key))) {
		throw new TypeError('Repair cancellation may not shadow native behavior.');
	}
	return value as AbortSignal;
}

export function checkRepairSignalV1(signal: AbortSignal | undefined): void {
	if (signal !== undefined) Reflect.apply(CHECK, signal, []);
}

/** Small private ownership register. Delivered views never own wipe geometry. */
export class RepairPixelFrameLifetimeV1 {
	readonly #backings: { readonly buffer: ArrayBuffer; readonly length: number }[] = [];

	bytes(length: number): Uint8Array<ArrayBuffer> {
		const bytes = new NativeBytes(length); this.#own(bytes); return bytes;
	}
	floats(length: number): Float64Array<ArrayBuffer> {
		const values = new NativeFloats(length); this.#own(values); return values;
	}
	copy(source: Uint8Array<ArrayBuffer> | Uint8ClampedArray<ArrayBuffer>, length: number): Uint8Array<ArrayBuffer> {
		const bytes = this.bytes(length), backing = Reflect.apply(BUFFER, source, []) as ArrayBuffer;
		const offset = Number(Reflect.apply(OFFSET, source, []));
		Reflect.apply(SET, bytes, [new NativeBytes(backing, offset, length)]); return bytes;
	}
	#own(value: Uint8Array<ArrayBuffer> | Float64Array<ArrayBuffer>): void {
		const buffer = Reflect.apply(BUFFER, value, []) as ArrayBuffer;
		this.#backings.push({ buffer, length: Number(Reflect.apply(SIZE, buffer, [])) });
	}
	retire(): readonly unknown[] {
		const failures: unknown[] = [];
		for (const { buffer, length } of this.#backings) {
			try {
				if (Reflect.apply(SIZE, buffer, []) !== length) {
					throw new TypeError('Repair backing was detached or changed; native wipe retirement cannot be certified.');
				}
				Reflect.apply(FILL, new NativeBytes(buffer), [0]);
			} catch (error) { if (!failures.some(reason => Object.is(reason, error))) failures.push(error); }
		}
		this.#backings.length = 0; return failures;
	}
}

/** Join the operation before native cleanup, preserving every distinct failure. */
export async function withRepairPixelFrameLifetimeV1<Result>(
	work: (owner: RepairPixelFrameLifetimeV1) => Result | Promise<Result>,
): Promise<Result> {
	const owner = new RepairPixelFrameLifetimeV1();
	let outcome: { readonly value: Result } | { readonly error: unknown };
	try { outcome = { value: await work(owner) }; } catch (error) { outcome = { error }; }
	const failures: unknown[] = 'error' in outcome ? [outcome.error] : [];
	for (const error of owner.retire()) if (!failures.some(reason => Object.is(reason, error))) failures.push(error);
	if (failures.length === 1) throw failures[0];
	if (failures.length > 1) throw new AggregateError(failures, 'Repair operation and native backing cleanup failed.', { cause: failures[0] });
	if ('value' in outcome) return outcome.value;
	throw new Error('Repair retirement has no operation outcome.');
}

/** Count pixel/cell visits across phases; every full chunk yields a real task. */
export class RepairTaskBudgetV1 {
	#operations = 0;
	constructor(readonly check: () => void) {}
	visit(): boolean {
		this.#operations++;
		if (this.#operations < IMAGE_DEVELOP_REPAIR_LIMITS_V1.maximumOperationsBeforeYield) return false;
		this.#operations = 0; return true;
	}
	async yield(): Promise<void> {
		this.check(); await new Promise<void>(resolve => { setTimeout(resolve, 0); }); this.check();
	}
}
