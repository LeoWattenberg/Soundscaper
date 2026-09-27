/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';

import RealtimeAnalysisPanel from '../src/common/editor/ui/inspector/RealtimeAnalysisPanel.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { DEFAULT_PLAYBACK_METER_SETTINGS } from '../src/common/editor/ui/meter-settings.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

(globalThis as unknown as { React: unknown }).React = React;

test('live analyzers subscribe and paint only while their sections are expanded', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	let subscribers = 0;
	let visualLeases = 0;
	const telemetry = { meters: { master: {
		peak: 0.5, rms: 0.25, dbfs: -6,
		spectrumDb: Object.freeze([-90, -30, -12]),
	} } };
	const controller = {
		engine: { acquireLiveAnalysis: () => {
			visualLeases += 1;
			return () => { visualLeases -= 1; };
		} },
		getTelemetrySnapshot: () => telemetry,
		subscribeTelemetry: (_listener: () => void) => {
			subscribers += 1;
			return () => { subscribers -= 1; };
		},
	};
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<RealtimeAnalysisPanel controller={controller} copy={ENGLISH_COPY} settings={DEFAULT_PLAYBACK_METER_SETTINGS} />));
		assert.deepEqual(
			dom.container.querySelectorAll('[data-analysis-section]').map((node) => node.getAttribute('data-analysis-section')),
			['levels', 'loudness', 'spectrum', 'spectrogram', 'correlation'],
		);
		assert.ok(dom.find('[data-live-analysis-levels]'));
		assert.equal(dom.find('[data-live-analysis-spectrum]'), null);
		assert.equal(subscribers, 1, 'only the expanded levels section subscribes to telemetry');
		assert.equal(visualLeases, 0, 'levels alone do not start visual sampling');

		const spectrum = dom.one('[data-analysis-section="spectrum"]');
		await act(async () => reactProps(spectrum).onToggle({ currentTarget: { open: true } }));
		assert.ok(dom.find('[data-live-analysis-spectrum]'));
		assert.equal(subscribers, 2);
		assert.equal(visualLeases, 1);

		const spectrogram = dom.one('[data-analysis-section="spectrogram"]');
		await act(async () => reactProps(spectrogram).onToggle({ currentTarget: { open: true } }));
		assert.equal(visualLeases, 2, 'each expanded visual retains the shared tap');
		await act(async () => reactProps(spectrogram).onToggle({ currentTarget: { open: false } }));
		assert.equal(visualLeases, 1, 'the tap stays active while spectrum remains expanded');

		await act(async () => root.render(<RealtimeAnalysisPanel controller={controller} copy={ENGLISH_COPY} settings={DEFAULT_PLAYBACK_METER_SETTINGS} active={false} />));
		assert.equal(subscribers, 0, 'hidden workspace tabs release every telemetry subscription');
		assert.equal(visualLeases, 0, 'hidden workspace tabs release the analysis lease');
		assert.equal(dom.find('[data-live-analysis-spectrum]'), null);
		assert.equal(dom.one('[data-analysis-section="spectrum"]').getAttribute('open'), '');

		await act(async () => root.render(<RealtimeAnalysisPanel controller={controller} copy={ENGLISH_COPY} settings={DEFAULT_PLAYBACK_METER_SETTINGS} active />));
		assert.ok(dom.find('[data-live-analysis-spectrum]'), 'returning to the tab resumes expanded analyzers');
		assert.equal(subscribers, 2);
		assert.equal(visualLeases, 1);

		await act(async () => reactProps(spectrum).onToggle({ currentTarget: { open: false } }));
		assert.equal(dom.find('[data-live-analysis-spectrum]'), null);
		assert.equal(subscribers, 1, 'collapsing an analyzer releases its live subscription');
		assert.equal(visualLeases, 0, 'collapsing the last visual releases the tap');
	} finally {
		await act(async () => root.unmount());
		assert.equal(subscribers, 0);
		assert.equal(visualLeases, 0);
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previous;
		dom.restore();
	}
});
