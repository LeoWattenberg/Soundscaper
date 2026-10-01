/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act, useState } from 'react';
import { renderToString } from 'react-dom/server';

import {
	timelineWaveformPcmWindowRequestPixelWidth,
	useAudioTrackRowViewModel,
} from '../src/common/editor/ui/timeline/useAudioTrackRowViewModel.js';
import { WAVEFORM_PEAKS_VERSION } from '../src/common/editor/waveform-peak-contract.ts';
import type { TimelineClipVisualData } from '../src/common/editor/ui/timeline/waveform-view-model.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

const EMPTY_SET = new Set<string>();
const EMPTY_MAP = new Map<string, never>();
const EMPTY_CLIPS: never[] = [];
const PROJECT = Object.freeze({ clips: [], sources: [], tracks: [] });
const TRACK = Object.freeze({ id: 'track-1', type: 'audio', color: 'blue' });
const TRACK_WINDOW_REF = { current: null };
const COPY = Object.freeze({ recordingLabel: 'Recording' });
const RUN = (action: () => void) => action();
const CONTROLLER = Object.freeze({
	actions: Object.freeze({
		clip: Object.freeze({ update() {} }),
		timeline: Object.freeze({}),
	}),
	getClipVisualData() {
		return null;
	},
});

test('audio row keeps canvas projection inputs stable across exact-scroll rerenders', () => {
	const observed: ReturnType<typeof useAudioTrackRowViewModel>[] = [];
	function Harness() {
		const [exactScrollRevision, setExactScrollRevision] = useState(0);
		const viewModel = useAudioTrackRowViewModel({
			controller: CONTROLLER,
			project: PROJECT,
			track: TRACK,
			trackClips: EMPTY_CLIPS,
			clipLookup: EMPTY_MAP,
			sourceLookup: EMPTY_MAP,
			trackWindowRef: TRACK_WINDOW_REF,
			renderViewportStartFrame: 0,
			viewportDurationFrames: 48_000,
			viewModelRevision: PROJECT,
			pixelsPerSecond: 120,
			sampleRate: 48_000,
			selection: { startTime: 1, endTime: 2 },
			selectedClipId: null,
			selectedClipIdSet: EMPTY_SET,
			displayMode: 'waveform',
			showRms: false,
			recordingPreview: null,
			clipDragPreview: null,
			projectBinDragPreview: null,
			waveformCache: EMPTY_MAP,
			draggingClipIds: EMPTY_SET,
			copy: COPY,
			run: RUN,
			blocked: false,
			automationToolEnabled: false,
		});
		observed.push(viewModel);
		if (exactScrollRevision === 0) setExactScrollRevision(1);
		return <span>{exactScrollRevision}</span>;
	}

	assert.equal(renderToString(<Harness />), '<span>1</span>');
	assert.equal(observed.length, 2);
	assert.equal(observed[0]?.projection, observed[1]?.projection);
	assert.equal(observed[0]?.projectedClips, observed[1]?.projectedClips);
	assert.equal(observed[0]?.projectedSelection, observed[1]?.projectedSelection);
	assert.equal(observed[0]?.crossfadeOverlays, observed[1]?.crossfadeOverlays);
});

test('audio rows prefetch a window fine enough for the next fourfold zoom step', () => {
	const clip = {
		id: 'clip', timelineStartFrame: 0, durationFrames: 100,
		sourceStartFrame: 0, sourceDurationFrames: 100,
		waveformStartFrame: 0, waveformEndFrame: 100,
	};
	const peaks = {
		version: WAVEFORM_PEAKS_VERSION,
		channelCount: 1,
		levels: [{
			blockSize: 8,
			channels: [{
				minimums: new Float32Array(13),
				maximums: new Float32Array(13),
				rms: new Float32Array(13),
			}],
		}],
	};
	const visual = { available: true, buffer: null, pcmWindow: null, peaks };
	assert.equal(timelineWaveformPcmWindowRequestPixelWidth({ visual, clip, project: null, pixelWidth: 2 }), 192);
	assert.equal(timelineWaveformPcmWindowRequestPixelWidth({
		visual, clip, project: null, pixelWidth: 4,
	}), 192);
	assert.equal(timelineWaveformPcmWindowRequestPixelWidth({
		visual, clip, project: null, pixelWidth: 20,
	}), 192);
	assert.equal(timelineWaveformPcmWindowRequestPixelWidth({
		visual, clip, project: null, pixelWidth: 20_000,
	}), 32_768);
	assert.equal(timelineWaveformPcmWindowRequestPixelWidth({
		visual, clip, project: null, pixelWidth: 20, displayMode: 'spectrogram',
	}), undefined, 'spectrogram requests PCM even at summary zoom');
	assert.equal(timelineWaveformPcmWindowRequestPixelWidth({
		visual, clip, project: null, pixelWidth: 100, displayMode: 'spectrogram',
	}), undefined, 'spectrogram requests PCM without triggering a peak scan');
	assert.equal(timelineWaveformPcmWindowRequestPixelWidth({
		visual, clip, project: null, pixelWidth: 20, displayMode: 'multiview',
	}), undefined, 'multi-view also needs PCM for its spectrogram');
	assert.equal(timelineWaveformPcmWindowRequestPixelWidth({
		visual,
		clip: { ...clip, durationFrames: 300_000, sourceDurationFrames: 300_000,
			waveformEndFrame: 300_000 },
		project: null,
		pixelWidth: 400,
		displayMode: 'spectrogram',
	}), null, 'long spectrogram windows are read in PCM tiles');
	assert.equal(timelineWaveformPcmWindowRequestPixelWidth({
		visual: { ...visual, pcmWindow: { channels: [new Float32Array(100)], startFrame: 0, endFrame: 100 } },
		clip,
		project: null,
		pixelWidth: 20,
	}), null);
	const narrowClip = {
		...clip, durationFrames: 48_000, sourceDurationFrames: 48_000,
		waveformStartFrame: 20_000, waveformEndFrame: 20_018,
	};
	assert.equal(timelineWaveformPcmWindowRequestPixelWidth({
		visual: { ...visual, pcmWindow: {
			channels: [new Float32Array(18)], startFrame: 20_000, endFrame: 20_018,
		} },
		clip: narrowClip,
		project: null,
		pixelWidth: 96,
		displayMode: 'spectrogram',
		fftWindowSize: 2048,
	}), undefined, 'a visible-only PCM window still needs FFT context');
	assert.equal(timelineWaveformPcmWindowRequestPixelWidth({
		visual: { ...visual, buffer: { numberOfChannels: 1 } },
		clip,
		project: null,
		pixelWidth: 20,
	}), null);
});

test('audio row reuses visual models on unrelated publications and refreshes when clip data arrives', async () => {
	const dom = installReactTestDom();
	const { createRoot } = await import('react-dom/client');
	const source = { id: 'source', frameCount: 100, channelCount: 1, sampleRate: 48_000 };
	const clip = {
		id: 'clip', sourceId: source.id, title: 'Clip', timelineStartFrame: 0,
		sourceStartFrame: 0, sourceDurationFrames: 100, durationFrames: 100, envelope: [],
	};
	const project = { id: 'project', sampleRate: 48_000, clips: [clip], sources: [source], tracks: [TRACK] };
	const trackClips = [clip];
	const clipLookup = new Map([[clip.id, clip]]);
	const sourceLookup = new Map([[source.id, source]]);
	const waveformCache = new Map();
	let visual: TimelineClipVisualData = { source, available: true, buffer: null, peaks: null };
	const requests: unknown[][] = [];
	const controller = {
		...CONTROLLER,
		actions: {
			...CONTROLLER.actions,
			timeline: {
				requestWaveformPcmWindow: (...args: unknown[]) => { requests.push(args); },
			},
		},
		// Controller getters return a fresh wrapper on each read; its content
		// references, rather than the wrapper, identify visual publications.
		getClipVisualData: () => ({ ...visual }),
	};
	const observed: ReturnType<typeof useAudioTrackRowViewModel>[] = [];
	function Harness({ publication, presentationProject = project, selectedId = null }: Readonly<{
		publication: object; presentationProject?: object; selectedId?: string | null;
	}>) {
		observed.push(useAudioTrackRowViewModel({
			controller,
			project: presentationProject,
			track: TRACK,
			trackClips,
			clipLookup,
			sourceLookup,
			trackWindowRef: TRACK_WINDOW_REF,
			renderViewportStartFrame: 0,
			viewportDurationFrames: 100,
			viewModelRevision: publication,
			pixelsPerSecond: 120,
			sampleRate: 48_000,
			selection: null,
			selectedClipId: selectedId,
			selectedClipIdSet: EMPTY_SET,
			displayMode: 'waveform',
			showRms: false,
			recordingPreview: null,
			clipDragPreview: null,
			projectBinDragPreview: null,
			waveformCache,
			draggingClipIds: EMPTY_SET,
			copy: COPY,
			run: RUN,
			blocked: false,
			automationToolEnabled: false,
		}));
		return null;
	}
	const root = createRoot(dom.container as unknown as Element);
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	try {
		await act(async () => { root.render(<Harness publication={{ revision: 1 }} />); });
		const initial = observed.at(-1)!;
		assert.equal(requests.length, 1);
		await act(async () => { root.render(<Harness
			publication={{ revision: 2, playhead: 42 }}
			presentationProject={{ ...project, selection: { clipIds: ['other'] } }}
			selectedId="other"
		/>); });
		const unrelated = observed.at(-1)!;
		assert.equal(unrelated.projectedClips, initial.projectedClips,
			'playback, status and selection on other rows do not recreate waveform plans');
		assert.equal(requests.length, 1, 'unrelated updates do not repeat PCM requests');
		visual = { ...visual, pcmWindow: {
			startFrame: 0, endFrame: 100, channels: [new Float32Array(100)],
		} };
		await act(async () => { root.render(<Harness publication={{ revision: 3 }} />); });
		const ready = observed.at(-1)!;
		assert.notEqual(ready.projectedClips, initial.projectedClips);
		assert.ok(ready.projectedClips[0]?.audacityWaveform);
		assert.notEqual(ready.projectedClips[0]?.waveformPending, true);
		await act(async () => { root.render(<Harness publication={{ revision: 4, playhead: 43 }} />); });
		assert.equal(observed.at(-1)?.projectedClips, ready.projectedClips);
		await act(async () => { root.render(<Harness publication={{ revision: 5 }} selectedId="clip" />); });
		assert.notEqual(observed.at(-1)?.projectedClips, ready.projectedClips);
		assert.equal(observed.at(-1)?.projectedClips[0]?.selected, true);
		await act(async () => { root.render(<Harness publication={{ revision: 6 }} selectedId="other" />); });
		assert.equal(observed.at(-1)?.projectedClips[0]?.selected, false);
		const beforeTempo = observed.at(-1)?.projectedClips;
		await act(async () => { root.render(<Harness
			publication={{ revision: 7 }}
			presentationProject={{ ...project, tempoMap: { events: [] } }}
		/>); });
		assert.notEqual(observed.at(-1)?.projectedClips, beforeTempo, 'tempo edits refresh waveform plans');
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

test('frequency mode requests bounded data at moderate summary zoom before analysis exists', async () => {
	const requests = await frequencyRequestsAtSummaryZoom({
		sourceFrameCount: 25_600,
		clipFrameCount: 25_600,
		pixelsPerSecond: 480,
	});

	assert.deepEqual(requests, [['clip', { startFrame: 0, endFrame: 25_600 }]]);
});

test('frequency requests use the same minimum clip width as rendering', async () => {
	const requests = await frequencyRequestsAtSummaryZoom({
		sourceFrameCount: 100,
		clipFrameCount: 100,
		pixelsPerSecond: 120,
	});

	assert.deepEqual(requests, [['clip', { startFrame: 0, endFrame: 100 }]]);
});

test('adaptive analysis resolution upgrades a moderate summary request to a bounded window', async () => {
	const requests = await frequencyRequestsAtSummaryZoom({
		sourceFrameCount: 40_000_000,
		clipFrameCount: 30_000,
		pixelsPerSecond: 160,
		resolvedBlockSize: 512,
	});

	assert.deepEqual(requests, [
		['clip', undefined],
		['clip', { startFrame: 0, endFrame: 30_000 }],
	]);
});

async function frequencyRequestsAtSummaryZoom(options: Readonly<{
	sourceFrameCount: number;
	clipFrameCount: number;
	pixelsPerSecond: number;
	resolvedBlockSize?: number;
}>) {
	const dom = installReactTestDom();
	const { createRoot } = await import('react-dom/client');
	const source = {
		id: 'source', frameCount: options.sourceFrameCount, channelCount: 1, sampleRate: 48_000,
	};
	const clip = {
		id: 'clip', sourceId: source.id, title: 'Clip', timelineStartFrame: 0,
		sourceStartFrame: 0, sourceDurationFrames: options.clipFrameCount,
		durationFrames: options.clipFrameCount, envelope: [],
	};
	const project = {
		id: 'project', sampleRate: 48_000, clips: [clip], sources: [source],
		tracks: [{ ...TRACK, clipIds: [clip.id] }],
	};
	const preferences = Object.freeze({ lowMidCrossoverHz: 250, midHighCrossoverHz: 4_000 });
	const revisions = [1, 2].map((revision) => Object.freeze({
		revision,
		preferences: Object.freeze({ waveformVisualization: preferences }),
	}));
	const trackClips = Object.freeze([clip]);
	const clipLookup = new Map([[clip.id, clip]]);
	const sourceLookup = new Map([[source.id, source]]);
	const waveformCache = new Map();
	const runOperation = (operation: () => unknown) => operation();
	const requests: unknown[][] = [];
	let frequencyAnalysis: unknown = null;
	const controller = {
		actions: {
			clip: { update() {} },
			timeline: {
				requestFrequencyWaveform: (...args: unknown[]) => { requests.push(args); return null; },
			},
		},
		getClipVisualData: () => ({
			source, available: true, buffer: null, pcmWindow: null, peaks: null, frequencyAnalysis,
		}),
		getProjectBinClipVisualData: () => null,
	};
	function Harness({ revision }: Readonly<{ revision: number }>) {
		useAudioTrackRowViewModel({
			controller,
			project,
			track: project.tracks[0],
			trackClips,
			clipLookup,
			sourceLookup,
			trackWindowRef: TRACK_WINDOW_REF,
			renderViewportStartFrame: 0,
			viewportDurationFrames: options.clipFrameCount,
			viewModelRevision: revisions[revision - 1],
			pixelsPerSecond: options.pixelsPerSecond,
			sampleRate: 48_000,
			selection: null,
			selectedClipId: null,
			selectedClipIdSet: EMPTY_SET,
			displayMode: 'waveform-rainbow',
			showRms: false,
			recordingPreview: null,
			clipDragPreview: null,
			projectBinDragPreview: null,
			waveformCache,
			draggingClipIds: EMPTY_SET,
			copy: { ...COPY, clip: 'Clip' },
			run: runOperation,
			blocked: false,
			automationToolEnabled: false,
		});
		return null;
	}
	const root = createRoot(dom.container as unknown as Element);
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	try {
		await act(async () => { root.render(<Harness revision={1} />); });
		if (options.resolvedBlockSize !== undefined) {
			frequencyAnalysis = {
				crossovers: { lowMidHz: 250, midHighHz: 4_000 },
				levels: [{ blockSize: options.resolvedBlockSize }],
			};
			await act(async () => { root.render(<Harness revision={2} />); });
		}
		return requests;
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
}
