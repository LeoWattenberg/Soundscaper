/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	audioEditorAsymmetricStereoHeightsAvailable,
	audioEditorStereoChannelDividerRegions,
	audioEditorStereoChannelGeometry,
	audioEditorStereoChannelHeightRatioAtPointer,
	audioEditorStereoChannelHeightRatioForDisplay,
} from '../src/common/editor/ui/timeline/stereo-channel-height-runtime.ts';

test('asymmetric stereo heights follow the Audacity preference and active workspace', () => {
	assert.equal(audioEditorAsymmetricStereoHeightsAvailable({
		asymmetricStereoHeights: 'always',
		asymmetricStereoHeightWorkspaces: [],
	}, 'classic'), true);
	assert.equal(audioEditorAsymmetricStereoHeightsAvailable({
		asymmetricStereoHeights: 'workspace-dependent',
		asymmetricStereoHeightWorkspaces: ['modern', 'studio'],
	}, 'modern'), true);
	assert.equal(audioEditorAsymmetricStereoHeightsAvailable({
		asymmetricStereoHeights: 'workspace-dependent',
		asymmetricStereoHeightWorkspaces: ['modern', 'studio'],
	}, 'classic'), false);
	assert.equal(audioEditorAsymmetricStereoHeightsAvailable({
		asymmetricStereoHeights: 'never',
		asymmetricStereoHeightWorkspaces: ['modern'],
	}, 'modern'), false);
	assert.equal(audioEditorAsymmetricStereoHeightsAvailable(undefined, 'modern'), false);
});

test('disabled tracks stay equal while multiview shares the stored ratio between both views', () => {
	assert.equal(audioEditorStereoChannelHeightRatioForDisplay(0.7, false, 'waveform'), 0.5);
	assert.equal(audioEditorStereoChannelHeightRatioForDisplay(0.7, true, 'multiview'), 0.7);
	assert.equal(audioEditorStereoChannelHeightRatioForDisplay(undefined, true, 'waveform'), 0.5);
	assert.equal(audioEditorStereoChannelHeightRatioForDisplay(0.7, true, 'waveform'), 0.7);
});

test('multiview exposes one synchronized stereo divider inside each view', () => {
	assert.deepEqual(audioEditorStereoChannelDividerRegions(20, 100, 'waveform'), [
		{ top: 20, height: 100 },
	]);
	assert.deepEqual(audioEditorStereoChannelDividerRegions(20, 101, 'multiview'), [
		{ top: 20, height: 50.5 },
		{ top: 70.5, height: 50.5 },
	]);
});

test('stereo channel geometry uses one normalized ratio for both channels', () => {
	assert.deepEqual(audioEditorStereoChannelGeometry(120, 0.25), [
		{ top: 0, height: 30 },
		{ top: 30, height: 90 },
	]);
	assert.deepEqual(audioEditorStereoChannelGeometry(120, Number.NaN), [
		{ top: 0, height: 60 },
		{ top: 60, height: 60 },
	]);
});

test('divider pointer geometry keeps at least twenty pixels in each channel', () => {
	assert.equal(audioEditorStereoChannelHeightRatioAtPointer(70, 20, 100), 0.5);
	assert.equal(audioEditorStereoChannelHeightRatioAtPointer(-100, 20, 100), 0.2);
	assert.equal(audioEditorStereoChannelHeightRatioAtPointer(1_000, 20, 100), 0.8);
	assert.equal(audioEditorStereoChannelHeightRatioAtPointer(24, 20, 30), 0.5);
	assert.equal(audioEditorStereoChannelHeightRatioAtPointer(30, 20, 0), 0.5);
});
