/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

import { controlOwnsNavigationKeys } from '../vendor/audacity-design-system/components/src/hooks/control-navigation-ownership.ts';
import { handleEditorToolbarKeyDown } from '../src/common/editor/ui/workspace-shortcuts.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

test('editable toolbar widgets retain navigation keys while action buttons still participate in roving navigation', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<div>
			<input /><select /><textarea /><button role="slider"><span /></button>
			<button className="action" />
		</div>));
		for (const selector of ['input', 'select', 'textarea', 'span']) {
			const target = dom.one(selector);
			assert.equal(controlOwnsNavigationKeys(target as unknown as EventTarget), true);
			let queried = false;
			const event = { target, key: 'ArrowUp', currentTarget: { querySelector() { queried = true; return null; } } };
			handleEditorToolbarKeyDown(event as unknown as ReactKeyboardEvent<HTMLElement>);
			assert.equal(queried, false, 'editable keys never enter sibling-focus navigation');
		}
		assert.equal(controlOwnsNavigationKeys(dom.one('.action') as unknown as EventTarget), false);
		assert.equal(controlOwnsNavigationKeys(null), false);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
