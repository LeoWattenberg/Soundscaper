/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';

import AudioEditorTimeCodeInput from '../src/common/editor/ui/AudioEditorTimeCodeInput.tsx';
import {
	audioEditorProjectFrameRate,
	audioEditorProjectSampleRate,
	clampAudioEditorTimeValue,
	timeCodeSecondsFromEditorValue,
	timeCodeSecondsToEditorValue,
} from '../src/common/editor/ui/AudioEditorTimeCodeInput.tsx';
import { timeCodeFormatOptionsForDomain } from
	'../vendor/audacity-design-system/components/src/TimeCode/TimeCode.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('timecode input converts seconds, samples, and frames through their owning rates', () => {
	assert.equal(timeCodeSecondsFromEditorValue(1.25, 'seconds', 48_000), 1.25);
	assert.equal(timeCodeSecondsFromEditorValue(1_250, 'milliseconds', 48_000), 1.25);
	assert.equal(timeCodeSecondsFromEditorValue(60_000, 'samples', 48_000), 1.25);
	assert.equal(timeCodeSecondsFromEditorValue(30, 'frames', 24), 1.25);

	assert.equal(timeCodeSecondsToEditorValue(1.25, 'seconds', 48_000), 1.25);
	assert.equal(timeCodeSecondsToEditorValue(1.25, 'milliseconds', 48_000), 1_250);
	assert.equal(timeCodeSecondsToEditorValue(1.25, 'samples', 48_000), 60_000);
	assert.equal(timeCodeSecondsToEditorValue(1.25, 'frames', 24), 30);
});

test('timecode input rounds discrete units and clamps edits in the caller unit', () => {
	assert.equal(timeCodeSecondsToEditorValue(1 / 48_000 / 2, 'samples', 48_000), 1);
	assert.equal(timeCodeSecondsToEditorValue(1 / 60, 'frames', 30), 1);
	assert.equal(clampAudioEditorTimeValue(-1, 0, 10), 0);
	assert.equal(clampAudioEditorTimeValue(11, 0, 10), 10);
	assert.equal(clampAudioEditorTimeValue(5, 0, 10), 5);
});

test('timecode input refuses invalid values and rates instead of leaking NaN into editors', () => {
	assert.throws(() => timeCodeSecondsFromEditorValue(Number.NaN, 'seconds', 48_000), /finite/u);
	assert.throws(() => timeCodeSecondsFromEditorValue(1, 'samples', 0), /positive finite rate/u);
	assert.throws(() => timeCodeSecondsToEditorValue(1, 'frames', Number.NaN), /positive finite rate/u);
});

test('timecode input resolves project sample and sequence frame rates with safe fallbacks', () => {
	assert.equal(audioEditorProjectSampleRate({ sampleRate: 96_000 }), 96_000);
	assert.equal(audioEditorProjectSampleRate({ sampleRate: 0 }), 48_000);
	assert.equal(audioEditorProjectFrameRate({
		primarySequenceId: 'b',
		sequences: [{ id: 'a', rate: { num: 24, den: 1 } }, { id: 'b', rate: { num: 30_000, den: 1_001 } }],
	}), 30_000 / 1_001);
	assert.equal(audioEditorProjectFrameRate({ sequences: [] }), 24);
});

test('timecode dropdown domains keep Hz exclusive to frequencies', () => {
	const timeFormats = timeCodeFormatOptionsForDomain('time').map(({ format }) => format);
	const frequencyFormats = timeCodeFormatOptionsForDomain('frequency').map(({ format }) => format);
	assert.equal(timeFormats.includes('Hz'), false);
	assert.deepEqual(frequencyFormats, ['Hz']);
});

test('a rejected timecode commit does not erase an edit made while it was pending', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let rejectFirst!: (accepted: boolean) => void;
	const firstCommit = new Promise<boolean>((resolve) => { rejectFirst = resolve; });
	try {
		await act(async () => root.render(React.createElement(AudioEditorTimeCodeInput, {
			label: 'Start', value: 0, onCommit: () => firstCommit,
		})));
		const input = dom.one('[data-timecode-direct-entry="true"]');
		const wrapper = dom.one('.audio-editor-timecode-input');
		await act(async () => reactProps(input).onChange({ currentTarget: { valueAsNumber: 10 } }));
		await act(async () => reactProps(wrapper).onBlur({ currentTarget: wrapper, relatedTarget: null }));
		await act(async () => reactProps(input).onChange({ currentTarget: { valueAsNumber: 20 } }));
		await act(async () => { rejectFirst(false); await firstCommit; });
		assert.equal(input.value, '20');
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
