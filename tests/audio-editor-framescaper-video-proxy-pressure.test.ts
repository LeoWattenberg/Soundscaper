/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	reportFramescaperVideoProxyPreviewPressure,
	type FramescaperVideoProxyPressureCounters,
} from '../src/common/editor/ui/workspace/framescaper-video-proxy-pressure.ts';
import { resolveFramescaperVideoProxyUseRetime } from '../src/framescaper/editor-video-proxy-use-policy-retime.ts';

const VIEWPORT = Object.freeze({
	width: 1_280, height: 720, referenceWidth: 1_280, referenceHeight: 720,
});

/** A video element that only answers the decode-quality question. */
function element(total: number, dropped: number): HTMLVideoElement {
	return {
		getVideoPlaybackQuality: () => ({ totalVideoFrames: total, droppedVideoFrames: dropped }),
	} as unknown as HTMLVideoElement;
}

async function report(
	total: number,
	dropped: number,
	counters: FramescaperVideoProxyPressureCounters,
): Promise<number> {
	let ratio = -1;
	await reportFramescaperVideoProxyPreviewPressure(
		(_sourceId, pressure) => { ratio = pressure.droppedFrameRatio; },
		[{ clipId: 'clip', sourceId: 'source' }],
		new Map([['clip', element(total, dropped)]]),
		VIEWPORT,
		counters,
	);
	return ratio;
}

/**
 * `getVideoPlaybackQuality` counts for the lifetime of the element's media
 * resource, and the preview caches one element per clip for the whole session.
 * Pressure is a statement about now, so it has to be read as a change since the
 * previous look.
 */
test('proxy pressure reports the drop rate since the previous report', async () => {
	const counters: FramescaperVideoProxyPressureCounters = new Map();

	assert.equal(await report(7_500, 0, counters), 0, 'a clean opening stretch reports no pressure');

	// 200 dropped frames out of the next 300 decoded: a visible stall.
	const stalling = await report(7_800, 200, counters);
	assert.ok(stalling > 0.5, `a stall must read as heavy pressure, got ${String(stalling)}`);

	// Playback recovers: the next interval decodes cleanly.
	assert.equal(
		await report(8_100, 200, counters),
		0,
		'recovery is visible immediately rather than decaying with lifetime totals',
	);
});

test('a restarted decode counter does not report negative pressure', async () => {
	const counters: FramescaperVideoProxyPressureCounters = new Map();
	await report(5_000, 40, counters);

	const restarted = await report(10, 1, counters);
	assert.ok(restarted >= 0 && restarted <= 1, `ratio stays in range, got ${String(restarted)}`);
});

test('proxy-use policy accepts verified trust and rejects the legacy attested wire value', () => {
	const request = {
		purpose: 'preview', mode: 'proxy', originalAvailable: true,
		proxyTrust: 'verified', pressure: null,
	} as const;
	assert.equal(resolveFramescaperVideoProxyUseRetime(request).kind, 'proxy');
	assert.throws(() => resolveFramescaperVideoProxyUseRetime({
		...request, proxyTrust: 'attested',
	} as unknown as Parameters<typeof resolveFramescaperVideoProxyUseRetime>[0]), /trust state is unsupported/iu);
});
