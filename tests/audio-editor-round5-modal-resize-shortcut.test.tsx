/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import AudioEditorResizableSurface from '../src/common/editor/ui/AudioEditorResizableSurface.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const ResizableSurface = AudioEditorResizableSurface as unknown as React.ComponentType<{
	readonly style: React.CSSProperties;
	readonly children: React.ReactNode;
}>;

for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'defaultPrevented']) {
	test(`modal resize preserves geometry for ${modifier} while plain arrows work`, async () => {
		const dom = installReactTestDom();
		const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
		globals.IS_REACT_ACT_ENVIRONMENT = true;
		Object.assign(window, { innerWidth: 1200, innerHeight: 900 });
		const { createRoot } = await import('react-dom/client');
		const root = createRoot(dom.container as unknown as Element);
		try {
			await act(async () => root.render(<ResizableSurface style={{ width: '600px', height: '400px' }}>Test window</ResizableSurface>));
			const surface = dom.one('section');
			surface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 400, right: 600, bottom: 400, x: 0, y: 0 });
			const grip = dom.one('[data-resize-handle]');
			for (const key of ['ArrowUp', 'ArrowRight']) {
				let consumed = false;
				await act(async () => reactProps(grip).onKeyDown?.({ key, [modifier]: true,
					preventDefault() { consumed = true; }, stopPropagation() { consumed = true; } }));
				assert.equal(consumed, false);
				assert.equal(Reflect.get(surface.style, 'width'), '600px');
				assert.equal(Reflect.get(surface.style, 'height'), '400px');
			}
			let consumed = false;
			await act(async () => reactProps(grip).onKeyDown?.({ key: 'ArrowUp',
				preventDefault() { consumed = true; }, stopPropagation() { consumed = true; } }));
			assert.equal(consumed, true);
			assert.equal(Reflect.get(surface.style, 'width'), '600px');
			assert.equal(Reflect.get(surface.style, 'height'), '384px');
		} finally {
			await act(async () => root.unmount());
			globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
			dom.restore();
		}
	});
}
