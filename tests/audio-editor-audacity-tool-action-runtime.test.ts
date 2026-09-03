/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createAudacityClipPitchActionRuntime,
	createAudacityToolActionRuntime,
} from '../src/common/editor/controller/audacity-tool-action-runtime.ts';

test('Audacity selection and persistent tools keep one exclusive pointer mode', () => {
	let snapshot = { sampleEdit: { available: true, mode: 'pencil' as string | null } };
	let flags = { automationTool: true, spectralBrush: true, splitTool: true };
	const changes: Array<readonly [string, boolean | null]> = [];
	const tools = createAudacityToolActionRuntime({
		getSnapshot: () => snapshot,
		getProject: () => null,
		setSelection: () => null,
		spectralActions: { boxSelect: () => null },
		openSurface: () => null,
		setSampleEditMode: (mode) => {
			changes.push(['pencil', mode === 'pencil']);
			snapshot = { ...snapshot, sampleEdit: { ...snapshot.sampleEdit, mode } };
			return mode;
		},
		getUiFlags: () => flags,
		setUiFlag: (name, value) => {
			changes.push([name, value]);
			flags = { ...flags, [name]: value };
			return value;
		},
	});

	tools.selectTool();
	assert.deepEqual(changes, [
		['pencil', false],
		['automationTool', false],
		['spectralBrush', false],
		['splitTool', false],
	]);

	changes.length = 0;
	assert.equal(tools.drawTool(), 'pencil');
	assert.deepEqual(changes, [['pencil', true]]);
	assert.equal(tools.toggleSplitTool(), true);
	assert.deepEqual(changes.slice(-2), [['pencil', false], ['splitTool', true]]);
	assert.equal(tools.toggleAutomationTool(), true);
	assert.deepEqual(changes.slice(-2), [['splitTool', false], ['automationTool', true]]);
});

test('Audacity Draw Tool refuses to arm outside native sample-edit availability', () => {
	const changes: Array<string | null> = [];
	const tools = createAudacityToolActionRuntime({
		getSnapshot: () => ({ sampleEdit: { available: false, mode: null } }),
		getProject: () => null,
		setSelection: () => null,
		spectralActions: { boxSelect: () => null },
		openSurface: () => null,
		setSampleEditMode: (mode) => { changes.push(mode); return mode; },
		getUiFlags: () => ({ automationTool: false, spectralBrush: false, splitTool: false }),
		setUiFlag: (_name, value) => value,
	});

	assert.equal(tools.drawTool(), null);
	assert.deepEqual(changes, []);
});

test('Audacity pitch shortcuts change the selected clip by one semitone and stop at limits', () => {
	let clip = { id: 'clip-1', kind: 'audio', pitchCents: 200 };
	const changes: Array<readonly [string, Readonly<{ pitchCents: number }>]> = [];
	const pitch = createAudacityClipPitchActionRuntime({
		getSelectedClip: () => clip,
		setTimePitch: (clipId, change) => {
			changes.push([clipId, change]);
			clip = { ...clip, ...change };
			return change.pitchCents;
		},
	});

	assert.equal(pitch.pitchUp(), 300);
	assert.equal(pitch.pitchDown(), 200);
	clip = { ...clip, pitchCents: 1_200 };
	assert.equal(pitch.pitchUp(), null);
	clip = { ...clip, pitchCents: -1_200 };
	assert.equal(pitch.pitchDown(), null);
	clip = { ...clip, pitchCents: 1_150 };
	assert.equal(pitch.pitchUp(), null, 'a shortcut step never truncates to fifty cents');
	clip = { ...clip, pitchCents: -1_150 };
	assert.equal(pitch.pitchDown(), null, 'a shortcut step never truncates to fifty cents');
	clip = { ...clip, kind: 'video', pitchCents: 0 };
	assert.equal(pitch.pitchUp(), null);
	assert.deepEqual(changes, [
		['clip-1', { pitchCents: 300 }],
		['clip-1', { pitchCents: 200 }],
	]);
});
