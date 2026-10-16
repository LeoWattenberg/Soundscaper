/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { TrackControls } from '../src/common/editor/ui/timeline/TrackControls.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import type { ParameterAddress } from '../src/common/editor/parameter-address.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const parameter of ['gain', 'pan'] as const) test(`track header ${parameter} previews one static gesture and publishes only its release`, async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as Element);
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = { react: globals.React, act: globals.IS_REACT_ACT_ENVIRONMENT };
	globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const published: unknown[] = [], previewed: number[] = [], committed: number[] = [], canceled: ParameterAddress[] = [];
	const controller = { getSnapshot: () => ({ project: { id: 'project' } }), getTelemetrySnapshot: () => ({ meters: {} }),
		subscribeTelemetry: () => () => undefined, actions: {
		track: { update: (_id: string, changes: unknown) => published.push(changes) }, timeline: { selectTrack() {} },
		mixer: {
			beginParameterGesture: (address: ParameterAddress) => { assert.deepEqual(address, { kind: 'strip', strip: { kind: 'track', id: 'track' }, parameterId: parameter }); return parameter === 'gain' ? 1 : 0; },
			previewParameterGesture: (_address: ParameterAddress, value: number) => previewed.push(value),
			commitParameterGesture: (_address: ParameterAddress, value: number) => committed.push(value),
			cancelParameterGesture: (address: ParameterAddress) => canceled.push(address),
		},
	} };
	try {
		await act(async () => root.render(<TrackControls controller={controller} track={{ id: 'track', name: 'Voice', gain: 1, pan: 0 }}
			trackHeight={180} panelWidth={240} selected blocked={false} showArmControls={false} displayAudioSupported={false}
			recordingInputs={[]} automationTargets={[]} automationTarget={undefined} automationRuntime={undefined}
			isFlatNavigation={false} copy={ENGLISH_COPY} run={(operation: () => unknown) => operation()}
			onMenu={() => undefined} onOpenEffects={() => undefined} onAutomationTarget={() => undefined}
			onTabOut={() => undefined} onShiftTabOut={() => undefined} onNavigateVertical={() => undefined} />));
		const control = dom.one(parameter === 'gain' ? '.slider__input' : '.knob');
		if (parameter === 'gain') {
			await act(async () => { reactProps(control).onPointerDown({ pointerId: 7, button: 0, isPrimary: true, preventDefault() {} }); });
			for (const value of ['70', '60', '50']) await act(async () => { reactProps(control).onChange({ target: { value } }); });
			assert.deepEqual(published, []); assert.equal(previewed.length, 3); assert.deepEqual(committed, []);
			await act(async () => { reactProps(control).onPointerUp({ pointerId: 7 }); });
		} else {
			await act(async () => { reactProps(control).onKeyDown({ key: 'ArrowRight', preventDefault() {}, stopPropagation() {} }); });
			assert.deepEqual(published, []); assert.equal(previewed.length, 1); assert.deepEqual(committed, []);
			await act(async () => { reactProps(control).onKeyUp({ key: 'ArrowRight' }); });
		}
		assert.equal(committed.length, 1); assert.deepEqual(published, []); assert.deepEqual(canceled, []);
		await act(async () => { reactProps(control).onKeyDown({ key: 'ArrowRight', preventDefault() {}, stopPropagation() {} }); });
		await act(async () => { reactProps(control).onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {} }); });
		await act(async () => { reactProps(control).onKeyUp({ key: 'ArrowRight' }); });
		assert.equal(committed.length, 1); assert.equal(canceled.length, 1);
	} finally {
		await act(async () => root.unmount()); dom.restore(); globals.React = previous.react; globals.IS_REACT_ACT_ENVIRONMENT = previous.act;
	}
});
