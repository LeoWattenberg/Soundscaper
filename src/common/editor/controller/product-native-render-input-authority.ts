/* SPDX-License-Identifier: AGPL-3.0-only */

/** A controller-owned immutable project and offline audio-render lease. */
export interface ProductNativeRenderInputOperation {
	readonly project: Readonly<Record<string, unknown>>;
	readonly signal: AbortSignal;
	assertCurrent(): void;
	renderAudio(
		project: Readonly<Record<string, unknown>>,
		range: Readonly<Record<string, unknown>>,
	): Promise<unknown>;
	renderAudioToSink?(
		project: Readonly<Record<string, unknown>>,
		range: Readonly<Record<string, unknown>>,
		sink: (
			channels: readonly Float32Array[],
			metadata: Readonly<{ readonly frameOffset?: number; readonly sampleRate: number; readonly frames?: number }>,
		) => PromiseLike<void> | void,
	): Promise<Readonly<{
		readonly sampleRate: number;
		readonly channelCount: number;
		readonly frameCount: number;
		readonly chunkCount: number;
	}>>;
	finish(): void;
}

export interface ProductNativeRenderInputAuthorityBinding {
	begin(): ProductNativeRenderInputOperation;
}

type BeginOperation = () => ProductNativeRenderInputOperation;

interface BindingState {
	begin: BeginOperation | null;
}

const BINDINGS = new WeakMap<object, BindingState>();

/** Create the unforgeable one-controller handoff used by a product composition root. */
export function createProductNativeRenderInputAuthorityBinding(): ProductNativeRenderInputAuthorityBinding {
	const binding = Object.freeze({
		begin(): ProductNativeRenderInputOperation {
			const state = BINDINGS.get(binding);
			if (!state?.begin) throw new Error('The product native render-input authority is not connected.');
			return operation(state.begin());
		},
	});
	BINDINGS.set(binding, { begin: null });
	return binding;
}

/** Connect exactly one common-controller runtime to its branded product binding. */
export function connectProductNativeRenderInputAuthority(
	bindingValue: unknown,
	begin: BeginOperation,
): void {
	if (!bindingValue || typeof bindingValue !== 'object') {
		throw new TypeError('A product-created native render-input binding is required.');
	}
	const state = BINDINGS.get(bindingValue);
	if (!state) throw new TypeError('A product-created native render-input binding is required.');
	if (state.begin) throw new Error('The product native render-input authority is already connected.');
	if (typeof begin !== 'function') throw new TypeError('A native render-input begin authority is required.');
	state.begin = begin;
}

function operation(value: unknown): ProductNativeRenderInputOperation {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('The controller returned an invalid native render-input operation.');
	}
	const row = value as Partial<ProductNativeRenderInputOperation>;
	if (!row.project || typeof row.project !== 'object' || Array.isArray(row.project)
		|| !(row.signal instanceof AbortSignal)
		|| typeof row.assertCurrent !== 'function'
		|| typeof row.renderAudio !== 'function'
		|| (row.renderAudioToSink !== undefined && typeof row.renderAudioToSink !== 'function')
		|| typeof row.finish !== 'function') {
		throw new TypeError('The controller returned an invalid native render-input operation.');
	}
	return value as ProductNativeRenderInputOperation;
}
