/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import RealtimeAnalysisPanel from '../src/common/editor/ui/inspector/RealtimeAnalysisPanel.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { DEFAULT_PLAYBACK_METER_SETTINGS } from '../src/common/editor/ui/meter-settings.ts';
import { installReactTestDom, ReactTestElement, reactProps } from './helpers/react-test-dom.ts';

for (const bucket of [95, 127, 94, -1]) {
	test(`live Spectrogram paints ${bucket < 0 ? 'silence without a peak' : `frequency bucket ${bucket}`}`, async () => {
		const dom = installReactTestDom();
		const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
		const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
		const previousContext = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'getContext');
		globals.IS_REACT_ACT_ENVIRONMENT = true;
		Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
		const frames: FrameRequestCallback[] = [];
		globalThis.requestAnimationFrame = (callback) => { frames.push(callback); return frames.length; };
		const colors: string[] = [];
		const context = {
			fillStyle: '', canvas: dom.container, drawImage() {},
			fillRect(_x: number, _y: number, _width: number, height: number) {
				if (height === 1) colors.push(this.fillStyle);
			},
		};
		Object.defineProperty(ReactTestElement.prototype, 'getContext', { configurable: true, value: () => context });
		const bins = new Array<number>(128).fill(-120);
		if (bucket >= 0) bins[bucket] = -12;
		const telemetry = { meters: { master: { spectrumDb: Object.freeze(bins) } } };
		const controller = {
			getTelemetrySnapshot: () => telemetry,
			subscribeTelemetry: () => () => undefined,
			engine: { acquireLiveAnalysis: () => () => undefined },
		};
		const { createRoot } = await import('react-dom/client');
		const root = createRoot(dom.container as unknown as Element);
		try {
			await act(async () => root.render(<RealtimeAnalysisPanel controller={controller}
				copy={ENGLISH_COPY} settings={DEFAULT_PLAYBACK_METER_SETTINGS} />));
			const section = dom.one('[data-analysis-section="spectrogram"]');
			await act(async () => reactProps(section).onToggle({ currentTarget: { open: true } }));
			for (const frame of frames) frame(0);
			assert.equal(colors.length, 96, 'the ordinary expanded analyzer paints its whole new column');
			const lightness = colors.map(color => Number(/ (\d+)%\)$/u.exec(color)?.[1]));
			assert.equal(Math.max(...lightness), bucket < 0 ? 7 : 59,
				'every loud frequency bucket must survive reduction into the visible rows');
		} finally {
			await act(async () => root.unmount());
			if (previousContext) Object.defineProperty(ReactTestElement.prototype, 'getContext', previousContext);
			else Reflect.deleteProperty(ReactTestElement.prototype, 'getContext');
			if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
			else Reflect.deleteProperty(globalThis, 'React');
			globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
			dom.restore();
		}
	});
}
