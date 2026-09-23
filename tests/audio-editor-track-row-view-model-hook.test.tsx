/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { useState } from 'react';
import { renderToString } from 'react-dom/server';

import {
	timelineWaveformPcmWindowRequestPixelWidth,
	useAudioTrackRowViewModel,
} from '../src/common/editor/ui/timeline/useAudioTrackRowViewModel.js';
import { WAVEFORM_PEAKS_VERSION } from '../src/common/editor/waveform-peak-contract.ts';

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
	}), null);
	assert.equal(timelineWaveformPcmWindowRequestPixelWidth({
		visual, clip, project: null, pixelWidth: 100, displayMode: 'spectrogram',
	}), undefined, 'spectrogram requests PCM without triggering a peak scan');
	assert.equal(timelineWaveformPcmWindowRequestPixelWidth({
		visual: { ...visual, pcmWindow: { channels: [new Float32Array(100)], startFrame: 0, endFrame: 100 } },
		clip,
		project: null,
		pixelWidth: 20,
	}), null);
	assert.equal(timelineWaveformPcmWindowRequestPixelWidth({
		visual: { ...visual, buffer: { numberOfChannels: 1 } },
		clip,
		project: null,
		pixelWidth: 20,
	}), null);
});
