/* SPDX-License-Identifier: AGPL-3.0-only */

export class Aup4WorkerRequestState {
	readonly #pending = new Set<string>();
	readonly #cancelled = new Set<string>();

	begin(id: string): void {
		this.#pending.add(id);
	}

	cancel(id: string): void {
		if (this.#pending.has(id)) this.#cancelled.add(id);
	}

	isCancelled(id: string): boolean {
		return this.#cancelled.has(id);
	}

	finish(id: string): void {
		this.#pending.delete(id);
		this.#cancelled.delete(id);
	}
}
