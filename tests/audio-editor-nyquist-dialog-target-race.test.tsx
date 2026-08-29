/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';

import NyquistDialog from '../src/common/editor/ui/dialogs/NyquistDialog.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import {
	installReactTestDom, reactProps, type ReactTestElement,
} from './helpers/react-test-dom.ts';

test('a Nyquist completion cannot publish into a different plugin target', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const evaluation = deferred<Readonly<{ type: 'number'; value: number }>>();
	const started = deferred<void>();
	let cancellations = 0;
	const controller = {
		actions: {
			nyquist: {
				evaluate: () => { started.resolve(); return evaluation.promise; },
				preview: () => evaluation.promise,
				cancel: () => { cancellations += 1; return true; },
			},
		},
	};
	const snapshot = { nyquist: { processing: false }, effects: { previewing: false }, readOnly: false };
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const renderDialog = (target: Readonly<{ prompt: boolean; pluginId: string | null }>) => (
		<NyquistDialog
			controller={controller}
			snapshot={snapshot}
			copy={ENGLISH_COPY}
			target={target}
			run={(operation: () => unknown) => operation()}
			onClose={() => undefined}
		/>
	);
	try {
		await act(async () => root.render(renderDialog({ prompt: true, pluginId: null })));
		await act(async () => {
			void reactProps(buttonWithText(dom.container, ENGLISH_COPY.nyquistRun)).onClick({});
			await started.promise;
		});

		await act(async () => root.render(renderDialog({ prompt: false, pluginId: 'nyquist:rms' })));
		assert.equal(cancellations, 1, 'changing targets must retire the active controller evaluation');
		assert.equal(
			buttonWithText(dom.container, ENGLISH_COPY.nyquistApply).hasAttribute('disabled'),
			false,
			'the new target must not inherit the old target busy state',
		);

		await act(async () => {
			evaluation.resolve({ type: 'number', value: 42 });
			await evaluation.promise;
			await Promise.resolve();
		});
		assert.equal(dom.find('.kw-audio-editor__nyquist-output'), null);
	} finally {
		evaluation.resolve({ type: 'number', value: 42 });
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

function deferred<Value>(): Readonly<{
	readonly promise: Promise<Value>;
	readonly resolve: (value: Value) => void;
}> {
	let resolve!: (value: Value) => void;
	const promise = new Promise<Value>((accept) => { resolve = accept; });
	return Object.freeze({ promise, resolve });
}
