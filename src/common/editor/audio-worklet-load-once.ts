/* SPDX-License-Identifier: AGPL-3.0-only */

export interface AudioWorkletLoadOnce {
	readonly isLoaded: (context: BaseAudioContext) => boolean;
	readonly ensure: (context: BaseAudioContext) => Promise<void>;
}

/** Own one retryable, coalesced AudioWorklet module load for each context. */
export function createAudioWorkletLoadOnce(
	load: (context: BaseAudioContext) => PromiseLike<void> | void,
): AudioWorkletLoadOnce {
	const loadedContexts = new WeakSet<BaseAudioContext>();
	const pendingLoads = new WeakMap<BaseAudioContext, Promise<void>>();

	const isLoaded = (context: BaseAudioContext): boolean => loadedContexts.has(context);
	const ensure = async (context: BaseAudioContext): Promise<void> => {
		if (loadedContexts.has(context)) return;
		let pending = pendingLoads.get(context);
		if (!pending) {
			try {
				pending = Promise.resolve(load(context)).then(() => { loadedContexts.add(context); });
			} catch (error) {
				pending = Promise.reject(error);
			}
			pendingLoads.set(context, pending);
		}
		try {
			await pending;
		} finally {
			if (pendingLoads.get(context) === pending) pendingLoads.delete(context);
		}
	};

	return Object.freeze({ isLoaded, ensure });
}
