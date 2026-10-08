/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AudacityLabelMarker } from '../src/common/editor/ui/timeline/LabelTrackRow.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps, ReactTestElement } from './helpers/react-test-dom.ts';

for (const key of ['Enter', 'Escape']) test(`timeline label keeps native composing ${key}`, async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const priorSelect = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'select');
	Object.defineProperty(ReactTestElement.prototype, 'select', { configurable: true, value() {} });
	const root = createRoot(dom.container as unknown as Element);
	const commits: unknown[] = [];
	let finished = 0;
	const noop = () => undefined;
	try {
		await act(async () => root.render(<AudacityLabelMarker
			controller={{ getSnapshot: () => ({ project: { schemaFamily: 'soundscaper' } }), actions: {
				labels: { update: (trackId: string, labelId: string, changes: unknown) => commits.push({ trackId, labelId, changes }) },
				edit: {}, timeline: { selectTrack: noop, setExactSelection: noop },
			} }} trackId="labels" label={{ id: 'label', title: 'Intro', startFrame: 0, endFrame: 0 }}
			left={0} trackHeight={100} pixelsPerSecond={100} sampleRate={48_000} laneRef={{ current: null }}
			selected={true} editing={true} blocked={false} copy={ENGLISH_COPY} run={(operation: () => unknown) => operation()}
			onSelect={noop} onEdit={noop} onFinishEdit={() => { finished += 1; }} onRemove={noop} />));
		const input = dom.one('input');
		Object.defineProperty(input, 'blur', { configurable: true, value: () => {
			input.ownerDocument.activeElement = input.ownerDocument.body;
			reactProps(input).onBlur?.({ currentTarget: input });
		} });
		input.value = 'とう';
		await act(async () => { reactProps(input).onKeyDown?.({ key, currentTarget: input,
			nativeEvent: { isComposing: true }, stopPropagation() {} }); });
		assert.equal(input.ownerDocument.activeElement, input);
		assert.equal(input.value, 'とう');
		assert.deepEqual(commits, []);
		assert.equal(finished, 0);
		input.value = '東京の場面';
		await act(async () => { reactProps(input).onKeyDown?.({ key: 'Enter', currentTarget: input,
			nativeEvent: { isComposing: false }, stopPropagation() {} }); });
		assert.deepEqual(commits, [{ trackId: 'labels', labelId: 'label', changes: { title: '東京の場面' } }]);
		assert.equal(finished, 1);
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact); else Reflect.deleteProperty(globalThis, 'React');
		if (priorSelect) Object.defineProperty(ReactTestElement.prototype, 'select', priorSelect); else Reflect.deleteProperty(ReactTestElement.prototype, 'select');
		dom.restore();
	}
});
