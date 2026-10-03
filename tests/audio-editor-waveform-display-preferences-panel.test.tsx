/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import WaveformDisplayPreferencesPanel from '../src/common/editor/ui/dialogs/WaveformDisplayPreferencesPanel.tsx';
import { ENGLISH_COPY, GERMAN_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

(globalThis as unknown as { React: unknown }).React = React;

test('waveform display preferences show saved values and respect preference write access', () => {
	for (const copy of [ENGLISH_COPY, GERMAN_COPY]) {
		const markup = renderToStaticMarkup(<WaveformDisplayPreferencesPanel
			controller={controller([])}
			preferences={{ waveformDisplay: { rulerFormat: 'logarithmic-db', halfWave: true } }}
			showRms
			copy={copy}
			run={(operation) => operation()}
			disabled
		/>);
		assert.ok(markup.includes(copy.preferencesWaveform));
		assert.ok(markup.includes(copy.waveformShowRms));
		assert.ok(markup.includes(copy.waveformRulerFormat));
		assert.ok(markup.includes(copy.waveformLogarithmicDb));
		assert.ok(markup.includes(copy.halfWave));
		assert.equal([...markup.matchAll(/aria-checked="true"/gu)].length, 2);
		assert.equal([...markup.matchAll(/aria-disabled="true"/gu)].length, 2);
		assert.match(markup, /dropdown__trigger[^>]*disabled/u);
	}
});

test('waveform display controls reuse the RMS action and persist individual defaults', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const calls: unknown[] = [];
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<WaveformDisplayPreferencesPanel
			controller={controller(calls)}
			preferences={{ waveformDisplay: { rulerFormat: 'linear-db', halfWave: false } }}
			showRms={false}
			copy={ENGLISH_COPY}
			run={(operation) => { calls.push('run'); return operation(); }}
		/>));
		await clickCheckbox(dom.container, 'Show RMS');
		await clickCheckbox(dom.container, 'Half-wave');
		const trigger = dom.container.querySelector('.dropdown__trigger');
		assert.ok(trigger);
		await act(async () => reactProps(trigger).onClick({}));
		const body = document.body as unknown as ReactTestElement;
		assert.deepEqual(body.querySelectorAll('[role="option"]').map((option) => option.textContent), [
			'Linear dB', 'Linear amp', 'Logarithmic dB',
		]);
		const option = body.querySelectorAll('[role="option"]')
			.find((candidate) => candidate.textContent === 'Logarithmic dB');
		assert.ok(option);
		await act(async () => reactProps(option).onClick({}));
		assert.deepEqual(calls, [
			'run', 'toggleRms',
			'run', { waveformDisplay: { halfWave: true } },
			'run', { waveformDisplay: { rulerFormat: 'logarithmic-db' } },
		]);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		dom.restore();
	}
});

test('the Half-wave default view is checked and can be disabled from waveform preferences', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const calls: unknown[] = [];
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<WaveformDisplayPreferencesPanel
			controller={controller(calls)}
			preferences={{
				appearance: { defaultView: 'half-wave' },
				waveformDisplay: { rulerFormat: 'linear-db', halfWave: false },
			}}
			showRms={false} copy={ENGLISH_COPY} run={(operation) => operation()}
		/>));
		const checkbox = dom.container.querySelectorAll('[role="checkbox"]')
			.find((candidate) => candidate.getAttribute('aria-label') === 'Half-wave');
		assert.ok(checkbox);
		assert.equal(checkbox.getAttribute('aria-checked'), 'true');
		await clickCheckbox(dom.container, 'Half-wave');
		assert.deepEqual(calls, [
			['setDefaultView', 'waveform'], { waveformDisplay: { halfWave: false } },
		]);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		dom.restore();
	}
});

function controller(calls: unknown[]) {
	return { actions: {
		preferences: {
			update: (patch: Readonly<Record<string, unknown>>) => { calls.push(patch); },
			setDefaultView: (view: string) => { calls.push(['setDefaultView', view]); },
		},
		timeline: { toggleRms: () => { calls.push('toggleRms'); } },
	} };
}

async function clickCheckbox(container: ReactTestElement, label: string): Promise<void> {
	const checkbox = container.querySelectorAll('[role="checkbox"]')
		.find((candidate) => candidate.getAttribute('aria-label') === label);
	assert.ok(checkbox, `Missing checkbox ${label}`);
	await act(async () => {
		reactProps(checkbox).onClick({});
		await Promise.resolve();
	});
}
