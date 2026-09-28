/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';

import { useSpectrogramPcmTiles } from '../src/common/editor/ui/timeline/useSpectrogramPcmTiles.ts';
import type { SpectrogramPcmColumns } from '../src/common/editor/ui/timeline/spectrogram-pcm-tiles.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

const SOURCE = Object.freeze({ id: 'source', sampleRate: 48_000, frameCount: 300_000 });
const CLIP = Object.freeze({
	id: 'clip', sourceId: SOURCE.id, kind: 'audio', anchor: 'sample',
	timelineStartFrame: 0, durationFrames: 300_000,
	sourceStartFrame: 0, sourceDurationFrames: 300_000,
	waveformStartFrame: 0, waveformEndFrame: 300_000,
});

test('streamed spectrogram tiles survive each PCM publication without restarting', async () => {
	const dom = installReactTestDom();
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const sourceLookup = new Map([[SOURCE.id, SOURCE]]);
	const projectedClips = [CLIP];
	const calls: Array<{ startFrame: number; endFrame: number }> = [];
	let publish = () => {};
	let latest: ReadonlyMap<string, SpectrogramPcmColumns> = new Map();
	let buffer: { numberOfChannels: number; getChannelData(channel: number): Float32Array } | null = {
		numberOfChannels: 1, getChannelData: () => new Float32Array(1),
	};
	let pcmWindow: { startFrame: number; endFrame: number; channels: readonly Float32Array[] } | null = null;
	const controller = {
		getClipVisualData: () => ({ available: true, source: SOURCE, buffer, pcmWindow }),
		actions: { timeline: { requestWaveformPcmWindow: async (
			_clipId: string,
			{ startFrame, endFrame }: { startFrame: number; endFrame: number; signal?: AbortSignal },
		) => {
			calls.push({ startFrame, endFrame });
			pcmWindow = {
				startFrame,
				endFrame,
				channels: [Float32Array.from({ length: endFrame - startFrame }, (_, index) => (
					Math.sin(2 * Math.PI * (index + startFrame) / 32)
				))],
			};
			publish();
			return pcmWindow;
		} } },
	};
	function Harness({ displayMode }: Readonly<{ displayMode: string }>) {
		const [visualRevision, setVisualRevision] = useState(0);
		publish = () => setVisualRevision((revision) => revision + 1);
		latest = useSpectrogramPcmTiles({
			controller, projectedClips, sourceLookup, project: null,
			pixelsPerSecond: 20, sampleRate: 48_000,
			displayMode, fftWindowSize: 32, windowType: 'hann', visualRevision,
		});
		return null;
	}
	try {
		await act(async () => root.render(<Harness displayMode="waveform" />));
		assert.equal(calls.length, 0);
		await act(async () => root.render(<Harness displayMode="spectrogram" />));
		assert.equal(calls.length, 0, 'a resident source buffer needs no streaming');
		buffer = null;
		pcmWindow = { startFrame: 0, endFrame: 300_000, channels: [new Float32Array(300_000)] };
		await act(async () => publish());
		assert.equal(calls.length, 0, 'a covering PCM window needs no streaming');
		pcmWindow = null;
		await act(async () => publish());
		await waitFor(() => latest.has(CLIP.id));
		assert.ok(calls.length > 1, 'the long clip must be split into bounded requests');
		assert.equal(latest.get(CLIP.id)?.pixelSkip, 1);
		assert.equal(latest.get(CLIP.id)?.channels[0]?.length, 125);
		const completedCallCount = calls.length;
		await act(async () => publish());
		assert.equal(calls.length, completedCallCount, 'document snapshots reuse the completed columns');
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		dom.restore();
	}
});

test('a changed spectral width aborts stale tiles and unmount aborts the replacement', async () => {
	const dom = installReactTestDom();
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const clip = CLIP;
	const source = SOURCE;
	const sourceLookup = new Map([[source.id, source]]);
	const pending: Array<{
		signal?: AbortSignal;
		resolve(value: unknown): void;
	}> = [];
	let latest: ReadonlyMap<string, SpectrogramPcmColumns> = new Map();
	const controller = {
		getClipVisualData: () => ({ available: true, source, buffer: null, pcmWindow: null }),
		actions: { timeline: { requestWaveformPcmWindow: (
			_clipId: string,
			options: { startFrame: number; endFrame: number; signal?: AbortSignal },
		) => new Promise<unknown>((resolve) => {
			pending.push({ signal: options.signal, resolve });
		}) } },
	};
	function Harness({ pixelsPerSecond }: Readonly<{ pixelsPerSecond: number }>) {
		latest = useSpectrogramPcmTiles({
			controller, projectedClips: [clip], sourceLookup, project: null,
			pixelsPerSecond, sampleRate: 48_000,
			displayMode: 'multiview', fftWindowSize: 32, windowType: 'hann', visualRevision: 0,
		});
		return null;
	}
	try {
		await act(async () => root.render(<Harness pixelsPerSecond={20} />));
		await waitFor(() => pending.length === 1);
		await act(async () => root.render(<Harness pixelsPerSecond={40} />));
		await waitFor(() => pending.length === 2);
		assert.equal(pending[0]?.signal?.aborted, true);
		await act(async () => pending[0]?.resolve({
			startFrame: 0, endFrame: 262_144, channels: [new Float32Array(262_144)],
		}));
		assert.equal(latest.has(clip.id), false, 'stale tile completion cannot repaint the clip');
		await act(async () => root.unmount());
		assert.equal(pending[1]?.signal?.aborted, true);
	} finally {
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		dom.restore();
	}
});

test('FFT context over the PCM cap uses tiles even when a narrow window covers the painted slice', async () => {
	const dom = installReactTestDom();
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const source = { id: 'source', sampleRate: 48_000, frameCount: 400_000 };
	const clip = { ...CLIP, durationFrames: 400_000, sourceDurationFrames: 400_000,
		waveformStartFrame: 1_000, waveformEndFrame: 261_000 };
	const projectedClips = [clip];
	const sourceLookup = new Map([[source.id, source]]);
	const requests: Array<{ startFrame: number; endFrame: number; signal?: AbortSignal }> = [];
	const controller = {
		getClipVisualData: () => ({ available: true, source, buffer: null,
			pcmWindow: { startFrame: 1_000, endFrame: 261_000,
				channels: [new Float32Array(260_000)] } }),
		actions: { timeline: { requestWaveformPcmWindow: (
			_clipId: string,
			options: { startFrame: number; endFrame: number; signal?: AbortSignal },
		) => new Promise<unknown>(() => { requests.push(options); }) } },
	};
	function Harness() {
		useSpectrogramPcmTiles({
			controller, projectedClips, sourceLookup, project: null,
			pixelsPerSecond: 20, sampleRate: 48_000,
			displayMode: 'spectrogram', fftWindowSize: 8_192,
			windowType: 'hann', visualRevision: 0,
		});
		return null;
	}
	try {
		await act(async () => root.render(<Harness />));
		await waitFor(() => requests.length > 0);
		assert.equal(requests[0]?.startFrame, 0,
			'first tile includes FFT context before the painted 1,000-frame start');
		assert.ok(requests[0]!.endFrame <= 262_140);
	} finally {
		await act(async () => root.unmount());
		assert.equal(requests[0]?.signal?.aborted, true);
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		dom.restore();
	}
});

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (predicate()) return;
		await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
	}
	assert.fail('Timed out waiting for spectrogram tile work.');
}
