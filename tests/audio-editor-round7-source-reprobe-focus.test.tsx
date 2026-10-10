/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { SourcePropertiesPanel } from '../src/common/editor/ui/toolbar/SourcePropertiesPanel.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const outcome of ['unchanged', 'refused'] as const) test(`Source properties restores the keyboard Re-read source action after ${outcome}`, async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as Element);
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	let complete!: (value: unknown) => void;
	let refuse!: (error: Error) => void;
	const pending = new Promise<unknown>((resolve, reject) => { complete = resolve; refuse = reject; });
	try {
		await act(async () => root.render(<SourcePropertiesPanel copy={ENGLISH_COPY}
			source={{ kind: 'video', id: 'source-a', name: 'Ordinary.mp4', width: 1024, height: 576,
				frameRate: { num: 25, den: 1 }, sourceFrameCount: 250, videoCodec: 'h264', audioCodec: null,
				timingDecision: { mode: 'exact', rate: { num: 25, den: 1 }, backend: 'container' } }}
			onReprobe={() => pending} />));
		const control = dom.one('[data-source-reprobe="source-a"]');
		control.focus();
		await act(async () => reactProps(control).onClick());
		assert.equal(control.hasAttribute('disabled'), true);
		// Native browsers blur an active button when the asynchronous operation disables it.
		const document = dom.container.ownerDocument;
		document.body.focus();
		await act(async () => {
			if (outcome === 'unchanged') complete({ upgraded: false });
			else refuse(new Error('A transient read failure'));
			await Promise.resolve();
		});
		assert.equal(control.hasAttribute('disabled'), false);
		assert.equal(document.activeElement === control, true, 'the existing source action remains keyboard usable');
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
