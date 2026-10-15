/* SPDX-License-Identifier: AGPL-3.0-only */

const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const FILL = Uint8Array.prototype.fill;

/** Current multistage pipeline owns at most its scalar planned live bytes.
 * Physical allocation geometry remains private even when delivered views gain
 * hostile shadows. Replaced stages retire immediately, final work joins first. */
export class LinearDevelopOwnerV1 {
	readonly #backings = new Map<ArrayBuffer, number>();
	#liveBytes = 0;
	constructor(readonly borrowedBytes: number, readonly maximumBytes: number) {}
	floats(length: number): Float32Array<ArrayBuffer> { this.#admit(length * 4); const values = new Float32Array(length); this.#own(values.buffer); return values; }
	bytes(length: number): Uint8Array<ArrayBuffer> { this.#admit(length); const values = new Uint8Array(length); this.#own(values.buffer); return values; }
	#own(buffer: ArrayBuffer): void { const size = Number(Reflect.apply(SIZE, buffer, [])); this.#backings.set(buffer, size); this.#liveBytes += size; }
	#admit(length: number): void {
		if (!Number.isSafeInteger(length) || length < 0 || this.borrowedBytes + this.#liveBytes + length > this.maximumBytes) throw new RangeError('Current linear Develop exceeds its planned working byte budget.');
	}
	retire(buffer: ArrayBuffer): void {
		const length = this.#backings.get(buffer); if (length === undefined) throw new TypeError('Linear backing has no current owner.');
		this.#backings.delete(buffer); this.#liveBytes -= length;
		if (Reflect.apply(SIZE, buffer, []) !== length) throw new TypeError('Current linear backing was detached or changed before physical retirement.');
		Reflect.apply(FILL, new Uint8Array(buffer), [0]);
	}
	async run<Result>(work: () => Result | Promise<Result>): Promise<Result> {
		let outcome: { value: Result } | { error: unknown };
		try { outcome = { value: await work() }; } catch (error) { outcome = { error }; }
		const failures: unknown[] = 'error' in outcome ? [outcome.error] : [];
		for (const buffer of this.#backings.keys()) try { this.retire(buffer); } catch (error) { if (!failures.some(reason => Object.is(reason, error))) failures.push(error); }
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) throw new AggregateError(failures, 'Current linear operation and physical retirement failed.', { cause: failures[0] });
		if ('value' in outcome) return outcome.value; throw new Error('Current linear operation has no outcome.');
	}
}
