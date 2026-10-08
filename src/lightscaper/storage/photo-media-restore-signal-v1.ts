/* SPDX-License-Identifier: AGPL-3.0-only */

const Controller = AbortController, prototype = AbortSignal.prototype, nativeThrow = prototype.throwIfAborted;
const aborted = Object.getOwnPropertyDescriptor(prototype, 'aborted')!.get!;
const reason = Object.getOwnPropertyDescriptor(prototype, 'reason')!.get!;
const abort = AbortController.prototype.abort, add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;

export function assertMediaRestoreSignalV1(value: unknown): asserts value is AbortSignal {
	if (typeof value !== 'object' || value === null) throw new TypeError('Restore requires a native cancellation signal.');
	Reflect.apply(nativeThrow, value, []);
	if (Object.getPrototypeOf(value) !== prototype || ['aborted', 'reason', 'throwIfAborted', 'addEventListener', 'removeEventListener'].some(key => Object.hasOwn(value, key))) {
		throw new TypeError('Restore requires native cancellation behavior.');
	}
}
export function checkMediaRestoreSignalV1(signal?: AbortSignal): void { if (signal) Reflect.apply(nativeThrow, signal, []); }
export function mediaRestoreCancellationV1(error: unknown, signal: AbortSignal): boolean {
	return Reflect.apply(aborted, signal, []) === true && Object.is(error, Reflect.apply(reason, signal, []));
}
export function forwardMediaRestoreSignalV1(external?: AbortSignal) {
	const controller = new Controller(), forward = (): void => { Reflect.apply(abort, controller, [Reflect.apply(reason, external!, [])]); };
	if (external) { Reflect.apply(add, external, ['abort', forward, { once: true }]); if (Reflect.apply(aborted, external, []) === true) forward(); }
	return { signal: controller.signal, abort: () => { Reflect.apply(abort, controller, [new DOMException('Media restore was closed.', 'AbortError')]); },
		detach: () => { if (external) Reflect.apply(remove, external, ['abort', forward]); } };
}
