/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';
import { TimeCode } from '../vendor/audacity-design-system/components/src/TimeCode/TimeCode.tsx';
import { Slider } from '../vendor/audacity-design-system/components/src/Slider/Slider.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

(globalThis as unknown as { React: unknown }).React = React;

test('free time entry commits the new value once and Escape discards a subsequent draft', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const committed: number[] = [];
	function Harness() {
		const [value, setValue] = useState(1);
		return <TimeCode value={value} ariaLabel="Position" onChange={setValue} onCommit={() => committed.push(value)} />;
	}
	const keyboard = (key: string) => ({ key, preventDefault() {}, stopPropagation() {} });
	try {
		await act(async () => root.render(<Harness />));
		await act(async () => reactProps(dom.one('.timecode__display')).onDoubleClick());
		assert.equal(dom.one('input').value, '1');
		await act(async () => reactProps(dom.one('input')).onChange({ currentTarget: { value: '2m3.5s' } }));
		await act(async () => reactProps(dom.one('input')).onKeyDown(keyboard('Enter')));
		assert.deepEqual(committed, [123.5]);
		assert.equal(dom.find('input'), null);
		await act(async () => reactProps(dom.one('.timecode__display')).onDoubleClick());
		await act(async () => reactProps(dom.one('input')).onChange({ currentTarget: { value: '99' } }));
		await act(async () => reactProps(dom.one('input')).onKeyDown(keyboard('Escape')));
		assert.deepEqual(committed, [123.5]);
		await act(async () => reactProps(dom.one('.timecode__display')).onDoubleClick());
		assert.equal(dom.one('input').value, '123.5');
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

test('slider direct value and reset menus each create one complete value gesture', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const gestures: string[] = [];
	try {
		await act(async () => root.render(<Slider value={80} defaultValue={75} ariaLabel="Volume"
			onGestureStart={value => gestures.push(`start:${value}`)} onChange={value => gestures.push(`value:${value}`)}
			onGestureEnd={value => gestures.push(`end:${value}`)} />));
		const slider = dom.one('.slider');
		await act(async () => reactProps(slider).onContextMenu({ currentTarget: slider, clientX: 3, clientY: 4, preventDefault() {}, stopPropagation() {} }));
		const menu = dom.one('[role="menu"]');
		assert.equal(menu.querySelectorAll('[role="menuitem"]').length, 2);
		await act(async () => reactProps(menu.querySelectorAll('[role="menuitem"]')[1]).onClick({ stopPropagation() {} }));
		assert.deepEqual(gestures, ['start:80', 'value:75', 'end:75']);
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
