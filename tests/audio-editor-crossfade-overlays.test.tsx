/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { CrossfadeOverlays } from '../src/common/editor/ui/timeline/CrossfadeOverlays.tsx';
import { installReactTestDom } from './helpers/react-test-dom.ts';

test('crossfade roll previews preserve the captured handle identity and keyboard focus', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const render = (offset: number) => <CrossfadeOverlays overlays={[{
		id: `A:B:${100 + offset}:${200 + offset}`, left: 100 + offset, width: 100,
		outgoingPath: 'M 0,0 L 100,100', incomingPath: 'M 0,100 L 100,0',
		intersectionPosition: 0.5, intersectionGain: Math.SQRT1_2,
		minimumPosition: 0.16, maximumPosition: 0.84,
		outgoingClipId: 'A', incomingClipId: 'B', label: 'Automatic crossfade',
	}]} clipLookup={new Map([['A', { id: 'A' }], ['B', { id: 'B' }]])}
		selectedIds={new Set()} top={0} height={100} blocked={false} copy={{}}
		controller={{ actions: { edit: { commit: () => undefined } } }}
		run={operation => operation()} onTabOut={() => undefined} />;
	try {
		await act(async () => root.render(render(0)));
		const handle = dom.one('[data-crossfade-handle]');
		handle.focus();
		await act(async () => root.render(render(12)));
		assert.equal(dom.one('[data-crossfade-handle]'), handle, 'geometry previews must retain the element that owns pointer capture');
		assert.equal(dom.container.ownerDocument.activeElement, handle, 'the same focused crossfade follows the rolled overlap');
		assert.equal((handle.style as unknown as CSSStyleDeclaration).left, '154px');
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
