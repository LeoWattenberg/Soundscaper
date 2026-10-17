/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { motionBrowserVideoHost } from '../src/common/editor/controller/export/internal/motion-browser-video-host.ts';

const webkit = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Safari/605.1.15';
test('Motion refuses the crashing Linux WebKit encoder boundary before any native probe and leaves other engines independent', async () => {
	const previous = new Map(['navigator', 'VideoEncoder', 'VideoFrame'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
	let probes = 0;
	Object.defineProperty(globalThis, 'VideoEncoder', { configurable: true, value: { async isConfigSupported() { probes++; return { supported: true }; } } });
	Object.defineProperty(globalThis, 'VideoFrame', { configurable: true, value: class {} });
	const identity = (platform: string, userAgent: string): void => { Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { platform, userAgent } }); };
	try {
		identity('Linux x86_64', webkit);
		for (const codec of ['vp09.00.10.08', 'avc1.640034']) await assert.rejects(motionBrowserVideoHost.supported({ codec, width: 64, height: 48 }), /Linux WebKit.*PNG/u);
		assert.equal(probes, 0);
		for (const [platform, userAgent] of [['MacIntel', webkit], ['Linux x86_64', 'Mozilla/5.0 AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36'], ['Linux x86_64', 'Mozilla/5.0 Gecko/20100101 Firefox/153.0']]) {
			identity(platform!, userAgent!); assert.equal(await motionBrowserVideoHost.supported({ codec: 'vp09.00.10.08', width: 64, height: 48 }), true);
		}
		assert.equal(probes, 3);
	} finally {
		for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
	}
});
