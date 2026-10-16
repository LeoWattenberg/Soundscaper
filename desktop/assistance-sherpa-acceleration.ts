/* SPDX-License-Identifier: AGPL-3.0-only */

/** Native-call retry boundaries shared by every authenticated Sherpa model. */

export type SherpaExecutionProvider = 'coreml' | 'webgpu' | 'cpu';

export interface SherpaAccelerationOptions {
	/** Providers authenticated with the exact installed target closure. */
	readonly executionProviders?: readonly SherpaExecutionProvider[];
	/** Legacy explicit factory override; must belong to a supplied closure. */
	readonly provider?: string;
}

class SherpaNativeExecutionError extends Error {
	constructor(readonly nativeCause: unknown) {
		super('The native Sherpa operation failed.', { cause: nativeCause });
	}
}

/** Wrap native construction/inference only; validation and callbacks stay outside. */
export function callSherpaNativeV1<Value>(operation: () => Value): Value {
	try { return operation(); }
	catch (error) { throw new SherpaNativeExecutionError(error); }
}

export function createSherpaNativeExecutorV1(options: SherpaAccelerationOptions = {}) {
	const providers = executionProviders(options);
	let selected = 0;
	return Object.freeze({
		async run<Value>(
			signal: AbortSignal | undefined,
			operation: (provider: SherpaExecutionProvider) => Value | PromiseLike<Value>,
		): Promise<Value> {
			for (;;) {
				signal?.throwIfAborted();
				try {
					const result = await operation(providers[selected]!);
					signal?.throwIfAborted();
					return result;
				}
				catch (error) {
					signal?.throwIfAborted();
					if (!(error instanceof SherpaNativeExecutionError)) throw error;
					if (error.nativeCause instanceof Error && error.nativeCause.name === 'AbortError') throw error.nativeCause;
					if (selected === providers.length - 1) throw error.nativeCause;
					selected += 1;
				}
			}
		},
	});
}

/** Current upstream objects use finalizers; also support explicit release APIs. */
export function disposeSherpaNativeV1(value: Readonly<{ free?: () => void; dispose?: () => void }>): void {
	if (typeof value.free === 'function') value.free();
	else if (typeof value.dispose === 'function') value.dispose();
}

function executionProviders(options: SherpaAccelerationOptions): readonly SherpaExecutionProvider[] {
	const supplied = options.executionProviders;
	if (supplied !== undefined && (!Array.isArray(supplied) || supplied.length < 1 || supplied.length > 3
		|| !supplied.includes('cpu') || new Set(supplied).size !== supplied.length
		|| supplied.some((provider) => !isProvider(provider)))) {
		throw new TypeError('Sherpa execution providers must be supported and retain CPU fallback.');
	}
	if (options.provider !== undefined && (!isProvider(options.provider)
		|| supplied !== undefined && !supplied.includes(options.provider))) {
		throw new TypeError('The explicit Sherpa provider must belong to the authenticated runtime.');
	}
	if (options.provider !== undefined) return options.provider === 'cpu' ? ['cpu'] : [options.provider as SherpaExecutionProvider, 'cpu'];
	return Object.freeze([...(supplied ?? []).filter((provider) => provider !== 'cpu'), 'cpu']);
}

function isProvider(value: unknown): value is SherpaExecutionProvider {
	return value === 'cpu' || value === 'coreml' || value === 'webgpu';
}
