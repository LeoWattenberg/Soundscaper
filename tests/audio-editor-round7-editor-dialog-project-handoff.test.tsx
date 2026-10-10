/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import EditorDialog from '../src/common/editor/ui/dialogs/EditorDialog.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

type DialogType = 'clear' | 'delete' | 'projects' | 'resample';

function fixture(type: DialogType) {
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
	const operation = (...args: unknown[]): Promise<string> => {
		calls.push(args);
		return held ? new Promise(resolve => { complete = () => resolve('completed'); }) : Promise.resolve('completed');
	};
	const controller = { actions: {
		project: { clear: operation, remove: operation, openById: operation }, track: { resample: operation },
	} };
	const render = (projectId = 'original'): void => root.render(<EditorDialog
		type={type} value="24000" onValueChange={() => undefined} trackId="track" controller={controller}
		snapshot={{ project: { id: projectId, sampleRate: 48_000 }, selectedTrackId: 'track',
			projects: [{ id: 'saved-target', title: 'Saved target', updatedAt: 0 }] }}
		copy={ENGLISH_COPY} locale="en" run={(action: () => unknown) => {
			const promise = Promise.resolve(action());
			operations.push(promise);
			return promise;
		}} onClose={() => { closed++; root.render(<div />); }} />);
	const press = (label: string): void => {
		const button = dom.container.querySelectorAll('button').find(element => element.textContent.startsWith(label));
		assert.ok(button);
		reactProps(button).onClick?.();
	};
	return {
		render, press, calls, closed: () => closed,
		hold: () => { held = true; },
		finish: async () => { complete(); await Promise.all(operations); },
		cleanup: async () => {
			complete();
			await Promise.allSettled(operations);
			await act(async () => root.unmount());
			environment.IS_REACT_ACT_ENVIRONMENT = priorAct;
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		},
	};
}

for (const [type, label, args] of [
	['clear', ENGLISH_COPY.clearData, []],
	['delete', ENGLISH_COPY.confirmDelete, ['original']],
	['projects', 'Saved target', ['saved-target']],
] as const) {
	test(`${type} closes after its successful action intentionally replaces the active project`, async () => {
		const view = fixture(type);
		try {
			await act(async () => view.render());
			await act(async () => view.press(label));
			assert.equal(view.closed(), 1, 'a healthy completed operation closes its own dialog');
			assert.deepEqual(view.calls, [args]);
			view.hold();
			await act(async () => view.render());
			await act(async () => view.press(label));
			assert.equal(view.closed(), 1, 'the admitted operation remains pending');
			// The real admin action publishes its new project before its awaited save finishes.
			await act(async () => view.render('replacement'));
			await act(async () => view.finish());
			assert.deepEqual(view.calls, [args, args], 'rerender never resubmits the project mutation');
			assert.equal(view.closed(), 2, 'the intentional project handoff retains its successful completion');
		} finally { await view.cleanup(); }
	});
}

test('a pending resample remains fenced when another project replaces its editing target', async () => {
	const view = fixture('resample');
	try {
		view.hold();
		await act(async () => view.render());
		await act(async () => view.press(ENGLISH_COPY.resample));
		await act(async () => view.render('replacement'));
		await act(async () => view.finish());
		assert.deepEqual(view.calls, [['track', 24_000]]);
		assert.equal(view.closed(), 0, 'the stale editing completion cannot dismiss a replacement project surface');
	} finally { await view.cleanup(); }
});

test('a cancelled Clear completion cannot close a newly opened Clear confirmation', async () => {
	const view = fixture('clear');
	try {
		view.hold();
		await act(async () => view.render());
		await act(async () => view.press(ENGLISH_COPY.clearData));
		await act(async () => view.press(ENGLISH_COPY.cancel));
		assert.equal(view.closed(), 1);
		await act(async () => view.render('replacement'));
		await act(async () => view.finish());
		assert.equal(view.closed(), 1, 'unmount still retires the former confirmation even for the same dialog type');
		await act(async () => view.press(ENGLISH_COPY.cancel));
		assert.equal(view.closed(), 2, 'the newer confirmation retains ordinary cancellation');
	} finally { await view.cleanup(); }
});
