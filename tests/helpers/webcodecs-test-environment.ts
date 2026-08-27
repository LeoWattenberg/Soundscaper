/* SPDX-License-Identifier: AGPL-3.0-only */

/** Install deterministic WebCodecs globals and return their exact restoration. */
export function installWebCodecsSupport(): () => void {
	const keys = [
		'crossOriginIsolated', 'VideoFrame', 'VideoEncoder', 'AudioData', 'AudioEncoder',
	] as const;
	const descriptors = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
	Object.defineProperties(globalThis, {
		crossOriginIsolated: { configurable: true, value: true },
		VideoFrame: { configurable: true, value: function VideoFrame() {} },
		VideoEncoder: {
			configurable: true,
			value: { isConfigSupported: async () => ({ supported: true }) },
		},
		AudioData: { configurable: true, value: function AudioData() {} },
		AudioEncoder: {
			configurable: true,
			value: { isConfigSupported: async () => ({ supported: true }) },
		},
	});
	return () => {
		for (const key of keys) {
			const descriptor = descriptors.get(key);
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else Reflect.deleteProperty(globalThis, key);
		}
	};
}

/** Run one test with deterministic WebCodecs globals and restore exact descriptors. */
export async function withWebCodecsSupport<Value>(run: () => Promise<Value>): Promise<Value> {
	const restore = installWebCodecsSupport();
	try { return await run(); } finally { restore(); }
}
