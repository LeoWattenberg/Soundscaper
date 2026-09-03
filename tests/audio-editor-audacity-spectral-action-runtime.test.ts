/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudacitySpectralActionRuntime } from '../src/common/editor/controller/audacity-spectral-action-runtime.ts';

test('spectral selection restores its prior frequency band after a time-only toggle', () => {
	let project: Record<string, unknown> = { id: 'project-a', selection: null };
	const calls: unknown[] = [];
	const actions = createAudacitySpectralActionRuntime({
		getProject: () => project,
		setSelection: (startFrame, endFrame, details) => {
			calls.push([startFrame, endFrame, details]);
			project = { ...project, selection: { startFrame, endFrame, ...details } };
			return details;
		},
		spectralActions: { boxSelect: () => { calls.push('box'); return 'box'; } },
		openSurface: (surface) => surface,
		getUiFlags: () => ({}),
		setUiFlag: () => false,
	});

	assert.equal(actions.toggleSpectralSelection(), 'box');
	project = { id: 'project-a', selection: {
		startFrame: 10,
		endFrame: 20,
		trackIds: ['audio'],
		frequencyRange: { minimumFrequency: 100, maximumFrequency: 1_000 },
	} };
	actions.toggleSpectralSelection();
	actions.toggleSpectralSelection();
	assert.deepEqual(calls, [
		'box',
		[10, 20, { trackIds: ['audio'], frequencyRange: null }],
		[10, 20, {
			trackIds: ['audio'],
			frequencyRange: { minimumFrequency: 100, maximumFrequency: 1_000 },
		}],
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

test('remembered spectral bands remain scoped to each open project', () => {
	const projects = new Map<string, { id: string; selection: {
		startFrame: number;
		endFrame: number;
		trackIds?: readonly string[];
		frequencyRange?: { minimumFrequency: number; maximumFrequency: number } | null;
	} }>([
		['project-a', {
			id: 'project-a',
			selection: { startFrame: 1, endFrame: 2, trackIds: ['a'], frequencyRange: {
				minimumFrequency: 100, maximumFrequency: 1_000,
			} },
		}],
		['project-b', {
			id: 'project-b',
			selection: { startFrame: 3, endFrame: 4, trackIds: ['b'], frequencyRange: {
				minimumFrequency: 300, maximumFrequency: 3_000,
			} },
		}],
	]);
	let activeId = 'project-a';
	const actions = createAudacitySpectralActionRuntime({
		getProject: () => projects.get(activeId),
		setSelection: (startFrame, endFrame, details) => {
			projects.set(activeId, { id: activeId, selection: { startFrame, endFrame, ...details } });
			return details;
		},
		spectralActions: { boxSelect: () => 'box' },
		openSurface: (surface) => surface,
		getUiFlags: () => ({}),
		setUiFlag: () => false,
	});

	actions.toggleSpectralSelection();
	activeId = 'project-b';
	actions.toggleSpectralSelection();
	activeId = 'project-a';
	actions.toggleSpectralSelection();
	assert.deepEqual(projects.get('project-a')?.selection.frequencyRange, {
		minimumFrequency: 100,
		maximumFrequency: 1_000,
	});
});
