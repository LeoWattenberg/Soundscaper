/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import EditorDialog from '../src/common/editor/ui/dialogs/EditorDialog.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const type of ['rename', 'track-rename', 'resample', 'track-rate']) {
	test(`the ${type} dialog keeps writable admission current without losing its cancellation`, async () => {
		const dom = installReactTestDom();
		const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
		Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
		const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const priorAct = environment.IS_REACT_ACT_ENVIRONMENT;
		environment.IS_REACT_ACT_ENVIRONMENT = true;
		const root = createRoot(dom.container as unknown as Element);
		let calls = 0;
		let closes = 0;
		const running: Promise<unknown>[] = [];
		const mutation = () => { calls++; };
		const controller = { actions: {
			project: { rename: mutation }, track: { update: mutation, resample: mutation, setRate: mutation },
		} };
		const project = { id: 'recording', sampleRate: 48_000, tracks: [{ id: 'track', type: 'audio' }], clips: [] };
		const value = type.includes('rename') ? 'Finished recording' : '24000';
		const label = type.includes('rename') ? ENGLISH_COPY.saveName : type === 'resample' ? ENGLISH_COPY.resample : ENGLISH_COPY.save;
		const render = async (readOnly: boolean) => {
			await act(async () => root.render(<EditorDialog type={type} value={value} onValueChange={() => undefined}
				trackId="track" controller={controller} snapshot={{ project, selectedTrackId: 'track', readOnly }}
				copy={ENGLISH_COPY} locale="en" run={(operation: () => unknown) => {
					const result = Promise.resolve(operation());
					running.push(result);
					return result;
				}} onClose={() => { closes++; }} />));
		};
		const action = (name: string) => {
			const result = dom.container.querySelectorAll('button').find(button => button.textContent === name);
			assert.ok(result);
			return result;
		};
		try {
			await render(false);
			const submit = action(label);
			assert.equal(submit.hasAttribute('disabled'), false);
			const staleClick = reactProps(submit).onClick;
			await render(true);
			assert.equal(submit.hasAttribute('disabled'), true, 'the same dialog follows its actual writer lease');
			assert.equal(action(ENGLISH_COPY.cancel).hasAttribute('disabled'), false);
			await act(async () => {
				staleClick();
				await Promise.all(running);
				await Promise.resolve();
			});
			assert.equal(calls, 0, 'a captured confirm callback cannot publish an unavailable edit');
			assert.equal(closes, 0, 'the refused edit must keep its draft available');
			await render(false);
			await act(async () => {
				reactProps(submit).onClick();
				await Promise.all(running);
				await Promise.resolve();
			});
			assert.equal(calls, 1);
			assert.equal(closes, 1);
		} finally {
			await act(async () => root.unmount());
			environment.IS_REACT_ACT_ENVIRONMENT = priorAct;
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		}
	});
}
