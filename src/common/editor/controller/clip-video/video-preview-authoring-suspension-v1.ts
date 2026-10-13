/* SPDX-License-Identifier: AGPL-3.0-only */

interface State {
	paused: boolean;
	epoch: number;
	readonly listeners: Set<() => void>;
	readonly participants: Set<() => Promise<void>>;
}
const STATES = new WeakMap<object, State>(), CHECK = AbortSignal.prototype.throwIfAborted;
function state(owner: object): State {
	let value = STATES.get(owner);
	if (!value) { value = { paused: false, epoch: 0, listeners: new Set(), participants: new Set() }; STATES.set(owner, value); }
	return value;
}
function publish(value: State): unknown[] {
	value.epoch++; const errors: unknown[] = [];
	for (const listener of value.listeners) try { listener(); } catch (error) { if (!errors.some(value => Object.is(value, error))) errors.push(error); }
	return errors;
}
function refuse(errors: readonly unknown[]): void {
	if (errors.length === 1) throw errors[0];
	if (errors.length) throw new AggregateError(errors, 'Accepted preview retirement failed.', { cause: errors[0] });
}
export function videoPreviewAuthoringEpochV1(owner: object): number { return state(owner).epoch; }
export function videoPreviewAuthoringPausedV1(owner: object): boolean { return state(owner).paused; }
export function subscribeVideoPreviewAuthoringV1(owner: object, listener: () => void): () => void {
	const value = state(owner); value.listeners.add(listener); return () => { value.listeners.delete(listener); };
}
/** A participant closes the real accepted factory, rendering and native session. */
export function registerVideoPreviewAuthoringParticipantV1(owner: object, join: () => Promise<void>): () => void {
	if (typeof join !== 'function') throw new TypeError('Preview suspension requires a joined retirement.');
	const value = state(owner); value.participants.add(join); return () => { value.participants.delete(join); };
}
/** Pause synchronously; no Original borrower enters until every accepted
 * preview factory and rendering barrier has actually joined. */
export async function suspendVideoPreviewForAuthoringV1(owner: object, signal?: AbortSignal): Promise<Readonly<{ release(): void }>> {
	if (signal !== undefined) Reflect.apply(CHECK, signal, []);
	const value = state(owner);
	if (value.paused) throw new Error('A selected-image authoring scope is already open.');
	value.paused = true;
	let released = false;
	const release = () => { if (released) return; released = true; value.paused = false; refuse(publish(value)); };
	// Capture participants before synchronous subscribers retire their effects.
	const joins = [...value.participants];
	try {
		const errors = publish(value);
		const work = joins.map(join => { try { return Promise.resolve(join()); } catch (error) { return Promise.reject(error); } });
		const outcomes = await Promise.allSettled(work);
		for (const outcome of outcomes) if (outcome.status === 'rejected' && !errors.some(error => Object.is(error, outcome.reason))) errors.push(outcome.reason as unknown);
		refuse(errors);
		if (signal !== undefined) Reflect.apply(CHECK, signal, []);
		return Object.freeze({ release });
	} catch (error) {
		let failure: { error: unknown } | undefined;
		try { release(); } catch (retirement) { if (!Object.is(error, retirement)) failure = { error: retirement }; }
		if (failure) throw new AggregateError([error, failure.error], 'Preview suspension and release failed.', { cause: error });
		throw error;
	}
}
