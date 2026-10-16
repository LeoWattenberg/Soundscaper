/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AudacityLabelMarker } from '../src/common/editor/ui/timeline/LabelTrackRow.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps, ReactTestElement } from './helpers/react-test-dom.ts';

async function withMarker(runCase: (marker: ReactTestElement, calls: string[]) => Promise<void>): Promise<void> {
	const dom = installReactTestDom();
	const descriptors = ['React', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
	const oldSelect = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'select');
	Object.defineProperty(ReactTestElement.prototype, 'select', { configurable: true, value() {} });
	const root = createRoot(dom.container as unknown as Element);
	const calls: string[] = [];
	const noop = () => undefined;
	try {
		await act(async () => root.render(<AudacityLabelMarker
			controller={{ getSnapshot: () => ({ project: { schemaFamily: 'soundscaper' } }), actions: {
				labels: { update: noop }, edit: {}, timeline: { selectTrack: noop, setExactSelection: noop },
			} }} trackId="labels" label={{ id: 'intro', title: 'Intro', startFrame: 0, endFrame: 100 }}
			left={0} trackHeight={100} pixelsPerSecond={100} sampleRate={48_000} laneRef={{ current: null }}
			selected={true} editing={false} blocked={false} copy={ENGLISH_COPY} run={(operation: () => unknown) => operation()}
			onSelect={noop} onEdit={() => { calls.push('edit'); }} onFinishEdit={noop} onRemove={() => { calls.push('remove'); }} />));
		await runCase(dom.one('[data-label-id]'), calls);
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
}

for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'defaultPrevented']) {
	test(`native marker releases ${modifier} local key candidates to their owner`, async () => {
		await withMarker(async (marker, calls) => {
			for (const key of ['Enter', 'F2', 'Delete', 'Backspace']) {
				let consumed = 0;
				await act(async () => { reactProps(marker).onKeyDown({ key, [modifier]: true,
					preventDefault() { consumed++; }, stopPropagation() { consumed++; } }); });
				assert.deepEqual(calls, []);
				assert.equal(consumed, 0);
			}
		});
	});
}

test('ordinary native marker rename and removal keys retain their exact callbacks', async () => {
	await withMarker(async (marker, calls) => {
		for (const key of ['Enter', 'F2', 'Delete', 'Backspace']) {
			let prevented = 0;
			await act(async () => { reactProps(marker).onKeyDown({ key,
				preventDefault() { prevented++; }, stopPropagation() {} }); });
			assert.equal(prevented, 1);
		}
		assert.deepEqual(calls, ['edit', 'edit', 'remove', 'remove']);
	});
});
