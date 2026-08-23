/* SPDX-License-Identifier: AGPL-3.0-only */

/** Fences new session work while letting every already-admitted operation settle. */
export class DesktopProjectLibrarySessionAdmission {
	readonly #label: string;
	readonly #operations = new Set<Promise<unknown>>();
	#open = true;
	#closePromise: Promise<void> | null = null;

	constructor(label: string) { this.#label = label; }

	assertOpen(): void {
		if (!this.#open) throw new Error(`${this.#label} main session is closed`);
	}

	run<Result>(operation: () => Promise<Result>): Promise<Result> {
		this.assertOpen();
		const admitted = Promise.resolve().then(operation);
		this.#operations.add(admitted);
		const retire = () => { this.#operations.delete(admitted); };
		void admitted.then(retire, retire);
		return admitted;
	}

	close(operation: () => Promise<void>): Promise<void> {
		if (this.#closePromise) return this.#closePromise;
		this.#open = false;
		this.#closePromise = this.#drain(operation);
		return this.#closePromise;
	}

	async #drain(operation: () => Promise<void>): Promise<void> {
		await Promise.allSettled([...this.#operations]);
		await operation();
	}
}
