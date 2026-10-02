/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';
import { createFileSizeWarningConfirmation } from '../src/common/editor/controller/shared/file-size-warning-confirmation.ts';
import FileSizeWarningDialog from '../src/common/editor/ui/dialogs/FileSizeWarningDialog.tsx';

test('a file size warning shows the size and requires Continue or Cancel for each operation', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const confirmation = createFileSizeWarningConfirmation();
	try {
		await act(async () => { root.render(<FileSizeWarningDialog confirmation={confirmation} copy={{ cancel: 'Cancel' }} />); });
		let decision!: Promise<boolean>;
		await act(async () => { decision = confirmation.confirm({ label: 'large.wav', byteLength: 2048, thresholdBytes: 1024 }); });
		assert.match(dom.container.textContent ?? '', /large.wav/);
		assert.match(dom.container.textContent ?? '', /2 KiB/);
		assert.match(dom.container.textContent ?? '', /1 KiB/);
		await act(async () => { reactProps(buttonWithText(dom.container, 'Continue')).onClick({}); });
		assert.equal(await decision, true);
		await act(async () => { decision = confirmation.confirm({ label: 'second.wav', byteLength: 2048, thresholdBytes: 1024 }); });
		await act(async () => { reactProps(buttonWithText(dom.container, 'Cancel')).onClick({}); });
		assert.equal(await decision, false);
		assert.equal(dom.container.querySelector('[data-file-size-warning]'), null);
	} finally {
		await act(async () => { root.unmount(); });
		confirmation.dispose();
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

function buttonWithText(container: ReactTestElement, text: string): ReactTestElement {
	const button = [...container.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === text);
	assert.ok(button, `Expected a ${text} button.`);
	return button as unknown as ReactTestElement;
}
