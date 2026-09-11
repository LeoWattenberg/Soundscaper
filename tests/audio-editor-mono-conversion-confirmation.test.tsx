/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';

import MonoConversionConfirmationDialog from
	'../src/common/editor/ui/dialogs/MonoConversionConfirmationDialog.tsx';
import { createMonoConversionConfirmation } from
	'../src/common/editor/ui/dialogs/mono-conversion-confirmation.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import {
	installReactTestDom,
	reactProps,
	type ReactTestElement,
} from './helpers/react-test-dom.ts';

const request = Object.freeze({
	title: 'Mix down to mono',
	body: 'Stereo audio must be converted.',
	plan: Object.freeze({ disposition: 'confirm' as const, targets: Object.freeze([]) }),
});

test('the confirmation continuation publishes one prompt and settles its exact request', async () => {
	const confirmation = createMonoConversionConfirmation();
	const snapshots: unknown[] = [];
	const unsubscribe = confirmation.subscribe(() => { snapshots.push(confirmation.getSnapshot()); });
	const pending = confirmation.confirm(request);
	const prompt = confirmation.getSnapshot();

	assert.equal(prompt?.title, request.title);
	assert.deepEqual(snapshots, [prompt]);
	assert.equal(confirmation.settle({ ...prompt }, { accepted: true, dontShowAgain: false }), false);
	assert.equal(confirmation.settle(prompt, { accepted: true, dontShowAgain: true }), true);
	assert.deepEqual(await pending, { accepted: true, dontShowAgain: true });
	assert.equal(confirmation.getSnapshot(), null);
	assert.deepEqual(snapshots, [prompt, null]);
	unsubscribe();
});

test('a replacement rejects the old prompt and disposal is terminal', async () => {
	const confirmation = createMonoConversionConfirmation();
	const first = confirmation.confirm(request);
	const firstPrompt = confirmation.getSnapshot();
	const firstRejected = assert.rejects(first, { name: 'AbortError' });
	const second = confirmation.confirm(request);
	const secondPrompt = confirmation.getSnapshot();

	await firstRejected;
	assert.notEqual(firstPrompt, secondPrompt);
	assert.equal(confirmation.settle(firstPrompt, { accepted: false, dontShowAgain: false }), false);
	confirmation.dispose();
	await assert.rejects(second, { name: 'AbortError' });
	await assert.rejects(confirmation.confirm(request), { name: 'AbortError' });
});

test('project-task cancellation dismisses and rejects the matching prompt', async () => {
	const confirmation = createMonoConversionConfirmation();
	const task = new AbortController();
	const pending = confirmation.confirm({ ...request, signal: task.signal });
	const prompt = confirmation.getSnapshot();
	const reason = new DOMException('The project changed.', 'AbortError');

	task.abort(reason);

	await assert.rejects(pending, (error: unknown) => error === reason);
	assert.equal(confirmation.getSnapshot(), null);
	assert.equal(confirmation.settle(prompt, { accepted: true, dontShowAgain: false }), false);
	confirmation.dispose();
});

test('the Audacity confirmation exposes Cancel, Yes, and the prompt-level opt-out', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const confirmation = createMonoConversionConfirmation();
	const decisions: unknown[] = [];
	const originalSettle = confirmation.settle;
	const settlingConfirmation = { ...confirmation, settle: (...args: Parameters<typeof originalSettle>) => {
		decisions.push(args[1]);
		return originalSettle(...args);
	} };
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<MonoConversionConfirmationDialog
			confirmation={settlingConfirmation}
			copy={ENGLISH_COPY}
		/>));
		let pending!: Promise<unknown>;
		await act(async () => { pending = confirmation.confirm(request); });
		assert.equal(dom.one('[role="dialog"]').getAttribute('aria-label'), request.title);
		assert.match(dom.container.textContent || '', /Stereo audio must be converted/u);
		assert.match(dom.container.textContent || '', /Don’t show again/u);
		const checkbox = dom.one('input');
		await act(async () => {
			reactProps(checkbox as ReactTestElement).onChange({ currentTarget: { checked: true } });
		});
		await act(async () => {
			reactProps(buttonWithText(dom.container, 'Yes')).onClick({});
			await pending;
		});
		assert.deepEqual(decisions, [{ accepted: true, dontShowAgain: true }]);
		assert.equal(dom.container.querySelector('[role="dialog"]'), null);
	} finally {
		const openPrompt = confirmation.getSnapshot();
		if (openPrompt) await act(async () => {
			confirmation.settle(openPrompt, { accepted: false, dontShowAgain: false });
		});
		confirmation.dispose();
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});

function buttonWithText(container: ReactTestElement, text: string): ReactTestElement {
	const button = [...container.querySelectorAll('button')]
		.find((candidate) => candidate.textContent?.trim() === text);
	assert.ok(button, `Expected a ${text} button.`);
	return button as unknown as ReactTestElement;
}
