/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@soundscaper/design-system/ThemeProvider';
import { OutputTrackNameEditor } from '../src/common/editor/ui/timeline/OutputTrackRows.jsx';
import { installReactTestDom, reactProps, ReactTestElement } from './helpers/react-test-dom.ts';

async function mountedEditor(run: (editor: {
	readonly input: ReactTestElement;
	readonly other: ReactTestElement;
	readonly panel: ReactTestElement;
	readonly committed: string[];
	change(value: string): Promise<void>;
	key(value: string): Promise<void>;
	blur(): Promise<void>;
}) => Promise<void>): Promise<void> {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as HTMLElement);
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const priorSelect = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'select');
	Object.defineProperty(ReactTestElement.prototype, 'select', { configurable: true,
		value(this: ReactTestElement) { Object.assign(this, { selectionStart: 0, selectionEnd: this.value.length }); } });
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const committed: string[] = [];
	function Control() {
		const [open, setOpen] = useState(true);
		return <ThemeProvider><div data-output-track-header>
			<div tabIndex={0} className="track-control-panel" data-output-return />
			<button data-other-control>Other control</button>
			{open && <OutputTrackNameEditor name="Send bus 1" label="Track name" blocked={false}
				onCommit={(name: string) => committed.push(name)}
				onClose={(restoreFocus?: boolean) => {
					setOpen(false);
					if (restoreFocus) dom.one('[data-output-return]').focus();
				}} />}
		</div></ThemeProvider>;
	}
	try {
		await act(async () => { root.render(<Control />); });
		const input = dom.one('input');
		const label = dom.one('.audio-editor-output-name-editor');
		let retainedBlur = reactProps(label).onBlur;
		const blur = (): void => {
			if (label.isConnected) retainedBlur = reactProps(label).onBlur;
			retainedBlur?.({ currentTarget: label, target: input });
		};
		Object.defineProperty(input, 'blur', { configurable: true,
			value: blur });
		await run({
			input, other: dom.one('[data-other-control]'), panel: dom.one('[data-output-return]'), committed,
			async change(value) { await act(async () => {
				reactProps(input).onChange?.({ target: { value }, currentTarget: { value } });
			}); },
			async key(value) { await act(async () => {
				retainedBlur = reactProps(label).onBlur;
				reactProps(label).onKeyDown?.({ key: value, currentTarget: label,
					preventDefault() {}, stopPropagation() {} });
			}); },
			async blur() { await act(async () => { blur(); }); },
		});
	} finally {
		await act(async () => { root.unmount(); });
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previous;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		if (priorSelect) Object.defineProperty(ReactTestElement.prototype, 'select', priorSelect);
		else Reflect.deleteProperty(ReactTestElement.prototype, 'select');
		dom.restore();
	}
}

for (const key of ['Enter', 'Escape']) {
	test(`output name ${key} completes once and returns keyboard continuation to its header`, async () => {
		await mountedEditor(async editor => {
			await editor.change('Keyboard return');
			await editor.key(key);
			assert.equal(editor.input.isConnected, false);
			assert.equal(editor.panel.ownerDocument.activeElement === editor.panel, true);
			assert.deepEqual(editor.committed, key === 'Enter' ? ['Keyboard return'] : []);
			await editor.blur();
			assert.deepEqual(editor.committed, key === 'Enter' ? ['Keyboard return'] : [],
				'a late native blur cannot publish the completed or canceled draft');
		});
	});
}

test('ordinary output name blur commits once and preserves the deliberately focused control', async () => {
	await mountedEditor(async editor => {
		await editor.change('  Dialogue send  ');
		editor.other.focus();
		await editor.blur();
		assert.equal(editor.input.isConnected, false);
		assert.deepEqual(editor.committed, ['Dialogue send']);
		assert.equal(editor.other.ownerDocument.activeElement === editor.other, true);
	});
});
