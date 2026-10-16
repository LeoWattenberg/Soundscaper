/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import EditorDialog from '../src/common/editor/ui/dialogs/EditorDialog.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('completing a cancelled track resample keeps the newer factory confirmation open', async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as Element);
	const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = environment.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	environment.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	let held = false;
	let complete = (): void => undefined;
	let closed = 0;
	const calls: unknown[][] = [];
	const operations: Promise<unknown>[] = [];
	const controller = { actions: { track: { resample: (...args: unknown[]) => {
		calls.push(args);
		return held ? new Promise<string>(resolve => { complete = () => resolve('track'); }) : Promise.resolve('track');
	} } } };
	const render = (type: 'resample' | 'revert-factory'): void => root.render(<EditorDialog
		type={type} value="24000" onValueChange={() => undefined} trackId="track" controller={controller}
		snapshot={{ project: { id: 'recording', sampleRate: 48_000 }, selectedTrackId: 'track' }}
		copy={ENGLISH_COPY} locale="en" run={(operation: () => unknown) => {
			const promise = Promise.resolve(operation());
			operations.push(promise);
			return promise;
		}} onClose={() => { closed++; root.render(<div />); }} />);
	const press = (label: string): void => {
		const button = dom.container.querySelectorAll('button').find(element => element.textContent === label);
		assert.ok(button);
		reactProps(button).onClick?.();
	};
	try {
		await act(async () => render('resample'));
		await act(async () => press(ENGLISH_COPY.resample));
		assert.deepEqual(calls, [['track', 24_000]], 'normal submission reaches the selected track and completed rate');
		assert.equal(closed, 1, 'a healthy completed resample closes its own dialog');
		held = true;
		await act(async () => render('resample'));
		await act(async () => press(ENGLISH_COPY.resample));
		assert.equal(closed, 1, 'the source write is still pending');
		await act(async () => press(ENGLISH_COPY.cancel));
		assert.equal(closed, 2, 'ordinary Cancel immediately retires the pending dialog');
		await act(async () => render('revert-factory'));
		assert.equal(dom.one('[role="dialog"]').textContent.includes(ENGLISH_COPY.revertFactorySettings), true);
		await act(async () => { complete(); await Promise.all(operations); });
		assert.equal(closed, 2, 'the retired source-write completion cannot dismiss the newer confirmation');
		assert.equal(dom.one('[role="dialog"]').textContent.includes(ENGLISH_COPY.revertFactorySettings), true);
		await act(async () => press(ENGLISH_COPY.cancel));
		assert.equal(closed, 3, 'the newer confirmation retains its own ordinary Cancel');
	} finally {
		complete();
		await Promise.allSettled(operations);
		await act(async () => root.unmount());
		environment.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
