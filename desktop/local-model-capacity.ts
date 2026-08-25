/* SPDX-License-Identifier: AGPL-3.0-only */

/** Point-in-time filesystem admission for optional local-model writes. */

import { statfs } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

export type LocalModelStatfs = (
	path: string,
	options: Readonly<{ bigint: true }>,
) => PromiseLike<unknown> | unknown;

export interface LocalModelCapacityOptions {
	readonly statfsImpl?: LocalModelStatfs;
}

export interface LocalModelCapacityReservation {
	readonly byteLength: number;
	readonly remainingBytes: number;
	/** Marks bytes now reflected by statfs rather than merely reserved. */
	consume(byteLength: number): number;
	release(): boolean;
}

interface ActiveReservation {
	readonly rootPath: string;
	readonly byteLength: number;
	remainingBytes: number;
	released: boolean;
}

function assertByteLength(value: number): number {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new RangeError('A local-model capacity reservation needs a safe non-negative integer byte length.');
	}
	return value;
}

function assertRootPath(value: string): string {
	if (typeof value !== 'string' || !isAbsolute(value)) {
		throw new TypeError('A local-model capacity destination must be absolute.');
	}
	return resolve(value);
}

export function availableLocalModelStorageBytes(details: unknown): bigint {
	if (!details || typeof details !== 'object') {
		throw new TypeError('Expected local-model filesystem capacity details.');
	}
	const record = details as Readonly<Record<string, unknown>>;
	if (typeof record.bavail !== 'bigint' || record.bavail < 0n
		|| typeof record.bsize !== 'bigint' || record.bsize <= 0n) {
		throw new TypeError('Expected non-negative bigint bavail and positive bigint bsize values.');
	}
	return record.bavail * record.bsize;
}

/**
 * Accounts for every in-flight write reservation sharing one configured root.
 * A caller consumes a reservation as writes land because a later statfs call
 * already observes those bytes; the unconsumed portion remains prospective.
 */
export class LocalModelCapacity {
	readonly #active = new Set<ActiveReservation>();
	readonly #statfs: LocalModelStatfs;
	readonly #reservedByRoot = new Map<string, number>();

	constructor(options: LocalModelCapacityOptions = {}) {
		this.#statfs = options.statfsImpl ?? statfs;
	}

	async reserve(rootValue: string, byteLengthValue: number): Promise<LocalModelCapacityReservation> {
		const rootPath = assertRootPath(rootValue);
		const byteLength = assertByteLength(byteLengthValue);
		const prospectiveBytes = (this.#reservedByRoot.get(rootPath) ?? 0) + byteLength;
		if (!Number.isSafeInteger(prospectiveBytes)) {
			throw new RangeError('Aggregate local-model capacity reservations exceed the safe byte domain.');
		}
		const state: ActiveReservation = {
			rootPath, byteLength, remainingBytes: byteLength, released: false,
		};
		this.#active.add(state);
		this.#reservedByRoot.set(rootPath, prospectiveBytes);
		const reservation = this.#reservation(state);
		try {
			let details: unknown;
			try {
				details = await this.#statfs(rootPath, { bigint: true });
			} catch (error) {
				throw new Error('Could not inspect filesystem capacity for local models.', { cause: error });
			}
			let availableBytes: bigint;
			try {
				availableBytes = availableLocalModelStorageBytes(details);
			} catch (error) {
				throw new Error('Local-model filesystem capacity information is invalid.', { cause: error });
			}
			if (availableBytes < BigInt(prospectiveBytes)) {
				throw new RangeError('Available disk space is below the aggregate local model reservation.');
			}
			return reservation;
		} catch (error) {
			reservation.release();
			throw error;
		}
	}

	#reservation(state: ActiveReservation): LocalModelCapacityReservation {
		return Object.freeze({
			byteLength: state.byteLength,
			get remainingBytes() { return state.remainingBytes; },
			consume: (byteLength: number) => this.#consume(state, byteLength),
			release: () => this.#release(state),
		});
	}

	#consume(state: ActiveReservation, byteLengthValue: number): number {
		const byteLength = assertByteLength(byteLengthValue);
		if (state.released) throw new Error('A released local-model reservation cannot be consumed.');
		if (byteLength > state.remainingBytes) {
			throw new RangeError('Consumed local-model bytes exceed the reservation\'s remaining bytes.');
		}
		state.remainingBytes -= byteLength;
		this.#setReserved(state.rootPath, (this.#reservedByRoot.get(state.rootPath) ?? 0) - byteLength);
		return state.remainingBytes;
	}

	#release(state: ActiveReservation): boolean {
		if (state.released) return false;
		state.released = true;
		if (!this.#active.delete(state)) return false;
		this.#setReserved(
			state.rootPath,
			(this.#reservedByRoot.get(state.rootPath) ?? 0) - state.remainingBytes,
		);
		state.remainingBytes = 0;
		return true;
	}

	#setReserved(rootPath: string, value: number): void {
		if (value > 0) this.#reservedByRoot.set(rootPath, value);
		else this.#reservedByRoot.delete(rootPath);
	}
}
