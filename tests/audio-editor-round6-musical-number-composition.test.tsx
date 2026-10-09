/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MusicalTimelineControls } from '../src/common/editor/ui/toolbar/MusicalTimelineControls.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const key of ['Enter', 'Escape']) test(`musical numeric drafts retain native composing ${key}`, async () => {
	const dom = installReactTestDom();
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const commits: unknown[] = [];
	const project = { sampleRate: 48_000, tempo: { bpm: 120 },
		tempoMap: { mode: 'musical', events: [{ id: 'tempo', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }] },
		signatureMap: { events: [{ id: 'signature', bar: 0, numerator: 4, denominator: 4 }] } };
	const controller = { actions: { project: {
		updateTempoEvent: (_id: string, change: unknown) => { commits.push(change); },
		updateSignatureEvent: (_id: string, change: unknown) => { commits.push(change); },
	} } };
	try {
		await act(async () => { root.render(<MusicalTimelineControls project={project} snapshot={{ readOnly: false, recording: false }}
			controller={controller} copy={ENGLISH_COPY} run={(command: () => unknown) => command()} />); });
		const input = dom.one('[data-action-id="playback-bpm"]').querySelector('input');
		assert.ok(input);
		input.focus();
		input.value = '130';
		let prevented = false;
		await act(async () => { reactProps(input).onKeyDown({ key, currentTarget: input, nativeEvent: { isComposing: true },
			preventDefault: () => { prevented = true; } }); });
		assert.equal(input.value, '130');
		assert.deepEqual(commits, []);
		assert.equal(prevented, false);
		assert.equal(dom.container.ownerDocument.activeElement, input);
		await act(async () => { reactProps(input).onKeyDown({ key: 'Enter', currentTarget: input, nativeEvent: { isComposing: false },
			preventDefault: () => { prevented = true; } }); });
		assert.deepEqual(commits, [{ bpm: { num: 130, den: 1 } }]);
		assert.equal(prevented, true);
		input.value = '140';
		await act(async () => { reactProps(input).onKeyDown({ key: 'Escape', currentTarget: input, nativeEvent: { isComposing: false },
			preventDefault: () => undefined }); });
		assert.equal(input.value, '120', 'ordinary Escape retains the existing authoritative value');
		assert.equal(commits.length, 1);
	} finally {
		await act(async () => { root.unmount(); });
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
