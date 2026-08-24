/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createDesktopHelperVideoTimingProbe } from '../src/common/editor/desktop-helper-video-timing-probe.ts';
import {
	desktopReadCapabilityIdFor,
	registerDesktopReadCapability,
} from '../src/common/editor/desktop-read-capability-registry.ts';
import { probeVideoTiming } from '../src/common/editor/video-timing-probe.ts';
import { encodeVideoTimingAsset } from '../src/common/editor/video-timing-asset.ts';
import { createUnreportedVideoSourceCharacteristics } from '../src/common/editor/video-source-characteristics.ts';

const CAPABILITY_ID = 'ab'.repeat(32);
const PROBE_ID = 'cd'.repeat(20);

const TIMING_ASSET = encodeVideoTimingAsset({
	timescale: 30,
	presentationTicks: [0n, 1n, 2n],
	finalFrameDurationTicks: 1n,
});

function createBridge(overrides: Readonly<Record<string, unknown>> = {}) {
	const calls: Array<readonly [string, unknown]> = [];
	const bridge = {
		beginVideoSourceProbe: async (request: unknown) => {
			calls.push(['begin', request]);
			return { probeId: PROBE_ID };
		},
		awaitVideoSourceProbe: async (request: unknown) => {
			calls.push(['await', request]);
			return {
				status: 'probed' as const,
				timingAsset: new Uint8Array(TIMING_ASSET),
				nominalRate: { num: 30, den: 1 },
				characteristics: createUnreportedVideoSourceCharacteristics(),
			};
		},
		cancelVideoSourceProbe: async (request: unknown) => {
			calls.push(['cancel', request]);
			return { cancelled: true };
		},
		...overrides,
	};
	return { bridge, calls };
}

test('the desktop helper probe port resolves media to its capability id and validates through the shared resolver', async () => {
	const media = new Blob([new Uint8Array(16)], { type: 'video/mp4' });
	registerDesktopReadCapability(media, CAPABILITY_ID);
	assert.equal(desktopReadCapabilityIdFor(media), CAPABILITY_ID);
	const { bridge, calls } = createBridge();
	const port = createDesktopHelperVideoTimingProbe({ bridge });
	assert.ok(port);
	assert.equal(port.id, 'native-helper');
	const resolved = await probeVideoTiming(media, { probes: [port] });
	assert.equal(resolved.decision, 'timing-asset');
	assert.ok(resolved.decision === 'timing-asset');
	assert.equal(resolved.backend, 'native-helper');
	assert.equal(resolved.timing.frameCount, 3);
	assert.deepEqual(calls.map(([name]) => name), ['begin', 'await']);
	assert.deepEqual(calls[0][1], { capabilityId: CAPABILITY_ID });
});

test('the desktop helper probe port is inapplicable without a bridge or a backing capability', async () => {
	assert.equal(createDesktopHelperVideoTimingProbe({ bridge: null }), null);
	assert.equal(createDesktopHelperVideoTimingProbe({ bridge: { beginVideoSourceProbe: () => {} } }), null);
	const { bridge } = createBridge();
	const port = createDesktopHelperVideoTimingProbe({ bridge });
	assert.ok(port);
	const unregistered = new Blob([new Uint8Array(8)], { type: 'video/webm' });
	const resolved = await probeVideoTiming(unregistered, { probes: [port] });
	assert.equal(resolved.decision, 'conform-cfr-at-ingest');
	assert.ok(resolved.decision === 'conform-cfr-at-ingest');
	assert.equal(resolved.failures.length, 1);
	assert.equal(resolved.failures[0].backend, 'native-helper');
	assert.match(resolved.failures[0].message, /No desktop read capability/u);
});

test('the desktop helper probe port records helper failures so the wasm probe visibly takes over', async () => {
	const media = new Blob([new Uint8Array(16)], { type: 'video/mp4' });
	registerDesktopReadCapability(media, CAPABILITY_ID);
	const { bridge } = createBridge({
		awaitVideoSourceProbe: async () => ({
			status: 'failed' as const,
			code: 'helper-disabled',
			message: 'The native probe helper is disabled.',
		}),
	});
	const port = createDesktopHelperVideoTimingProbe({ bridge });
	assert.ok(port);
	const fallbackTiming = {
		timescale: 25,
		presentationTicks: [0n, 1n],
		finalFrameDurationTicks: 1n,
		nominalRate: { num: 25, den: 1 },
	};
	const wasmPort = Object.freeze({ id: 'ffmpeg', probe: async () => fallbackTiming });
	const resolved = await probeVideoTiming(media, { probes: [port, wasmPort] });
	assert.equal(resolved.decision, 'timing-asset');
	assert.ok(resolved.decision === 'timing-asset');
	assert.equal(resolved.backend, 'ffmpeg', 'the wasm probe must take over after a helper refusal');
});

test('the desktop helper probe port cancels the main-side probe when its signal aborts', async () => {
	const media = new Blob([new Uint8Array(16)], { type: 'video/mp4' });
	registerDesktopReadCapability(media, CAPABILITY_ID);
	const controller = new AbortController();
	let settleAwait: (value: unknown) => void = () => {};
	const { bridge, calls } = createBridge({
		awaitVideoSourceProbe: (request: unknown) => {
			calls.push(['await', request]);
			return new Promise((resolve) => {
				settleAwait = resolve;
			});
		},
	});
	const port = createDesktopHelperVideoTimingProbe({ bridge });
	assert.ok(port);
	const probing = port.probe(media, { signal: controller.signal });
	await Promise.resolve();
	controller.abort();
	settleAwait({ status: 'failed', code: 'helper-cancelled', message: 'cancelled' });
	await assert.rejects(Promise.resolve(probing));
	assert.ok(calls.some(([name]) => name === 'cancel'), 'an abort must reach the main-side cancel channel');
});

test('an abort landing during the begin round-trip still cancels the helper job', async () => {
	const media = new Blob([new Uint8Array(16)], { type: 'video/mp4' });
	registerDesktopReadCapability(media, CAPABILITY_ID);
	const controller = new AbortController();
	const { bridge, calls } = createBridge({
		beginVideoSourceProbe: async (request: unknown) => {
			calls.push(['begin', request]);
			// The abort event dispatches while the begin IPC is in flight, so no
			// listener attached afterwards will ever hear it.
			controller.abort();
			return { probeId: PROBE_ID };
		},
		awaitVideoSourceProbe: async () => {
			throw new Error('an aborted probe must not be awaited');
		},
	});
	const port = createDesktopHelperVideoTimingProbe({ bridge });
	assert.ok(port);
	await assert.rejects(Promise.resolve(port.probe(media, { signal: controller.signal })));
	assert.ok(calls.some(([name]) => name === 'cancel'),
		'the helper job must not run to natural completion after the caller aborted');
});
