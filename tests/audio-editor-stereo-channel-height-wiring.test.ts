/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const TIMELINE_ROOT = new URL('../src/common/editor/ui/timeline/', import.meta.url);

async function source(name: string): Promise<string> {
	return readFile(new URL(name, TIMELINE_ROOT), 'utf8');
}

test('track rows gate the stored stereo channel ratio by editing preference and workspace', async () => {
	const trackList = await source('TrackListView.jsx');
	assert.match(trackList, /audioEditorAsymmetricStereoHeightsAvailable\(/u);
	assert.match(trackList, /asymmetricStereoHeightsAvailable=\{asymmetricStereoHeightsAvailable\}/u);
	assert.match(trackList, /channelHeightRatio=\{snapshot\.timeline\?\.trackChannelHeightRatios\?\.\[track\.id\]\}/u);
});

test('one display ratio drives clip, canvas, ruler, pointer, and divider geometry', async () => {
	const row = await source('AudioTrackRow.jsx');
	assert.match(row, /audioEditorStereoChannelHeightRatioForDisplay\(/u);
	assert.match(row, /audioEditorClipBodyGeometry\(trackHeight\)/u);
	assert.match(row, /data-channel-body-top=\{channelBodyTop\}/u);
	assert.match(row, /data-channel-height-ratio=\{displayChannelHeightRatio\}/u);
	assert.match(row, /<TrackNew[\s\S]*?channelSplitRatio=\{displayChannelHeightRatio\}/u);
	assert.match(row, /<AudacityWaveformCanvases[\s\S]*?channelHeightRatio=\{displayChannelHeightRatio\}/u);
	assert.match(row, /audioEditorStereoChannelDividerRegions\([\s\S]*?\.map\([\s\S]*?<StereoChannelDivider/u);
	assert.match(row, /<StereoChannelDivider[\s\S]*?ratio=\{displayChannelHeightRatio\}/u);
	assert.match(row, /setChannelHeightRatio\(track\.id, ratio\)/u);
	assert.match(row, /renderFrequencyRulers\([\s\S]*?displayChannelHeightRatio/u);
	assert.match(row, /renderAmplitudeRulers\([\s\S]*?displayChannelHeightRatio/u);
});

test('Audacity canvases resolve stereo waveform and spectrogram bands through shared geometry', async () => {
	const renderer = await source('TimelineCanvasRenderer.jsx');
	assert.match(renderer, /audioEditorStereoChannelGeometry\(waveformHeight, options\.channelHeightRatio\)/u);
	assert.match(renderer, /audioEditorStereoChannelGeometry\(options\.height, options\.channelHeightRatio\)/u);
});
