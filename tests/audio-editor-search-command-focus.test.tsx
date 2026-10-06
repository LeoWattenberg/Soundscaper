/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';
import AudioEditorSearch from '../src/common/editor/ui/AudioEditorSearch.jsx';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

const Search = AudioEditorSearch as unknown as React.ComponentType<Record<string, unknown>>;

for (const destination of ['previous control', 'command dialog'] as const) {
	test(`search activation restores focus before the command and respects ${destination}`, async () => {
		const dom = installReactTestDom();
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
		const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
		actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
		Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
		const { createRoot } = await import('react-dom/client');
		const root = createRoot(dom.container as unknown as Element);
		let observed: ReactTestElement | null = null;
		function Fixture() {
			const [open, setOpen] = useState(false);
			return <><button data-prior>Play</button><button data-destination>Dialog action</button>
				<Search copy={{}} locale="en" open={open} onOpenChange={setOpen}
					entries={[{ key: 'command:select-all', kind: 'command', label: 'Select all', disabled: false }]}
					onActivate={() => {
						observed = dom.container.ownerDocument.activeElement;
						if (destination === 'command dialog') dom.one('[data-destination]').focus();
					}} /></>;
		}
		try {
			await act(async () => root.render(<Fixture />));
			const previous = dom.one('[data-prior]');
			const input = dom.one('[data-editor-search-input]');
			previous.focus();
			await act(async () => reactProps(input).onFocus({ relatedTarget: previous }));
			input.focus();
			await act(async () => reactProps(input).onKeyDown({
				key: 'Enter', nativeEvent: { isComposing: false, keyCode: 13 },
				preventDefault() {}, stopPropagation() {},
			}));
			assert.equal(observed, previous, 'focus is restored before the chosen command runs');
			assert.equal(dom.container.ownerDocument.activeElement,
				destination === 'command dialog' ? dom.one('[data-destination]') : previous);
		} finally {
			await act(async () => root.unmount());
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		}
	});
}
