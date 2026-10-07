/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { VideoTrackControls } from '../src/common/editor/ui/timeline/VideoTrackControls.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps, ReactTestElement } from './helpers/react-test-dom.ts';

test('picture-track navigation leaves name editing arrows to their input while ordinary controls retain vertical navigation', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorReact = globals.React;
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.React = React;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(ReactTestElement.prototype, 'select', { configurable: true, value() {} });
	const root = createRoot(dom.container as unknown as Element);
	const navigation: string[] = [];
	let prevented = 0;
	const controller = { actions: { track: { update() {} }, timeline: { selectTrack() {} } } };
	try {
		await act(async () => root.render(<VideoTrackControls controller={controller} track={{ id: 'pictures', name: 'Images' }}
			panelWidth={240} selected blocked={false} isFlatNavigation={false} copy={ENGLISH_COPY}
			run={(operation: () => unknown) => operation()} onMenu={() => undefined} onOpenEffects={() => undefined}
			effectsAvailable onTabOut={() => undefined} onShiftTabOut={() => undefined}
			onNavigateVertical={(direction: string) => navigation.push(direction)} />));
		await act(async () => { reactProps(dom.one('[data-track-name]')).onDoubleClick({}); });
		const input = dom.one('input');
		const event = (key: string, target: unknown) => ({ key, target, preventDefault() { prevented += 1; } });
		const header = dom.one('[data-track-header]');
		await act(async () => {
			reactProps(header).onKeyDownCapture(event('ArrowUp', input));
			reactProps(header).onKeyDownCapture(event('ArrowDown', input));
		});
		assert.deepEqual(navigation, []);
		assert.equal(prevented, 0);
		assert.equal(dom.container.ownerDocument.activeElement, input);
		await act(async () => { reactProps(header).onKeyDownCapture(event('ArrowUp', dom.one('button'))); });
		assert.deepEqual(navigation, ['up']);
		assert.equal(prevented, 1);
	} finally {
		await act(async () => root.unmount());
		Reflect.deleteProperty(ReactTestElement.prototype, 'select');
		globals.React = priorReact;
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
