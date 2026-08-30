/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';

import EditorDialog from '../src/common/editor/ui/dialogs/EditorDialog.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import {
	installReactTestDom, reactProps, type ReactTestElement,
} from './helpers/react-test-dom.ts';

test('delete confirmation cannot target a project activated after the prompt opened', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const removals: unknown[] = [];
	let closes = 0;
	const controller = {
		actions: {
			project: { remove: (projectId?: unknown) => { removals.push(projectId); } },
		},
	};
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const renderDialog = (projectId: string) => <EditorDialog
		type="delete"
		value=""
		onValueChange={() => undefined}
		onSourceKeyChange={() => undefined}
		trackId={null}
		controller={controller}
		snapshot={{ project: { id: projectId }, recordingInputs: {} }}
		copy={ENGLISH_COPY}
		aboutLabel="About"
		locale="en"
		run={(operation: () => unknown) => operation()}
		onClose={() => { closes += 1; }}
	/>;
	try {
		await act(async () => root.render(renderDialog('project-a')));
		await act(async () => root.render(renderDialog('project-b')));
		await act(async () => {
			void reactProps(buttonWithText(dom.container, ENGLISH_COPY.confirmDelete)).onClick({});
		});

		assert.deepEqual(removals, [], 'project B must survive project A confirmation');
		assert.equal(closes, 1);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});

test('a mutation dialog stays open when the shared runner reports a synchronous failure', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const expected = new Error('rename refused');
	const reported: unknown[] = [];
	let closes = 0;
	const controller = {
		actions: { project: { rename: () => { throw expected; } } },
	};
	const run = (operation: () => unknown): unknown => {
		try {
			const result = operation();
			if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
				void Promise.resolve(result).catch((error: unknown) => { reported.push(error); });
			}
			return result;
		} catch (error) {
			reported.push(error);
			return undefined;
		}
	};
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<EditorDialog
			type="rename"
			value="New project name"
			onValueChange={() => undefined}
			onSourceKeyChange={() => undefined}
			trackId={null}
			controller={controller}
			snapshot={{ project: { id: 'project-a' }, recordingInputs: {} }}
			copy={ENGLISH_COPY}
			aboutLabel="About"
			locale="en"
			run={run}
			onClose={() => { closes += 1; }}
		/>));
		await act(async () => {
			void reactProps(dom.one('form')).onSubmit({ preventDefault() {} });
			await Promise.resolve();
			await Promise.resolve();
		});
		assert.equal(closes, 0);
		assert.deepEqual(reported, [expected]);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});

test('the track-rate dialog waits for async action success before closing', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const expected = new Error('sample rate update refused');
	const rejectedRate = Promise.reject(expected);
	void rejectedRate.catch(() => undefined);
	const reported: unknown[] = [];
	let closes = 0;
	const controller = {
		actions: { track: { setRate: () => rejectedRate } },
	};
	const run = (operation: () => unknown): unknown => {
		try {
			const result = operation();
			if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
				void Promise.resolve(result).catch((error: unknown) => { reported.push(error); });
			}
			return result;
		} catch (error) {
			reported.push(error);
			return undefined;
		}
	};
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<EditorDialog
			type="track-rate"
			value="96000"
			onValueChange={() => undefined}
			onSourceKeyChange={() => undefined}
			trackId="track-a"
			controller={controller}
			snapshot={{ project: { id: 'project-a' }, recordingInputs: {} }}
			copy={ENGLISH_COPY}
			aboutLabel="About"
			locale="en"
			run={run}
			onClose={() => { closes += 1; }}
		/>));
		await act(async () => {
			void reactProps(dom.one('form')).onSubmit({ preventDefault() {} });
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
		});
		assert.equal(closes, 0);
		assert.deepEqual(reported, [expected]);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});

function buttonWithText(root: ReactTestElement, text: string): ReactTestElement {
	const button = root.querySelectorAll('button').find((candidate) => candidate.textContent === text);
	if (!button) throw new Error(`Missing button ${text}.`);
	return button;
}
