/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import WorkspacePanelHeader from '../src/common/editor/ui/workspace/WorkspacePanelHeader.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const Header = WorkspacePanelHeader as unknown as React.ComponentType<Record<string, unknown>>;

for (const [key, shiftKey] of [['F10', true], ['ContextMenu', false]] as const) {
	test(`${key} opens the workspace header's existing context menu with keyboard focus`, async () => {
		const dom = installReactTestDom();
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
		actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
		const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
		Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
		dom.container.setAttribute('data-audio-editor', 'true');
		const { createRoot } = await import('react-dom/client');
		const root = createRoot(dom.container as unknown as Element);
		try {
			await act(async () => { root.render(<Header panelId="markers" label="Markers" copy={ENGLISH_COPY}
				currentDock="right" onDock={() => undefined} onClose={() => undefined}
				dragHandle={{ onKeyDown() {}, onDragStart() {}, onDragEnd() {} }} />); });
			const header = dom.one('header');
			const move = dom.one('[data-workspace-panel-drag-handle="markers"]');
			move.focus();
			const onKeyDown = reactProps(header).onKeyDown;
			assert.equal(typeof onKeyDown, 'function');
			let prevented = 0;
			let stopped = 0;
			const event = { key, shiftKey, ctrlKey: false, metaKey: false, altKey: false,
				defaultPrevented: false, target: move, currentTarget: header,
				preventDefault() { prevented += 1; }, stopPropagation() { stopped += 1; } };
			await act(async () => { onKeyDown?.({ ...event, key: 'F10', shiftKey: false }); });
			await act(async () => { onKeyDown?.({ ...event, ctrlKey: true }); });
			await act(async () => { onKeyDown?.({ ...event, defaultPrevented: true }); });
			assert.equal(dom.find('[role="menu"]'), null, 'other commands and a child-owned gesture remain untouched');
			assert.equal(prevented, 0);
			await act(async () => { onKeyDown?.(event); });
			await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
			assert.ok(dom.find('[role="menu"]'));
			const first = dom.container.querySelectorAll('[role="menuitem"]')[0];
			assert.ok(first);
			assert.equal(first.textContent, 'Left');
			assert.equal(document.activeElement, first);
			assert.equal(prevented, 1);
			assert.equal(stopped, 1);
		} finally {
			await act(async () => { root.unmount(); });
			actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
			if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		}
	});
}
