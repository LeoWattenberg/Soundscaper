/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StereoChannelDivider } from '../src/common/editor/ui/timeline/StereoChannelDivider.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('Escape cancels stereo height preview, release cannot commit, and the next drag succeeds', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorReact = globals.React;
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.React = React;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const owner = dom.container.ownerDocument.defaultView as unknown as Window;
	const callbacks = new Set<EventListenerOrEventListenerObject>();
	owner.addEventListener = (type: string, callback: EventListenerOrEventListenerObject | null) => { if (type === 'keydown' && callback) callbacks.add(callback); };
	owner.removeEventListener = (type: string, callback: EventListenerOrEventListenerObject | null) => { if (type === 'keydown' && callback) callbacks.delete(callback); };
	const root = createRoot(dom.container as unknown as Element);
	const commits: number[] = [];
	const captured = new Set<number>();
	function Fixture() {
		const [preview, setPreview] = useState<number | null>(null);
		return <StereoChannelDivider enabled height={100} ratio={preview ?? 0.5} label="Track channels"
			onPreview={setPreview} onCommit={(ratio) => commits.push(ratio)} />;
	}
	try {
		await act(async () => root.render(<Fixture />));
		const divider = dom.one('[data-stereo-channel-divider]');
		Object.defineProperty(divider.parentNode, 'getBoundingClientRect', { configurable: true, value: () => ({ top: 0, height: 100 }) });
		Object.assign(divider, {
			setPointerCapture: (pointerId: number) => captured.add(pointerId),
			releasePointerCapture: (pointerId: number) => captured.delete(pointerId),
		});
		const pointer = { currentTarget: divider, pointerId: 7, button: 0, clientY: 50, preventDefault() {}, stopPropagation() {} };
		await act(async () => reactProps(divider).onPointerDown(pointer));
		await act(async () => reactProps(divider).onPointerMove({ ...pointer, clientY: 75 }));
		assert.equal(divider.getAttribute('aria-valuenow'), '75');
		await act(async () => {
			const escape = { key: 'Escape', preventDefault() {}, stopPropagation() {} } as unknown as Event;
			for (const callback of callbacks) {
				if (typeof callback === 'function') callback(escape);
				else callback.handleEvent(escape);
			}
		});
		assert.equal(divider.getAttribute('aria-valuenow'), '50');
		assert.equal(captured.size, 0);
		await act(async () => reactProps(divider).onPointerUp({ ...pointer, clientY: 75 }));
		assert.deepEqual(commits, []);
		await act(async () => reactProps(divider).onPointerDown(pointer));
		await act(async () => reactProps(divider).onPointerUp({ ...pointer, clientY: 65 }));
		assert.deepEqual(commits, [0.65]);
	} finally {
		await act(async () => root.unmount());
		assert.equal(callbacks.size, 0);
		globals.React = priorReact;
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
