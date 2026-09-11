/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';

import DeleteBehaviorOnboardingDialog from
	'../src/common/editor/ui/dialogs/DeleteBehaviorOnboardingDialog.tsx';
import { createDeleteBehaviorConfirmation } from
	'../src/common/editor/ui/dialogs/delete-behavior-confirmation.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import {
	installReactTestDom,
	reactProps,
	type ReactTestElement,
} from './helpers/react-test-dom.ts';

const request = Object.freeze({
	title: 'Choose behavior when deleting a portion of a clip',
	initialDeleteBehavior: 'leave-gap' as const,
	initialCloseGapBehavior: 'track' as const,
});

test('the delete confirmation continuation settles only its exact active prompt', async () => {
	const confirmation = createDeleteBehaviorConfirmation();
	const snapshots: unknown[] = [];
	const unsubscribe = confirmation.subscribe(() => { snapshots.push(confirmation.getSnapshot()); });
	const pending = confirmation.confirm(request);
	const prompt = confirmation.getSnapshot();

	assert.equal(prompt?.initialDeleteBehavior, 'leave-gap');
	assert.equal(prompt?.initialCloseGapBehavior, 'track');
	assert.equal(confirmation.settle({ ...prompt }, { accepted: false }), false);
	assert.equal(confirmation.settle(prompt, {
		accepted: true,
		deleteBehavior: 'close-gap',
		closeGapBehavior: 'track',
	}), true);
	assert.deepEqual(await pending, {
		accepted: true,
		deleteBehavior: 'close-gap',
		closeGapBehavior: 'track',
	});
	assert.deepEqual(snapshots, [prompt, null]);
	unsubscribe();
	confirmation.dispose();
});

test('superseding, project cancellation, and disposal reject pending confirmations', async () => {
	const confirmation = createDeleteBehaviorConfirmation();
	const task = new AbortController();
	const first = confirmation.confirm({ ...request, signal: task.signal });
	const firstRejection = assert.rejects(first, { name: 'AbortError' });
	const second = confirmation.confirm(request);
	await firstRejection;
	const reason = new DOMException('Project changed.', 'AbortError');
	const secondPrompt = confirmation.getSnapshot();
	assert.ok(secondPrompt);
	confirmation.dispose();
	await assert.rejects(second, { name: 'AbortError' });
	await assert.rejects(confirmation.confirm({ ...request, signal: task.signal }), { name: 'AbortError' });
	task.abort(reason);
});

test('the Audacity panel starts at Leave gap and reveals the close-gap scope before Apply', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const confirmation = createDeleteBehaviorConfirmation();
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<DeleteBehaviorOnboardingDialog
			confirmation={confirmation}
			copy={ENGLISH_COPY}
		/>));
		let pending!: Promise<unknown>;
		await act(async () => { pending = confirmation.confirm(request); });
		assert.equal(dom.one('[role="dialog"]').getAttribute('aria-label'), request.title);
		assert.equal(reactProps(input(dom.container, 'delete-behavior', 'leave-gap')).checked, true);
		assert.doesNotMatch(dom.container.textContent || '', /When closing the gap/u);

		await act(async () => {
			reactProps(input(dom.container, 'delete-behavior', 'close-gap')).onChange({
				currentTarget: { checked: true, value: 'close-gap' },
			});
		});
		assert.match(dom.container.textContent || '', /When closing the gap, do the following/u);
		assert.equal(reactProps(input(dom.container, 'close-gap-behavior', 'track')).checked, true);
		await act(async () => {
			reactProps(input(dom.container, 'close-gap-behavior', 'all-tracks')).onChange({
				currentTarget: { checked: true, value: 'all-tracks' },
			});
		});
		await act(async () => {
			reactProps(buttonWithText(dom.container, 'Apply')).onClick({});
			await pending;
		});
		assert.deepEqual(await pending, {
			accepted: true,
			deleteBehavior: 'close-gap',
			closeGapBehavior: 'all-tracks',
		});
		assert.equal(dom.container.querySelector('[role="dialog"]'), null);
	} finally {
		const prompt = confirmation.getSnapshot();
		if (prompt) confirmation.settle(prompt, { accepted: false });
		confirmation.dispose();
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});

function input(container: ReactTestElement, name: string, value: string): ReactTestElement {
	const element = [...container.querySelectorAll('input')].find((candidate) => {
		const props = reactProps(candidate) as unknown as Readonly<{ name?: unknown; value?: unknown }>;
		return props.name === name && props.value === value;
	});
	assert.ok(element, `Expected ${name}=${value}.`);
	return element;
}

function buttonWithText(container: ReactTestElement, text: string): ReactTestElement {
	const button = [...container.querySelectorAll('button')]
		.find((candidate) => candidate.textContent?.trim() === text);
	assert.ok(button, `Expected a ${text} button.`);
	return button;
}
