/* SPDX-License-Identifier: AGPL-3.0-only */
/** External CDP instrumentation only. This function is serialized into each observed isolate.
 * It changes no imported bytes, replaces no renderer, and holds only WeakRefs to memories.
 * The added promise reaction is declared observation overhead, not production behavior. */
export function installMotionWasmObservation() {
	const original = { Memory: WebAssembly.Memory, instantiate: WebAssembly.instantiate, instantiateStreaming: WebAssembly.instantiateStreaming };
	const memories: WeakRef<WebAssembly.Memory>[] = [], errors: string[] = [];
	const invalid = (error: unknown) => { if (errors.length < 8) errors.push(String(error)); };
	const seen = new WeakSet<WebAssembly.Memory>();
	let frames = 0, backend: string | null = null, revision: number | null = null;
	const originalPost = typeof globalThis.postMessage === 'function' ? globalThis.postMessage : null;
	const globalName: unknown = Reflect.get(globalThis, 'name');
	const workerName = typeof globalName === 'string' ? globalName : '';
	const observe = (memory: WebAssembly.Memory) => {
		if (seen.has(memory)) return;
		if (memories.length >= 32) { invalid('WASM observation count exceeded.'); return; }
		seen.add(memory); memories.push(new WeakRef(memory));
	};
	const instance = (value: unknown) => {
		const item = value instanceof WebAssembly.Instance ? value
			: value && typeof value === 'object' && Reflect.get(value, 'instance') instanceof WebAssembly.Instance ? Reflect.get(value, 'instance') as WebAssembly.Instance : null;
		if (item) for (const exported of Object.values(item.exports)) if (exported instanceof original.Memory) observe(exported);
	};
	WebAssembly.Memory = new Proxy(original.Memory, { construct(target, args, newTarget) {
		const value: unknown = Reflect.construct(target, args, newTarget);
		try { if (value instanceof original.Memory) observe(value); else invalid('Unexpected WebAssembly memory constructor result.'); }
		catch (error) { invalid(error); }
		return value as WebAssembly.Memory;
	} });
	WebAssembly.instantiate = new Proxy(original.instantiate, { apply(target, receiver, args) {
		const result: unknown = Reflect.apply(target, receiver, args);
		if (result instanceof Promise) void result.then((value: unknown) => { try { instance(value); } catch (error) { invalid(error); } }, () => undefined);
		else invalid('Unexpected WebAssembly instantiation promise.');
		return result;
	} });
	if (original.instantiateStreaming) WebAssembly.instantiateStreaming = new Proxy(original.instantiateStreaming, { apply(target, receiver, args) {
		const result: unknown = Reflect.apply(target, receiver, args);
		if (result instanceof Promise) void result.then((value: unknown) => { try { instance(value); } catch (error) { invalid(error); } }, () => undefined);
		else invalid('Unexpected streaming WebAssembly instantiation promise.');
		return result;
	} });
	if (originalPost && workerName === 'motionscaper-composition-preview') globalThis.postMessage = new Proxy(originalPost, { apply(target, receiver, args) {
		const result: unknown = Reflect.apply(target, receiver, args);
		try {
			const message: unknown = args[0];
			if (message && typeof message === 'object' && Reflect.get(message, 'type') === 'frame') {
				const frame: unknown = Reflect.get(message, 'frame');
				if (frame && typeof frame === 'object') {
					const mode: unknown = Reflect.get(frame, 'backend'), version: unknown = Reflect.get(frame, 'revision');
					if (typeof mode === 'string' && typeof version === 'number') { frames++; backend = mode; revision = version; }
					else invalid('Missing worker frame identity.');
				}
			}
		} catch (error) { invalid(error); }
		return result;
	} });
	return {
		snapshot() {
			const capacityBytes: number[] = [];
			for (const weak of memories) { const memory = weak.deref(); if (memory) capacityBytes.push(memory.buffer.byteLength); }
			return { observedMemories: memories.length, capacityBytes, weakOwnership: true, errors: [...errors], workerName, frames, backend, revision };
		},
		restore() { WebAssembly.Memory = original.Memory; WebAssembly.instantiate = original.instantiate; WebAssembly.instantiateStreaming = original.instantiateStreaming; if (originalPost) globalThis.postMessage = originalPost; },
	};
}

/** tsx may add its function-name helper when serializing TS. Keep that local to the observer. */
export function motionWasmObservationSource(): string {
	return `(() => { const __name = (fn, name) => { Object.defineProperty(fn, 'name', {value:name, configurable:true}); return fn; }; globalThis.__motionSustainedObservation = (${installMotionWasmObservation.toString()})(); })()`;
}
