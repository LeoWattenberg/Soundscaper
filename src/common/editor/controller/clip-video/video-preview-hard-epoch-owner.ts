/* SPDX-License-Identifier: AGPL-3.0-only */

interface ExactRetirementPort {
	supersede(): PromiseLike<void> | void;
	retire(): PromiseLike<void> | void;
}

/** Clock demand remains in the continuous coordinator. Explicit resource,
 * viewport/project replacement or seek closes admission synchronously, joins
 * the actual frame, then requests only the latest hard epoch. */
export function createVideoPreviewHardEpochOwner(port: ExactRetirementPort, requestLatest: () => void) {
	const supersedePort = port.supersede, retirePort = port.retire;
	if (typeof supersedePort !== 'function' || typeof retirePort !== 'function' || typeof requestLatest !== 'function') {
		throw new TypeError('Exact preview retirement capabilities are required.');
	}
	let epoch: object = {}, readyEpoch = epoch, blocked = false, retired = false, drain = Promise.resolve(), retirement: Promise<void> | undefined;
	let failure: Readonly<{ value: unknown }> | undefined;
	const failures: unknown[] = [];
	function record(error: unknown): void {
		if (!failures.some(value => Object.is(value, error))) failures.push(error);
		failure = { value: failures.length === 1 ? failures[0] : new AggregateError([...failures], 'Exact preview retirement failed.') };
	}
	function check(): void { if (failure) throw failure.value; }
	function start(method: ExactRetirementPort['supersede'], terminal: boolean): Promise<void> {
		const ticket = {}, predecessor = drain; epoch = ticket; blocked = true;
		let resolve!: () => void, reject!: (error: unknown) => void;
		const result = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
		drain = result.then(() => undefined, () => undefined);
		void result.catch(() => undefined);
		if (terminal) retirement = result;
		// The owned barrier is installed before native cancellation/host reentry.
		let operation: Promise<void>;
		try { operation = Promise.resolve(Reflect.apply(method, port, []) as PromiseLike<void> | void); }
		catch (error) { record(error); operation = Promise.resolve(); }
		void operation.catch(() => undefined);
		void (async () => {
			const outcomes = await Promise.allSettled([predecessor, operation]);
			for (const outcome of outcomes) if (outcome.status === 'rejected') record(outcome.reason);
			check();
			if (!terminal && !retired && epoch === ticket) readyEpoch = ticket;
		})().then(resolve, (error: unknown) => { if (!failure || !Object.is(failure.value, error)) record(error); reject(failure!.value); });
		return result;
	}
	function supersede(): Promise<void> {
		if (retirement) return retirement;
		if (failure) return Promise.reject(failure.value);
		return start(supersedePort, false);
	}
	function retire(): Promise<void> {
		if (retirement) return retirement;
		retired = true;
		return start(retirePort, true);
	}
	/** Only the host that has joined and installed its replacement resumes it.
	 * No synchronous redraw can cross the hard retirement promise itself. */
	function resume(): boolean {
		if (retired || failure || readyEpoch !== epoch) return false;
		blocked = false;
		try { requestLatest(); } catch (error) { record(error); throw error; }
		return !retired && !failure && readyEpoch === epoch;
	}
	return Object.freeze({ supersede, retire, resume, mayRender: () => !blocked && !retired && !failure,
		join: async () => { await drain; check(); } });
}
