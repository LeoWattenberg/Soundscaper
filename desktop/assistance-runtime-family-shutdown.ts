/* SPDX-License-Identifier: AGPL-3.0-only */

/** Owns every asynchronous edge that can outlive a runtime-family shutdown request. */

export class AssistanceRuntimeFamilyShutdownBarrier {
	readonly #admissions = new Map<Promise<unknown>, AbortController>();
	readonly #retirements = new Set<Promise<void>>();
	readonly #retirementFailures: unknown[] = [];
	#shutdown: Promise<void> | null = null;

	trackAdmission<T>(work: Promise<T>, controller: AbortController): Promise<T> {
		const tracked = work.finally(() => this.#admissions.delete(tracked));
		this.#admissions.set(tracked, controller);
		return tracked;
	}

	trackRetirement(work: Promise<void>): void {
		const tracked = work.catch((error: unknown) => { this.#retirementFailures.push(error); })
			.finally(() => this.#retirements.delete(tracked));
		this.#retirements.add(tracked);
	}

	abortAdmissions(): void {
		for (const controller of this.#admissions.values()) controller.abort();
	}

	shutdown(
		stops: readonly (() => void | Promise<void>)[],
		isExpectedAdmissionFailure: (error: unknown) => boolean,
	): Promise<void> {
		if (this.#shutdown) return this.#shutdown;
		this.abortAdmissions();
		const admissions = [...this.#admissions.keys()];
		const retirements = [...this.#retirements];
		const stopTasks = stops.map((stop) => Promise.resolve().then(stop));
		this.#shutdown = Promise.allSettled([...stopTasks, ...admissions, ...retirements]).then((results) => {
			const failures = [...this.#retirementFailures];
			for (const [index, result] of results.entries()) {
				if (result.status === 'fulfilled') continue;
				const admission = index >= stopTasks.length && index < stopTasks.length + admissions.length;
				if (!admission || !isExpectedAdmissionFailure(result.reason)) failures.push(result.reason);
			}
			if (failures.length) throw new AggregateError(failures,
				'Runtime-family helpers did not all complete graceful shutdown.');
		});
		return this.#shutdown;
	}
}
