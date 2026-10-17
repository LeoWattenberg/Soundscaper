/* SPDX-License-Identifier: AGPL-3.0-only */

const nativeSignalPrototype = AbortSignal.prototype;
const nativeThrowIfAborted = nativeSignalPrototype.throwIfAborted;
const nativeAborted = Object.getOwnPropertyDescriptor(nativeSignalPrototype, 'aborted')!.get!;
const nativeReason = Object.getOwnPropertyDescriptor(nativeSignalPrototype, 'reason')!.get!;
const nativeAddListener = EventTarget.prototype.addEventListener;
const nativeRemoveListener = EventTarget.prototype.removeEventListener;
const NativeAbortController = AbortController;
const nativeAbort = NativeAbortController.prototype.abort;
const overriddenBehavior = ['aborted', 'reason', 'throwIfAborted', 'addEventListener', 'removeEventListener'] as const;

/** Native abort reasons take precedence; caller-owned accessors are never evaluated. */
export function assertPhotoStackQuerySignalV1(value: unknown): asserts value is AbortSignal {
	if (typeof value !== 'object' || value === null) throw new TypeError('Collapsed queries require a native cancellation signal.');
	Reflect.apply(nativeThrowIfAborted, value, []);
	if (Object.getPrototypeOf(value) !== nativeSignalPrototype || overriddenBehavior.some(key => Object.hasOwn(value, key))) {
		throw new TypeError('Collapsed queries require native cancellation behavior without overrides.');
	}
}

/**
 * Only the private signal reaches a borrowed transaction owner. Cancellation
 * propagates immediately, while settlement and cleanup remain joined to run.
 */
export async function withPhotoStackQuerySignalV1<Result>(signal: AbortSignal | undefined,
	run: (privateSignal: AbortSignal | undefined) => Promise<Result>): Promise<Result> {
	if (signal === undefined) return await run(undefined);
	assertPhotoStackQuerySignalV1(signal);
	const stop = new NativeAbortController();
	const forward = (): void => {
		const reason: unknown = Reflect.apply(nativeReason, signal, []);
		Reflect.apply(nativeAbort, stop, [reason]);
	};
	let subscribed = false;
	try {
		Reflect.apply(nativeAddListener, signal, ['abort', forward, { once: true }]); subscribed = true;
		if (Reflect.apply(nativeAborted, signal, []) === true) forward();
		assertPhotoStackQuerySignalV1(signal);
		const result = await run(stop.signal);
		assertPhotoStackQuerySignalV1(signal);
		return result;
	} finally {
		if (subscribed) Reflect.apply(nativeRemoveListener, signal, ['abort', forward]);
	}
}
