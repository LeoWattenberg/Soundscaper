/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import AudioEditorDialogShell from '../src/common/editor/ui/AudioEditorDialogShell.tsx';
import { installReactTestDom, ReactTestElement } from './helpers/react-test-dom.ts';

for (const transition of ['compact', 'desktop', 'hidden', 'unchanged'] as const) {
	test(`dialog dismissal resolves its ${transition} layout's surviving visible opener`, async () => {
		const dom = installReactTestDom();
		const previousParent = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'parentElement');
		Object.defineProperty(ReactTestElement.prototype, 'parentElement', { configurable: true,
			get(this: ReactTestElement) { return this.parentNode instanceof ReactTestElement ? this.parentNode : null; } });
		const root = createRoot(dom.container as unknown as HTMLElement);
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
		actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
		const render = async (compact: boolean, open: boolean): Promise<void> => {
			await act(async () => { root.render(<div data-audio-editor>
				{transition === 'hidden' ? <>
					<div data-application-menubar aria-hidden={compact ? 'true' : undefined}>
						<button type="button" data-retained-opener>Edit</button>
					</div>
					{compact && <button type="button" data-chrome-drawer-toggle data-editor-opener>Menu</button>}
				</> : compact ? <>
					<div data-application-menubar aria-hidden="true"><button type="button">Hidden Edit</button></div>
					<button type="button" data-chrome-drawer-toggle data-editor-opener>Menu</button>
				</> : <div data-application-menubar><button type="button" data-editor-opener>Edit</button></div>}
				<AudioEditorDialogShell title="Preferences" isOpen={open} onClose={() => undefined}>
					<button type="button">Close preferences</button>
				</AudioEditorDialogShell>
			</div>); });
		};
		try {
			const initialCompact = transition === 'desktop';
			await render(initialCompact, false);
			const opener = dom.one(transition === 'hidden' ? '[data-retained-opener]' : '[data-editor-opener]');
			opener.focus();
			await render(initialCompact, true);
			const close = dom.container.querySelectorAll('button').find(button => button.textContent === 'Close preferences');
			assert.ok(close);
			close.focus();
			const finalCompact = transition === 'unchanged' ? initialCompact : !initialCompact;
			await render(finalCompact, true);
			await render(finalCompact, false);
			const target = dom.one('[data-editor-opener]');
			assert.equal(document.activeElement, target);
			assert.equal(target.closest('[aria-hidden="true"]'), null);
			if (transition === 'unchanged') assert.equal(target, opener);
		} finally {
			await act(async () => { root.unmount(); });
			if (previousParent) Object.defineProperty(ReactTestElement.prototype, 'parentElement', previousParent);
			else Reflect.deleteProperty(ReactTestElement.prototype, 'parentElement');
			dom.restore(); actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		}
	});
}
