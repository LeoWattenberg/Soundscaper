/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AudacityLabelMarker } from '../src/common/editor/ui/timeline/LabelTrackRow.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps, ReactTestElement } from './helpers/react-test-dom.ts';

void test('timeline label title retains native text context actions without selecting the label', async () => {
	const dom = installReactTestDom();
	const descriptors = ['React', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
	const oldSelect = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'select');
	Object.defineProperty(ReactTestElement.prototype, 'select', { configurable: true, value() {} });
	const root = createRoot(dom.container as unknown as Element);
	let selected = 0;
	const noop = () => undefined;
	try {
		await act(async () => root.render(<AudacityLabelMarker
			controller={{ getSnapshot: () => ({ project: { schemaFamily: 'soundscaper' } }), actions: {
				labels: { update: noop }, edit: {}, timeline: { selectTrack: noop, setExactSelection: noop },
			} }} trackId="labels" label={{ id: 'intro', title: 'Intro', startFrame: 0, endFrame: 100 }}
			left={0} trackHeight={100} pixelsPerSecond={100} sampleRate={48_000} laneRef={{ current: null }}
			selected={true} editing={true} blocked={false} copy={ENGLISH_COPY} run={(operation: () => unknown) => operation()}
			onSelect={() => { selected += 1; }} onEdit={noop} onFinishEdit={noop} onRemove={noop} />));
		const marker = dom.one('[data-label-id]');
		const input = dom.one('input');
		input.value = 'Draft intro';
		let prevented = 0;
		await act(async () => {
			reactProps(marker).onContextMenu?.({ target: input, currentTarget: marker, clientX: 20, clientY: 40,
				preventDefault: () => { prevented += 1; }, stopPropagation: noop });
			assert.equal(prevented, 0);
		});
		assert.equal(selected, 0);
		assert.equal(input.value, 'Draft intro');
	} finally {
		await act(async () => root.unmount());
		for (const [key, descriptor] of descriptors) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else Reflect.deleteProperty(globalThis, key);
		}
		if (oldSelect) Object.defineProperty(ReactTestElement.prototype, 'select', oldSelect);
		else Reflect.deleteProperty(ReactTestElement.prototype, 'select');
		dom.restore();
	}
});
