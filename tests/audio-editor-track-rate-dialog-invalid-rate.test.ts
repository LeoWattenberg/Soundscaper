/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';

import EditorDialog from '../src/common/editor/ui/dialogs/EditorDialog.jsx';
import {
	applyTrackRateDialog,
	parseTrackSampleRate,
	TRACK_RATE_DIALOG_INVALID_RATE,
} from '../src/common/editor/ui/dialogs/editor-dialog-model.js';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import {
	installReactTestDom, reactProps, type ReactTestElement,
} from './helpers/react-test-dom.ts';

// The rate field is free text, so anything typed into it reaches the action.
// The controller normalises an unusable rate to the editor default and then
// resamples every source that differs, so a refused entry has to stop at the
// dialog rather than convert the track to a rate nobody asked for.
const REFUSED_RATES = ['', '   ', '44,100', '44.1', '500000', '7999', 'abc', '48000abc'];

test('the track-rate dialog model refuses a rate the controller would silently replace', () => {
	for (const value of REFUSED_RATES) {
		const calls: unknown[][] = [];
		const applied = applyTrackRateDialog({
			trackId: 'track-a',
			value,
			run: (operation: () => unknown) => operation(),
			setRate: (...args: unknown[]) => { calls.push(args); return Promise.resolve('track-a'); },
		});
		assert.equal(applied, TRACK_RATE_DIALOG_INVALID_RATE, `${JSON.stringify(value)} must be refused`);
		assert.deepEqual(calls, [], `${JSON.stringify(value)} must not reach the controller`);
		assert.equal(parseTrackSampleRate(value), null);
	}
});

test('the track-rate dialog model still applies a rate inside the supported range', () => {
	const accepted = [['96000', 96_000], [' 44100 ', 44_100], ['8000', 8_000], ['384000', 384_000]] as const;
	for (const [value, expected] of accepted) {
		const calls: unknown[][] = [];
		applyTrackRateDialog({
			trackId: 'track-a',
			value,
			run: (operation: () => unknown) => operation(),
			setRate: (...args: unknown[]) => { calls.push(args); return Promise.resolve('track-a'); },
		});
		assert.deepEqual(calls, [['track-a', expected]]);
		assert.equal(parseTrackSampleRate(value), expected);
	}
});

test('the resample dialog refuses to convert a track on a rate it cannot parse', async () => {
	const fixture = await mountedResampleDialog();
	try {
		await fixture.render('44,100');
		assert.equal(
			fixture.confirmButton().hasAttribute('disabled'),
			true,
			'an unusable rate must not offer a resample',
		);
		await fixture.submit();
		assert.deepEqual(fixture.resampleCalls, [], 'submitting must not resample to a substituted rate');
		assert.equal(fixture.closes, 0, 'the dialog stays open so the entry can be corrected');

		await fixture.render('96000');
		assert.equal(fixture.confirmButton().hasAttribute('disabled'), false);
		await fixture.submit();
		assert.deepEqual(fixture.resampleCalls, [['track-a', 96_000]]);
	} finally {
		await fixture.cleanup();
	}
});

async function mountedResampleDialog() {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const resampleCalls: unknown[][] = [];
	const state = { closes: 0 };
	const controller = {
		actions: {
			track: {
				resample: (...args: unknown[]) => { resampleCalls.push(args); return Promise.resolve('track-a'); },
			},
		},
	};
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	return {
		resampleCalls,
		get closes() { return state.closes; },
		render: async (value: string) => {
			await act(async () => root.render(React.createElement(EditorDialog, {
				type: 'resample',
				value,
				onValueChange: () => undefined,
				onSourceKeyChange: () => undefined,
				trackId: 'track-a',
				controller,
				snapshot: { project: { id: 'project-a' }, selectedTrackId: 'track-a', recordingInputs: {} },
				copy: ENGLISH_COPY,
				aboutLabel: 'About',
				locale: 'en',
				run: (operation: () => unknown) => operation(),
				onClose: () => { state.closes += 1; },
			})));
		},
		confirmButton: (): ReactTestElement => {
			const button = dom.container.querySelectorAll('button')
				.find((candidate) => candidate.textContent === ENGLISH_COPY.resample);
			assert.ok(button, 'the resample dialog confirms through the shared footer');
			return button;
		},
		submit: async () => {
			await act(async () => {
				reactProps(dom.one('form')).onSubmit({ preventDefault: () => undefined });
				await Promise.resolve();
				await Promise.resolve();
				await Promise.resolve();
			});
		},
		cleanup: async () => {
			await act(async () => root.unmount());
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		},
	};
}
