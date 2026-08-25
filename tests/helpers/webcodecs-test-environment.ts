/* SPDX-License-Identifier: AGPL-3.0-only */

/** Run one test with deterministic WebCodecs globals and restore exact descriptors. */
export async function withWebCodecsSupport<Value>(run: () => Promise<Value>): Promise<Value> {
	const keys = ['crossOriginIsolated', 'VideoFrame', 'VideoEncoder'] as const;
	const descriptors = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
	Object.defineProperties(globalThis, {
		crossOriginIsolated: { configurable: true, value: true },
		VideoFrame: { configurable: true, value: function VideoFrame() {} },
		VideoEncoder: {
			configurable: true,
			value: { isConfigSupported: async () => ({ supported: true }) },
		},
	});
	try { return await run(); }
	finally {
		for (const key of keys) {
			const descriptor = descriptors.get(key);
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else Reflect.deleteProperty(globalThis, key);
		}
	}
}
