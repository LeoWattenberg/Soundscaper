/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';
import AudioEditorSearch from '../src/common/editor/ui/AudioEditorSearch.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const Search = AudioEditorSearch as unknown as React.ComponentType<Record<string, unknown>>;

for (const strict of [false, true]) for (const action of [
	'activate', 'escape', 'unmount', 'remain open', 'external close', 'escape then unmount',
] as const) {
	test(`Motion shared search owns deferred focus when it must ${action} (strict=${String(strict)})`, async () => {
		const dom = installReactTestDom();
		const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
		const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
		globals.IS_REACT_ACT_ENVIRONMENT = true;
		Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
		const frames = new Map<number, FrameRequestCallback>();
		let nextFrame = 0;
		globalThis.requestAnimationFrame = callback => {
			frames.set(++nextFrame, callback);
			return nextFrame;
		};
		globalThis.cancelAnimationFrame = handle => { frames.delete(handle); };
		const { createRoot } = await import('react-dom/client');
		const root = createRoot(dom.container as unknown as Element);
		let mounted = true;
		let activations = 0;
		let setHostOpen: React.Dispatch<React.SetStateAction<boolean>> = () => undefined;
		function Fixture() {
			const [open, setOpen] = useState(false);
			setHostOpen = setOpen;
			return <><button data-prior>Previous control</button><button data-destination>Command destination</button>
				<Search copy={{}} locale="en" open={open} onOpenChange={setOpen}
					entries={[{ key: 'command:project-properties', kind: 'command', label: 'Project properties' }]}
					onActivate={() => { activations++; dom.one('[data-destination]').focus(); }} /></>;
		}
		const flushFrames = async () => {
			const pending = [...frames];
			frames.clear();
			await act(async () => { for (const [, callback] of pending) callback(1); });
		};
		try {
			await act(async () => root.render(strict ? <React.StrictMode><Fixture /></React.StrictMode> : <Fixture />));
			const previous = dom.one('[data-prior]');
			const input = dom.one('[data-editor-search-input]');
			// A real focus event can open the combobox. Preserve that behavior in
			// this mounted control instead of merely counting queued callbacks.
			const focus = input.focus.bind(input);
			input.focus = () => {
				const relatedTarget = dom.container.ownerDocument.activeElement;
				focus();
				if (relatedTarget !== input) reactProps(input).onFocus({ relatedTarget });
			};
			previous.focus();
			const trigger = dom.one('[data-editor-search-trigger]');
			await act(async () => reactProps(trigger).onClick({ currentTarget: trigger }));
			assert.ok(frames.size > 0, 'opening retains deferred focus until the next animation frame');
			// The browser/test can focus and activate the input before a delayed
			// opening frame runs. This does not require an arbitrary timed sleep.
			await act(async () => input.focus());
			if (action === 'external close') {
				await act(async () => setHostOpen(false));
			} else if (action !== 'unmount' && action !== 'remain open') {
				await act(async () => reactProps(input).onKeyDown({
					key: action === 'activate' ? 'Enter' : 'Escape',
					nativeEvent: { isComposing: false, keyCode: action === 'activate' ? 13 : 27 },
					preventDefault() {}, stopPropagation() {},
				}));
			}
			if (action === 'unmount' || action === 'escape then unmount') {
				await act(async () => root.unmount());
				mounted = false;
				assert.equal(frames.size, 0, 'unmount releases owned pending focus callbacks');
			}
			await flushFrames();
			if (!mounted) return;
			assert.equal(Boolean(dom.find('[data-editor-search-popup]')), action === 'remain open',
				'a stale opening frame must not reopen a closed search');
			const expected = action === 'activate' ? dom.one('[data-destination]')
				: action === 'remain open' || action === 'external close' ? input : trigger;
			assert.equal(dom.container.ownerDocument.activeElement === expected, true,
				'focus belongs to the activated destination, return target, or still-open input');
			assert.equal(activations, action === 'activate' ? 1 : 0);
		} finally {
			if (mounted) await act(async () => root.unmount());
			globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		}
	});
}
