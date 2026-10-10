/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { COPY, createAudioEditorController, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';
import { createMemoryStore } from './helpers/audio-editor-memory-store-baseline.js';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createAudioEditorPreferencesV1 } from '../src/common/editor/preferences.js';
import { ShortcutEditorRow } from '../src/common/editor/ui/dialogs/ShortcutEditorRow.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('a refused shortcut assignment retains a newer editable binding draft', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const root = createRoot(dom.container as unknown as Element);
	const store = createMemoryStore();
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const controller = createAudioEditorController(null, {
		headless: true, copy: COPY, locale: 'en', store: store as unknown as Options['store'],
		engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: { dispose() {} } as unknown as Options['ffmpeg'],
	});
	let release = (): void => undefined;
	let unsubscribe = (): void => undefined;
	const operations: Promise<unknown>[] = [];
	try {
		await controller.ready;
		const render = (): void => root.render(<ShortcutEditorRow
			command={{ id: 'new-label-track', label: 'New label track' }} copy={ENGLISH_COPY}
			preferences={controller.getSnapshot().preferences as ReturnType<typeof createAudioEditorPreferencesV1>}
			controller={controller} run={operation => {
				const promise = Promise.resolve(operation());
				operations.push(promise);
				void promise.catch(() => undefined);
				return promise;
			}} />);
		unsubscribe = controller.subscribe(render);
		await act(async () => render());
		const edit = async (value: string): Promise<void> => {
			await act(async () => {
				const field = dom.one('[data-shortcut-binding="0"]');
				reactProps(field).onChange({ currentTarget: { value } });
			});
		};
		const assign = async (): Promise<void> => {
			await act(async () => { reactProps(dom.one('.button')).onClick({}); });
		};
		const bindings = (): readonly string[] => (
			controller.getSnapshot().preferences as ReturnType<typeof createAudioEditorPreferencesV1>
		).shortcuts['new-label-track'];
		await edit('Ctrl+Alt+Shift+F6');
		await assign();
		await operations.at(-1);
		assert.deepEqual(bindings(), ['Ctrl+Alt+Shift+F6'], 'healthy Assign persists the actual menu command binding');
		const saveSetting = store.saveSetting.bind(store);
		let pending = false;
		store.saveSetting = async (key: string, value: unknown) => {
			if (key === 'audio-editor-preferences-v1' && !pending) {
				pending = true;
				await new Promise<void>(resolve => { release = resolve; });
				throw new DOMException('The device storage is full.', 'QuotaExceededError');
			}
			return saveSetting(key, value);
		};
		await edit('Ctrl+Alt+Shift+F7');
		await assign();
		assert.equal(pending, true);
		assert.deepEqual(bindings(), ['Ctrl+Alt+Shift+F7'], 'the public row adopts its pending optimistic assignment');
		await edit('Ctrl+Alt+Shift+F8');
		await act(async () => {
			release();
			await assert.rejects(operations.at(-1)!, { name: 'QuotaExceededError' });
		});
		assert.deepEqual(bindings(), ['Ctrl+Alt+Shift+F6'], 'the failed durable assignment rolls back correctly');
		assert.equal(dom.one('[data-shortcut-binding="0"]').value, 'Ctrl+Alt+Shift+F8', 'rollback must retain the newer user draft');
		await assign();
		await operations.at(-1);
		assert.deepEqual(bindings(), ['Ctrl+Alt+Shift+F8'], 'the retained draft can be assigned through the same ordinary control');
		await edit('Ctrl+Alt+Shift+F9');
		await edit('Ctrl+Alt+Shift+F8');
		await act(async () => {
			await Promise.resolve(controller.actions.preferences.resetShortcuts());
		});
		assert.equal(dom.one('[data-shortcut-binding="0"]').value, '', 'an assigned row still adopts the explicit factory reset');
	} finally {
		release();
		await Promise.allSettled(operations);
		unsubscribe();
		await act(async () => root.unmount());
		await controller.dispose();
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
