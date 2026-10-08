/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import AudioEditorSplitButton from '../src/common/editor/ui/AudioEditorSplitButton.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const keyboard of [true, false]) for (const actionFocus of [false, true]) {
	test(`split-button action returns its keyboard owner before completion: ${keyboard}, action focus ${actionFocus}`, async context => {
		context.mock.timers.enable({ apis: ['setTimeout'] });
		const dom = installReactTestDom();
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
		actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
		const root = createRoot(dom.container as unknown as Element);
		let focusedAtAction: unknown;
		try {
			await act(async () => {
				root.render(<><button data-next-action>Next action</button>
					<AudioEditorSplitButton icon="record" ariaLabel="Record" optionsAriaLabel="Record options">
						{({ close }) => <button data-option onClick={() => {
							close();
							focusedAtAction = dom.container.ownerDocument.activeElement;
							if (actionFocus) dom.one('[data-next-action]').focus();
						}}>Record to new track</button>}
					</AudioEditorSplitButton></>);
			});
			const trigger = dom.one('.kw-audio-editor__split-button-arrow');
			trigger.focus();
			await act(async () => {
				reactProps(trigger).onClick({ nativeEvent: { detail: keyboard ? 0 : 1 } });
			});
			const option = dom.one('[data-option]');
			option.focus();
			await act(async () => { reactProps(option).onClick(); });
			assert.equal(option.isConnected, false, 'the action closes its popup');
			assert.equal(focusedAtAction, keyboard ? trigger : option,
				'keyboard focus reaches its surviving trigger before the action can claim focus');
			if (actionFocus) assert.equal(dom.container.ownerDocument.activeElement, dom.one('[data-next-action]'));
			else if (keyboard) assert.equal(dom.container.ownerDocument.activeElement, trigger);
		} finally {
			await act(async () => { root.unmount(); });
			actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
			context.mock.timers.reset();
			dom.restore();
		}
	});
}
