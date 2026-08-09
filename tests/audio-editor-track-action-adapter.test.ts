/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createTrackActionAdapter } from '../src/common/editor/controller/track-action-adapter.ts';

test('track action adapter delegates explicit and selected-track operations without changing defaults', async () => {
	const calls: unknown[][] = [];
	const service = {
		addTrack: (...args: unknown[]) => { calls.push(['addTrack', ...args]); return 'track'; },
		addVideoTrackPair: (...args: unknown[]) => { calls.push(['addVideoTrackPair', ...args]); return 'video'; },
		assignPreferredInputToTrack: (...args: unknown[]) => { calls.push(['assignPreferredInputToTrack', ...args]); return true; },
		addLabelTrack: (...args: unknown[]) => { calls.push(['addLabelTrack', ...args]); return 'labels'; },
		reorderTrack: (...args: unknown[]) => { calls.push(['reorderTrack', ...args]); return 'reordered'; },
		moveTrack: (...args: unknown[]) => { calls.push(['moveTrack', ...args]); return 'moved'; },
		setTrackDisplayMode: (...args: unknown[]) => { calls.push(['setTrackDisplayMode', ...args]); return 'display'; },
		setTrackRate: async (...args: unknown[]) => { calls.push(['setTrackRate', ...args]); return 'rate'; },
		setTrackSampleFormat: (...args: unknown[]) => { calls.push(['setTrackSampleFormat', ...args]); return 'format'; },
	};
	const adapter = createTrackActionAdapter({
		service,
		getSelectedTrackId: () => 'selected-track',
		projectSampleRate: () => 96_000,
	});

	assert.equal(adapter.addTrack({ name: 'Voice' }), 'track');
	assert.equal(adapter.addVideoTrackPair({ name: 'Picture' }), 'video');
	assert.equal(adapter.assignPreferredInputToTrack('input-track'), true);
	assert.equal(adapter.addLabelTrack(), 'labels');
	assert.equal(adapter.reorderTrack('track-2', 1), 'reordered');
	assert.equal(adapter.moveTrack('track-2', 'top'), 'moved');
	assert.equal(adapter.setTrackDisplayMode('track-2', 'spectrogram'), 'display');
	assert.equal(await adapter.setTrackRate(), 'rate');
	assert.equal(adapter.setTrackSampleFormat(), 'format');
	assert.deepEqual(calls, [
		['addTrack', { name: 'Voice' }],
		['addVideoTrackPair', { name: 'Picture' }],
		['assignPreferredInputToTrack', 'input-track'],
		['addLabelTrack', {}],
		['reorderTrack', 'track-2', 1],
		['moveTrack', 'track-2', 'top'],
		['setTrackDisplayMode', 'track-2', 'spectrogram'],
		['setTrackRate', 'selected-track', 96_000],
		['setTrackSampleFormat', 'selected-track', 'float32'],
	]);
});

test('track action adapter preserves explicit null and requested rate or format values', async () => {
	const calls: unknown[][] = [];
	const adapter = createTrackActionAdapter({
		service: {
			addTrack: () => undefined,
			addVideoTrackPair: () => null,
			assignPreferredInputToTrack: () => false,
			addLabelTrack: () => null,
			reorderTrack: () => null,
			moveTrack: (...args: unknown[]) => { calls.push(['moveTrack', ...args]); return null; },
			setTrackDisplayMode: () => undefined,
			setTrackRate: async (...args: unknown[]) => { calls.push(['setTrackRate', ...args]); return null; },
			setTrackSampleFormat: (...args: unknown[]) => { calls.push(['setTrackSampleFormat', ...args]); return null; },
		},
		getSelectedTrackId: () => 'selected-track',
		projectSampleRate: () => 48_000,
	});

	adapter.moveTrack(null, 'down');
	await adapter.setTrackRate(null, 44_100);
	adapter.setTrackSampleFormat(null, 'int24');
	assert.deepEqual(calls, [
		['moveTrack', null, 'down'],
		['setTrackRate', null, 44_100],
		['setTrackSampleFormat', null, 'int24'],
	]);
});
