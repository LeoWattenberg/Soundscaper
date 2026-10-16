/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';

import type { CustomToolbarButton } from '../src/common/editor/custom-toolbar-buttons.ts';
import CustomToolbarButtonDialog from '../src/common/editor/ui/dialogs/CustomToolbarButtonDialog.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('a custom button admits one pending save and remains editable after a persistence failure', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const failedSave = deferred<void>();
	const retrySave = deferred<void>();
	const savedButtons: CustomToolbarButton[] = [];
	let closes = 0;
	try {
		await act(async () => root.render(<CustomToolbarButtonDialog
			button={{ id: 'custom-retry', name: 'Retry this edit', icon: 'CUT', actionId: 'delete-leave-gap' }}
			actions={[{
				actionId: 'delete-leave-gap', label: 'Delete and leave gap',
				path: ['Edit', 'Delete', 'Delete and leave gap'], disabled: true,
			}]}
			copy={ENGLISH_COPY}
			onSave={(button) => {
				savedButtons.push(button);
				return savedButtons.length === 1 ? failedSave.promise : retrySave.promise;
			}}
			onClose={() => { closes += 1; }}
		/>));
		const save = dom.container.querySelectorAll('button').find((button) => button.textContent.trim() === ENGLISH_COPY.save);
		assert.ok(save, 'The dialog exposes its Save button.');
		const submit = () => reactProps(dom.one('form')).onSubmit({ preventDefault() {} });
		assert.equal(save.hasAttribute('disabled'), false, 'an action can be saved before a selection is available');
		await act(async () => {
			submit();
			submit();
			await Promise.resolve();
		});
		assert.equal(savedButtons.length, 1, 'rapid submits must persist a button only once');
		assert.equal(save.hasAttribute('disabled'), true);
		assert.equal(dom.one('[aria-label="Name"]').hasAttribute('disabled'), true);
		assert.equal(closes, 0);

		await act(async () => {
			failedSave.reject(new Error('Workspace storage is full.'));
			await failedSave.promise.catch(() => undefined);
		});
		assert.equal(dom.one('[role="alert"]').textContent, 'Workspace storage is full.');
		assert.equal(save.hasAttribute('disabled'), false);
		assert.equal(dom.one('[aria-label="Name"]').hasAttribute('disabled'), false);
		assert.equal(dom.one('[aria-label="Name"]').value, 'Retry this edit');
		assert.equal(closes, 0, 'a failed save leaves the dialog open');

		await act(async () => {
			reactProps(dom.one('[aria-label="Name"]')).onChange({ currentTarget: { value: 'Retry with this name' } });
		});
		await act(async () => {
			submit();
			await Promise.resolve();
		});
		assert.equal(savedButtons.length, 2);
		assert.equal(savedButtons[1]?.name, 'Retry with this name');
		assert.equal(savedButtons[1]?.id, 'custom-retry');
		assert.equal(dom.find('[role="alert"]'), null, 'retrying clears the previous error');
		await act(async () => {
			retrySave.resolve();
			await retrySave.promise;
		});
		assert.equal(closes, 1);
	} finally {
		failedSave.resolve();
		retrySave.resolve();
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});

function deferred<Value>() {
	let resolve!: (value: Value) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<Value>((complete, fail) => { resolve = complete; reject = fail; });
	return { promise, resolve, reject };
}
