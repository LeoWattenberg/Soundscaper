/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { TimeCode } from '@soundscaper/design-system/TimeCode';
import { handleWorkspaceKeyboard } from '../src/common/editor/ui/workspace-shortcuts.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('mounted editable time digits retain native editing keys while their idle group retains editor commands', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const calls: string[] = [];
	const shortcuts = { erase: ['Backspace', 'Del'], record: ['R'], save: ['Ctrl+S'] };
	const menus = Object.keys(shortcuts).map((id) => ({ id, onClick: () => { calls.push(id); } }));
	const dispatch = (target: Element, key: string, ctrlKey = false): void => {
		handleWorkspaceKeyboard({ target, key, code: key, altKey: false, ctrlKey, metaKey: false,
			shiftKey: false, defaultPrevented: false, preventDefault() {} },
		{ preferences: { shortcuts } }, (operation) => operation(), { menus });
	};
	try {
		await act(async () => { root.render(<TimeCode value={0} ariaLabel="Playhead" onChange={() => undefined} showFormatSelector={false} />); });
		const digit = dom.one('.timecode-digit');
		await act(async () => { reactProps(digit).onClick(); });
		for (const key of ['Backspace', 'Delete', 'r']) dispatch(digit as unknown as Element, key);
		assert.deepEqual(calls, [], 'editing must not erase the timeline or begin a recording');
		dispatch(digit as unknown as Element, 's', true);
		assert.deepEqual(calls.splice(0), ['save'], 'a non-native modified command is still available');
		const group = dom.one('[role="group"]');
		dispatch(group as unknown as Element, 'Backspace');
		assert.deepEqual(calls, ['erase'], 'the idle composite group remains a normal editor shortcut target');
	} finally {
		await act(async () => { root.unmount(); });
		dom.restore();
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
	}
});
