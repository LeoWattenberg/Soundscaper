/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudacitySpectralActionRuntime } from '../src/common/editor/controller/audacity-spectral-action-runtime.ts';

test('spectral selection toggles between the native box and a time-only selection', () => {
	let project: Record<string, unknown> = { selection: null };
	const calls: unknown[] = [];
	const actions = createAudacitySpectralActionRuntime({
		getProject: () => project,
		setSelection: (...args) => { calls.push(args); return args; },
		spectralActions: { boxSelect: () => { calls.push('box'); return 'box'; } },
		openSurface: (surface) => surface,
		getUiFlags: () => ({}),
		setUiFlag: () => false,
	});

	assert.equal(actions.toggleSpectralSelection(), 'box');
	project = { selection: {
		startFrame: 10,
		endFrame: 20,
		trackIds: ['audio'],
		frequencyRange: { minimumFrequency: 100, maximumFrequency: 1_000 },
	} };
	actions.toggleSpectralSelection();
	assert.deepEqual(calls, [
		'box',
		[10, 20, { trackIds: ['audio'], frequencyRange: null }],
	]);
});

test('spectral brush activation is session-only and excludes the split tool', () => {
	let flags = { spectralBrush: false, splitTool: true };
	const changes: Array<readonly [string, boolean]> = [];
	const actions = createAudacitySpectralActionRuntime({
		getProject: () => null,
		setSelection: () => null,
		spectralActions: { boxSelect: () => null },
		openSurface: (surface) => surface,
		getUiFlags: () => flags,
		setUiFlag: (name, value) => {
			changes.push([name, value]);
			flags = { ...flags, [name]: value };
			return value;
		},
	});

	assert.equal(actions.openSpectralSelection(), 'spectral-selection');
	assert.equal(actions.toggleSpectralBrush(), true);
	assert.deepEqual(changes, [['splitTool', false], ['spectralBrush', true]]);
	assert.equal(actions.toggleSpectralBrush(), false);
	assert.deepEqual(changes.at(-1), ['spectralBrush', false]);
});
