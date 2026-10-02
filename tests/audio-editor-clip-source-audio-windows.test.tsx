/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { useClipSourceAudioWindows } from '../src/common/editor/ui/inspector/useClipSourceAudioWindows.ts';
import type { TimelinePcmWindow } from '../src/common/editor/ui/timeline/waveform-view-model.ts';
import { WAVEFORM_PEAKS_VERSION } from '../src/common/editor/waveform-peak-contract.ts';
import { deferred } from './helpers/async-test-control.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

test('source revision changes immediately hide retained PCM and cancel the earlier read', async () => {
	const f = await fixture();
	try {
		await f.render();
		await f.complete(0);
		assert.deepEqual(f.plans().requests, []);
		await f.render({ revision: 2 });
		assert.equal(f.plans().requests.length, 1, 'old samples must not cover a changed source');
		assert.equal(f.plans().models[0]?.waveformPending, true);
		await f.render({ revision: 3 });
		assert.equal(f.requests[1]?.signal?.aborted, true);
		await f.complete(1);
		assert.equal(f.plans().requests.length, 1, 'a retired read cannot repopulate the cache');
		await f.complete(2);
		assert.deepEqual(f.plans().requests, []);
	} finally { await f.cleanup(); }
});

test('unavailable bounded reads are not retried on ordinary renders', async () => {
	const f = await fixture();
	try {
		await f.render();
		await f.complete(0, null);
		await f.render(); await f.render();
		assert.equal(f.requests.length, 1);
		assert.ok(f.plans().models[0]?.audacityWaveform, 'coarse peaks remain visible');
	} finally { await f.cleanup(); }
});

async function fixture() {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const source = { id: 'source', revision: 1, sampleRate: 48_000, frameCount: 100_000, channelCount: 1 };
	let options = { source, project: { sampleRate: 48_000, tempoMap: { mode: 'musical' as const, events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }] } },
		clip: { id: 'clip', sourceId: 'source', timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 100_000, durationFrames: 100_000 },
		visual: { peaks: { version: WAVEFORM_PEAKS_VERSION, channelCount: 1, levels: [{ blockSize: 256, channels: [{
			minimums: new Float32Array(391).fill(-0.5), maximums: new Float32Array(391).fill(0.5), rms: new Float32Array(391).fill(0.2),
		}] }] } }, width: 800, startFrame: 20_000, endFrame: 21_000, displayMode: 'waveform' as const, clipLabel: 'Clip',
	};
	let plans: ReturnType<typeof useClipSourceAudioWindows> | null = null;
	const requests: { startFrame: number; endFrame: number; signal?: AbortSignal; response: ReturnType<typeof deferred<TimelinePcmWindow | null>> }[] = [];
	const load: NonNullable<Parameters<typeof useClipSourceAudioWindows>[1]> = (_clipId, range) => {
		const response = deferred<TimelinePcmWindow | null>(); requests.push({ ...range, response }); return response.promise;
	};
	function Subject() { plans = useClipSourceAudioWindows(options, load, error => { throw error; }); return null; }
	return {
		requests, plans: () => { assert.ok(plans); return plans; },
		render: async (changes: Partial<typeof source> = {}) => {
			options = { ...options, source: { ...options.source, ...changes } };
			await act(async () => { root.render(<Subject />); });
		},
		complete: async (index: number, result?: null) => {
			const request = requests[index]!;
			await act(async () => { request.response.resolve(result === null ? null : { sourceId: source.id,
				startFrame: request.startFrame, endFrame: request.endFrame, channels: [new Float32Array(request.endFrame - request.startFrame).fill(0.4)] }); });
		},
		cleanup: async () => { await act(async () => { root.unmount(); }); actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct; dom.restore(); },
	};
}
