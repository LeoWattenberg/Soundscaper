/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';

import AudioEditorTimeCodeInput from '../src/common/editor/ui/AudioEditorTimeCodeInput.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('Enter confirms the current digit draft once before the field loses focus', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const listeners = new Set<EventListenerOrEventListenerObject>();
	const document = globalThis.document;
	const add = document.addEventListener;
	const remove = document.removeEventListener;
	document.addEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => {
		if (type === 'keydown' && listener) listeners.add(listener);
	};
	document.removeEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => {
		if (type === 'keydown' && listener) listeners.delete(listener);
	};
	const press = async (key: string) => {
		const event = { key, preventDefault() {}, stopPropagation() {} } as KeyboardEvent;
		await act(async () => {
			for (const listener of [...listeners]) {
				if (typeof listener === 'function') listener(event);
				else listener.handleEvent(event);
			}
		});
	};
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const saved: number[] = [];
	try {
		await act(async () => root.render(<AudioEditorTimeCodeInput label="End" value={0}
			onCommit={(value) => { saved.push(value); }} />));
		dom.one('.timecode-digit').focus();
		await act(async () => reactProps(dom.one('.timecode-digit')).onClick());
		await press('1');
		assert.deepEqual(saved, []);
		await press('Enter');
		assert.deepEqual(saved, [36_000]);
		const wrapper = dom.one('.audio-editor-timecode-input');
		await act(async () => reactProps(wrapper).onBlur({ currentTarget: wrapper, relatedTarget: null }));
		assert.deepEqual(saved, [36_000]);
	} finally {
		await act(async () => root.unmount());
		document.addEventListener = add;
		document.removeEventListener = remove;
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
