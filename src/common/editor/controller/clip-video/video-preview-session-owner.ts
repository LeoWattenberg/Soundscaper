/* SPDX-License-Identifier: AGPL-3.0-only */

interface RetirableSession { dispose(): void; close?(): Promise<void> }

/** A current preview factory and its late result remain in one serial lifetime.
 * Replacement revokes publication synchronously, then joins actual factory,
 * frame/target retirement and the hard epoch barrier before opening a factory.
 * Cleanup failure is sticky; ordinary factory failure belongs to that request. */
export function createVideoPreviewSessionOwner<Session extends RetirableSession>(
	publish: (session: Session | null) => void,
	beforeReplace: () => PromiseLike<void> | void = () => undefined,
) {
	if (typeof publish !== 'function' || typeof beforeReplace !== 'function') throw new TypeError('Preview lifetime callbacks are required.');
	let epoch: object = {}, sealed = false;
	let current: Session | null = null, drain = Promise.resolve();
	let failure: Readonly<{ value: unknown }> | undefined, closing: Promise<void> | undefined;
	let activeStop: AbortController | undefined;
	const failures: unknown[] = [];
	const markFailure = (error: unknown) => {
		if (!failures.some(value => Object.is(value, error))) failures.push(error);
		failure = { value: failures.length === 1 ? failures[0] : new AggregateError([...failures], 'Preview session retirement failed.') };
	};
	const checkFailure = () => { if (failure) throw failure.value; };
	function retire(session: Session | null): Promise<void> {
		if (!session) return Promise.resolve();
		try {
			const close = session.close, dispose = session.dispose;
			const work = typeof close === 'function' ? Reflect.apply(close, session, []) : Reflect.apply(dispose, session, []);
			return Promise.resolve(work).then(() => undefined, (error: unknown) => { markFailure(error); throw error; });
		} catch (error) { markFailure(error); return Promise.reject(error); }
	}
	function startBarrier(): Promise<void> {
		try {
			return Promise.resolve(beforeReplace()).then(() => undefined, (error: unknown) => { markFailure(error); });
		} catch (error) { markFailure(error); return Promise.resolve(); }
	}
	async function joinRetirement(retirement: Promise<void>, barrier: Promise<void>): Promise<void> {
		await Promise.allSettled([retirement, barrier]);
		checkFailure();
	}
	function replace(create: ((signal: AbortSignal) => PromiseLike<Session | null> | Session | null) | null): Promise<Session | null> {
		if (sealed) return Promise.reject(new Error('The preview session owner is retired.'));
		if (failure) return Promise.reject(failure.value);
		if (create !== null && typeof create !== 'function') return Promise.reject(new TypeError('A preview factory is required.'));
		const ticket = {}, predecessor = drain, previous = current, previousStop = activeStop;
		epoch = ticket; current = null;
		let resolve!: (session: Session | null) => void, reject!: (error: unknown) => void;
		const result = new Promise<Session | null>((yes, no) => { resolve = yes; reject = no; });
		drain = result.then(() => undefined, () => undefined);
		void result.catch(() => undefined);
		const stop = new AbortController(); activeStop = stop;
		// Admission and drain are installed before the hard barrier revokes
		// frame publication; its cancellation must win before Session abort.
		const barrier = startBarrier();
		previousStop?.abort();
		let clearing: Readonly<{ error: unknown }> | undefined;
		try { publish(null); } catch (error) { clearing = { error }; markFailure(error); }
		const retirement = retire(previous); void retirement.catch(() => undefined);
		void (async () => {
			await predecessor;
			await joinRetirement(retirement, barrier);
			if (clearing) throw clearing.error;
			if (sealed || epoch !== ticket) return null;
			if (!create) return null;
			const session = await create(stop.signal);
			if (sealed || epoch !== ticket) { await retire(session); return null; }
			current = session;
			try { publish(session); } catch (error) { current = null; await retire(session); throw error; }
			return sealed || epoch !== ticket || current !== session ? null : session;
		})().then(resolve, reject);
		return result;
	}
	function close(): Promise<void> {
		if (closing) return closing;
		sealed = true; epoch = {};
		const predecessor = drain, previous = current; current = null;
		let resolve!: () => void, reject!: (error: unknown) => void;
		closing = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
		void closing.catch(() => undefined);
		const barrier = startBarrier();
		activeStop?.abort();
		try { publish(null); } catch (error) { markFailure(error); }
		const retirement = retire(previous); void retirement.catch(() => undefined);
		void (async () => {
			await predecessor;
			await joinRetirement(retirement, barrier);
		})().then(resolve, reject);
		return closing;
	}
	return Object.freeze({ replace, close });
}
