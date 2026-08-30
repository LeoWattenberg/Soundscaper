/* SPDX-License-Identifier: AGPL-3.0-only */

/** Tracks ownership-establishing operations so teardown can snapshot after they settle. */
export function createSoundscaperNativeRendererOperationBarrier() {
	const pending = new Set<Promise<unknown>>();

	const track = <Value>(operation: Promise<Value>): Promise<Value> => {
		pending.add(operation);
		const settled = (): void => { pending.delete(operation); };
		void operation.then(settled, settled);
		return operation;
	};

	return Object.freeze({
		track,
		wrap<Arguments extends unknown[], Value>(
			operation: (...args: Arguments) => Promise<Value>,
		): (...args: Arguments) => Promise<Value> {
			return (...args) => track(operation(...args));
		},
		async settle(): Promise<void> {
			while (pending.size > 0) await Promise.allSettled([...pending]);
		},
	});
}
