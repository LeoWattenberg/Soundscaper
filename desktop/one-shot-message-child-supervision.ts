/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact ready/job/terminal/clean-exit supervision for disposable message children. */

export interface OneShotMessageChild {
	postMessage(message: unknown): void;
	onMessage(listener: (message: unknown) => void): () => void;
	onExit(listener: (code: number | null) => void): () => void;
	kill(): void;
}

export type OneShotMessageChildResult<Result, Failure> =
	| Readonly<{ readonly status: 'complete'; readonly result: Result }>
	| Readonly<{ readonly status: 'failed'; readonly reason: Failure }>;

export function superviseOneShotMessageChild<Result, Failure>(options: Readonly<{
	readonly child: OneShotMessageChild;
	readonly signal?: AbortSignal;
	readonly maximumDurationMs: number;
	readonly killWaitMs: number;
	readonly inspectReady: (message: unknown) => void;
	readonly createJob: () => unknown;
	readonly inspectTerminal: (message: unknown) => Result;
	readonly inspectionFailure: (error: unknown) => Failure;
	readonly cancelledFailure: Failure;
	readonly crashedFailure: Failure;
	readonly timeoutFailure: Failure;
}>): Promise<OneShotMessageChildResult<Result, Failure>> {
	return new Promise((resolve) => {
		let phase: 'ready' | 'running' | 'terminal' = 'ready';
		let terminal: Result | undefined;
		let stopping: Failure | undefined;
		let settled = false;
		let killTimer: ReturnType<typeof setTimeout> | undefined;
		const durationTimer = setTimeout(() => stop(options.timeoutFailure), options.maximumDurationMs);
		const removeMessage = options.child.onMessage(onMessage);
		const removeExit = options.child.onExit(onExit);
		const onAbort = (): void => stop(options.cancelledFailure);
		options.signal?.addEventListener('abort', onAbort, { once: true });
		if (options.signal?.aborted) onAbort();

		function onMessage(value: unknown): void {
			if (settled || stopping !== undefined) return;
			try {
				if (phase === 'ready') {
					options.inspectReady(value);
					phase = 'running';
					options.child.postMessage(options.createJob());
					return;
				}
				if (phase !== 'running') throw new TypeError('Duplicate terminal child message.');
				terminal = options.inspectTerminal(value);
				phase = 'terminal';
			} catch (error) {
				stop(options.inspectionFailure(error));
			}
		}

		function onExit(code: number | null): void {
			if (settled) return;
			if (stopping !== undefined) {
				finish(Object.freeze({ status: 'failed', reason: stopping }));
				return;
			}
			if (phase === 'terminal' && terminal !== undefined && code === 0) {
				finish(Object.freeze({ status: 'complete', result: terminal }));
				return;
			}
			finish(Object.freeze({ status: 'failed', reason: options.crashedFailure }));
		}

		function stop(reason: Failure): void {
			if (settled || stopping !== undefined) return;
			stopping = reason;
			try { options.child.kill(); }
			catch {
				finish(Object.freeze({ status: 'failed', reason }));
				return;
			}
			killTimer = setTimeout(() => {
				finish(Object.freeze({ status: 'failed', reason }));
			}, options.killWaitMs);
		}

		function finish(result: OneShotMessageChildResult<Result, Failure>): void {
			if (settled) return;
			settled = true;
			clearTimeout(durationTimer);
			if (killTimer !== undefined) clearTimeout(killTimer);
			options.signal?.removeEventListener('abort', onAbort);
			removeMessage();
			removeExit();
			resolve(result);
		}
	});
}
