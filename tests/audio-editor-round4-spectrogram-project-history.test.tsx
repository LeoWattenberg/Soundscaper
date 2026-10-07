/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import RealtimeAnalysisPanel from '../src/common/editor/ui/inspector/RealtimeAnalysisPanel.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { DEFAULT_PLAYBACK_METER_SETTINGS } from '../src/common/editor/ui/meter-settings.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('project replacement discards the spectrogram canvas without resetting its expanded section or lease', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = globals.IS_REACT_ACT_ENVIRONMENT;
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	let leases = 0;
	const telemetry = { meters: { master: { spectrumDb: Object.freeze([]) } } };
	const controller = {
		getTelemetrySnapshot: () => telemetry,
		subscribeTelemetry: () => () => undefined,
		engine: { acquireLiveAnalysis: () => { leases++; return () => { leases--; }; } },
	};
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const render = async (projectId: string) => {
		await act(async () => root.render(<RealtimeAnalysisPanel controller={controller}
			copy={ENGLISH_COPY} settings={DEFAULT_PLAYBACK_METER_SETTINGS} projectId={projectId} />));
	};
	try {
		await render('recording');
		const section = dom.one('[data-analysis-section="spectrogram"]');
		await act(async () => reactProps(section).onToggle({ currentTarget: { open: true } }));
		const original = dom.one('[data-live-analysis-spectrogram]');
		await render('recording');
		assert.equal(dom.one('[data-live-analysis-spectrogram]'), original, 'same-project updates preserve history');
		await render('new-project');
		assert.notEqual(dom.one('[data-live-analysis-spectrogram]'), original, 'another project receives an empty canvas');
		assert.equal(dom.one('[data-analysis-section="spectrogram"]'), section);
		assert.equal(section.getAttribute('open'), '');
		assert.equal(leases, 1);
	} finally {
		await act(async () => root.unmount());
		assert.equal(leases, 0);
		globals.IS_REACT_ACT_ENVIRONMENT = previous;
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
