/* SPDX-License-Identifier: AGPL-3.0-only */

const LISTENERS = new WeakMap<object, Map<object, () => void>>();

/** Explicit seek/scrub invalidation, separate from continuous position telemetry.
 * Subscribers synchronously revoke their frame epoch and own the asynchronous
 * retirement join. This adds no engine prototype method or persisted state. */
export function subscribeEnginePlayheadDiscontinuity(engine: object, listener: () => void): () => void {
	if (typeof listener !== 'function') throw new TypeError('A playhead invalidation callback is required.');
	let listeners = LISTENERS.get(engine);
	if (!listeners) { listeners = new Map(); LISTENERS.set(engine, listeners); }
	const binding = {}; listeners.set(binding, listener);
	return () => { listeners.delete(binding); if (listeners.size === 0 && LISTENERS.get(engine) === listeners) LISTENERS.delete(engine); };
}

/** Internal transport entry point. Ordinary ticker/loop clock reports never
 * invoke this notification. Registered framework callbacks must not throw. */
export function invalidateEnginePlayhead(engine: object): void {
	const listeners = LISTENERS.get(engine);
	if (listeners) for (const listener of [...listeners.values()]) listener();
}
