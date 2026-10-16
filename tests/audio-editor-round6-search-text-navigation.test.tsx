/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import AudioEditorSearch from '../src/common/editor/ui/AudioEditorSearch.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const Search = AudioEditorSearch as unknown as React.ComponentType<Record<string, unknown>>;
for (const modifier of ['shiftKey', 'ctrlKey', 'metaKey', 'altKey']) test(`search releases ${modifier} arrows to native text navigation`, async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => { root.render(<Search copy={{}} locale="en" open={true}
			onOpenChange={() => undefined} onActivate={() => undefined}
			entries={[{ key: 'one', kind: 'command', label: 'Project one' }, { key: 'two', kind: 'command', label: 'Project two' }]} />); });
		const input = dom.one('[data-editor-search-input]');
		const initial = input.getAttribute('aria-activedescendant');
		let consumed = false;
		const event = { key: 'ArrowDown', nativeEvent: { isComposing: false, keyCode: 40 },
			shiftKey: false, ctrlKey: false, metaKey: false, altKey: false,
			preventDefault() { consumed = true; }, stopPropagation() { consumed = true; } };
		await act(async () => { reactProps(input).onKeyDown(event); });
		assert.equal(consumed, true, 'the ordinary arrow still navigates the actual result list');
		const moved = input.getAttribute('aria-activedescendant');
		assert.notEqual(moved, initial);
		consumed = false;
		await act(async () => { reactProps(input).onKeyDown({ ...event, [modifier]: true }); });
		assert.equal(consumed, false, 'native text navigation retains the modified arrow');
		assert.equal(input.getAttribute('aria-activedescendant'), moved);
		await act(async () => { reactProps(input).onKeyDown({ ...event, key: 'ArrowUp' }); });
		assert.equal(input.getAttribute('aria-activedescendant'), initial);
	} finally {
		await act(async () => { root.unmount(); });
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore(); actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
	}
});
