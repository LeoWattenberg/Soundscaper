/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { TimeCode } from '../vendor/audacity-design-system/components/src/TimeCode/TimeCode.tsx';
import TimeCodeFormatControl from '../src/common/editor/ui/toolbar/TimeCodeFormatControl.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const scenario of ['format', 'search', 'delegated-format'] as const) test(scenario === 'format'
	? 'a pointer-opened time format popup retires digit editing before its arrows can change the value'
	: scenario === 'search' ? 'a time-code digit editor cannot consume numeric input after search takes keyboard focus'
		: 'the application format trigger inside a time control owns its own popup arrow keys', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const previousObserver = Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver');
	Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: class {
		observe() {} disconnect() {}
	} });
	const keys = new Set<EventListenerOrEventListenerObject>();
	document.addEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => {
		if (type === 'keydown' && listener) keys.add(listener);
	};
	document.removeEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => {
		if (type === 'keydown' && listener) keys.delete(listener);
	};
	const values: number[] = [];
	const formats: string[] = [];
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		const timeCode = <TimeCode value={30} format="hh:mm:ss+milliseconds"
			showFormatSelector={scenario !== 'delegated-format'}
			onChange={(value) => { values.push(value); }} onFormatChange={(format) => { formats.push(format); }} />;
		await act(async () => { root.render(<div data-audio-editor>{scenario === 'delegated-format'
			? <TimeCodeFormatControl label="Playhead: Format" format="hh:mm:ss+milliseconds" frameRate={24}
				onFormatChange={(format) => { formats.push(format); }}>{timeCode}</TimeCodeFormatControl>
			: timeCode}<input aria-label="Search commands" /></div>); });
		const digit = dom.one('.timecode-digit');
		digit.focus();
		await act(async () => { reactProps(digit).onClick(); });
		assert.equal(digit.getAttribute('data-state'), 'active');
		if (scenario === 'search') {
			dom.one('input').focus();
			const event = Object.assign(new Event('keydown', { cancelable: true }), { key: '1' });
			await act(async () => {
				for (const listener of [...keys]) {
					if (typeof listener === 'function') listener(event);
					else listener.handleEvent(event);
				}
			});
			assert.equal(event.defaultPrevented, false, 'the focused search input owns its numeric keystrokes');
			assert.deepEqual(values, []);
			return;
		}
		const trigger = dom.one('.timecode__format-button');
		trigger.focus();
		await act(async () => { reactProps(trigger).onClick({ detail: 1 }); });
		assert.ok(dom.find('[role="menu"]'));
		await act(async () => {
			const event = Object.assign(new Event('keydown', { cancelable: true }), { key: 'ArrowDown' });
			for (const listener of [...keys]) {
				if (typeof listener === 'function') listener(event);
				else listener.handleEvent(event);
			}
		});
		assert.deepEqual(values, [], 'format navigation cannot change the preceding digit');
		if (scenario === 'format') assert.equal(dom.find('[data-state="active"]'), null);
		const first = dom.container.querySelectorAll('[role="menuitem"]')[0];
		assert.ok(first);
		await act(async () => { reactProps(first).onClick({}); });
		assert.deepEqual(formats, ['dd:hh:mm:ss']);
		assert.equal(dom.find('[role="menu"]'), null);
	} finally {
		await act(async () => { root.unmount(); });
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (previousObserver) Object.defineProperty(globalThis, 'MutationObserver', previousObserver);
		else Reflect.deleteProperty(globalThis, 'MutationObserver');
		dom.restore();
	}
});
