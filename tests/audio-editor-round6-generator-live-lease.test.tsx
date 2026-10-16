/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import GeneratorDialog from '../src/common/editor/ui/dialogs/GeneratorDialog.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import type { AudioEditorEditBlockingSnapshot } from '../src/common/editor/edit-blocking.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('an open generator follows live editing admission and preserves cancellation', async () => {
	const dom = installReactTestDom();
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	let calls = 0;
	let closes = 0;
	const controller = { actions: { generators: { generate: () => { calls++; } } } };
	const render = async (snapshot: AudioEditorEditBlockingSnapshot) => {
		await act(async () => { root.render(<GeneratorDialog type="silence" controller={controller}
			snapshot={snapshot} copy={ENGLISH_COPY} locale="en" run={(operation: () => unknown) => operation()}
			onClose={() => { closes++; }} />); });
	};
	const button = (label: string) => {
		const found = dom.container.querySelectorAll('button').find(candidate => candidate.textContent === label);
		assert.ok(found);
		return found;
	};
	try {
		await render({});
		assert.equal(button('Generate').hasAttribute('disabled'), false);
		for (const snapshot of [{ readOnly: true }, { exporting: true }, { processingEffect: true }]) {
			await render(snapshot);
			assert.equal(button('Generate').hasAttribute('disabled'), true, 'the open dialog follows live editing admission');
			assert.equal(button('Cancel').hasAttribute('disabled'), false);
			await act(async () => {
				reactProps(button('Generate')).onClick();
				reactProps(dom.one('form')).onSubmit({ preventDefault: () => undefined });
			});
			assert.equal(calls, 0, 'neither footer nor native form submission admits a blocked generation');
			assert.equal(closes, 0, 'a refused generation keeps the draft open');
		}
		await render({});
		assert.equal(button('Generate').hasAttribute('disabled'), false);
		await act(async () => { reactProps(dom.one('form')).onSubmit({ preventDefault: () => undefined }); });
		assert.equal(calls, 1, 'ordinary editable generation still runs');
		assert.equal(closes, 1);
		await render({ readOnly: true });
		await act(async () => { reactProps(button('Cancel')).onClick(); });
		assert.equal(closes, 2, 'the blocked draft remains dismissible');
	} finally {
		await act(async () => { root.unmount(); });
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
