/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import PreferenceNumberInput from '../src/common/editor/ui/dialogs/PreferenceNumberInput.tsx';
import WaveformPreferencesPage from '../src/common/editor/ui/dialogs/WaveformPreferencesPage.tsx';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

test('bounded preference cancellation restores its value and rejects the following stale blur', async () => {
	const writes: number[] = [];
	await withMounted(<PreferenceNumberInput label="Precision" value={5} minimum={1} maximum={100}
		integer onCommit={value => { writes.push(value); }} />, async dom => {
		const input = dom.one('input');
		await change(input, '12');
		const escape = keyEvent('Escape');
		await act(async () => {
			const handlers = reactProps(input);
			handlers.onKeyDown?.(escape);
			handlers.onBlur?.({});
		});
		assert.deepEqual(writes, []);
		assert.equal(input.value, '5');
		assert.equal(escape.prevented, true);
		assert.equal(escape.stopped, true);
		const idle = keyEvent('Escape');
		await act(async () => { reactProps(input).onKeyDown?.(idle); });
		assert.equal(idle.prevented || idle.stopped, false, 'the clean field leaves modal dismissal available');
		await change(input, '12');
		await act(async () => { reactProps(input).onBlur?.({}); });
		assert.deepEqual(writes, [12], 'a fresh edit can commit after cancellation');
	});
});

test('invalid bounded drafts still restore the saved value without publication', async () => {
	const writes: number[] = [];
	await withMounted(<PreferenceNumberInput label="Precision" value={5} minimum={1} maximum={100}
		integer onCommit={value => { writes.push(value); }} />, async dom => {
		const input = dom.one('input');
		for (const invalid of ['', '101', '1.5']) {
			await change(input, invalid);
			await act(async () => { reactProps(input).onBlur?.({}); });
			assert.equal(input.value, '5');
		}
		assert.deepEqual(writes, []);
	});
});

test('waveform crossover cancellation restores the atomic pair before any pending blur', async () => {
	const writes: unknown[] = [];
	await withMounted(<WaveformPreferencesPage copy={ENGLISH_COPY}
		preferences={{ waveformVisualization: { lowMidCrossoverHz: 250, midHighCrossoverHz: 4_000 } }}
		controller={{ actions: { preferences: { update: patch => { writes.push(patch); } } } }}
		run={operation => operation()} />, async dom => {
		const input = dom.one('[aria-label="Low/mid crossover (Hz)"]');
		await change(input, '300');
		const escape = keyEvent('Escape');
		await act(async () => {
			const handlers = reactProps(input);
			handlers.onKeyDown?.(escape);
			handlers.onBlur?.({});
		});
		assert.equal(input.value, '250');
		assert.deepEqual(writes, []);
		assert.equal(escape.prevented && escape.stopped, true);
		const idle = keyEvent('Escape');
		await act(async () => { reactProps(input).onKeyDown?.(idle); });
		assert.equal(idle.prevented || idle.stopped, false);
		await change(input, '350');
		await act(async () => { reactProps(input).onKeyDown?.(keyEvent('Enter')); });
		assert.deepEqual(writes, [{ waveformVisualization: { lowMidCrossoverHz: 350, midHighCrossoverHz: 4_000 } }]);
	});
});

async function change(input: ReactTestElement, value: string): Promise<void> {
	await act(async () => { reactProps(input).onChange?.({ currentTarget: { value } }); });
}

function keyEvent(key: string) {
	return { key, prevented: false, stopped: false,
		preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
}

async function withMounted(view: React.ReactNode, check: (dom: ReturnType<typeof installReactTestDom>) => Promise<void>): Promise<void> {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as HTMLElement);
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	try {
		await act(async () => { root.render(view); });
		await check(dom);
	} finally {
		await act(async () => { root.unmount(); });
		dom.restore();
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
	}
}
