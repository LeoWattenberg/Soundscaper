/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';

import GeneratorDialog from '../src/common/editor/ui/dialogs/GeneratorDialog.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

test('a pending generator admits only one Generate activation', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const generation = deferred<void>();
	const generatedTypes: string[] = [];
	let closes = 0;
	try {
		await act(async () => root.render(<GeneratorDialog
			type="silence"
			controller={{ actions: { generators: { generate: (type: string) => {
				generatedTypes.push(type);
				return generation.promise;
			} } } }}
			copy={ENGLISH_COPY}
			locale="en"
			run={(operation: () => unknown) => operation()}
			onClose={() => { closes += 1; }}
		/>));
		const generate = buttonWithText(dom.container, ENGLISH_COPY.generate);
		await act(async () => {
			reactProps(generate).onClick();
			reactProps(generate).onClick();
			await Promise.resolve();
		});
		assert.deepEqual(generatedTypes, ['silence']);
		assert.equal(reactProps(buttonWithText(dom.container, ENGLISH_COPY.generate)).disabled, true);
		await act(async () => {
			generation.resolve();
			await generation.promise;
		});
		assert.equal(closes, 1);
	} finally {
		generation.resolve();
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});

function buttonWithText(root: ReactTestElement, label: string): ReactTestElement {
	const button = root.querySelectorAll('button').find((candidate) => candidate.textContent?.trim() === label);
	assert.ok(button, `Missing button ${label}.`);
	return button;
}

function deferred<Value>() {
	let resolve!: (value: Value) => void;
	const promise = new Promise<Value>((complete) => { resolve = complete; });
	return { promise, resolve };
}
