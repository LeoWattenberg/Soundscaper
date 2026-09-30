/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';

import { useOwnedDialogOperation } from '../src/common/editor/ui/useOwnedDialogOperation.ts';
import { deferred } from './helpers/async-test-control.ts';
import {
	installReactTestDom, reactProps, type ReactTestElement,
} from './helpers/react-test-dom.ts';

test('owned dialog work releases busy state and suppresses callbacks after an owner switch', async () => {
	const first = deferred<string>();
	const events: string[] = [];
	const mounted = await mountHarness('project-a', () => first.promise, events);
	try {
		await start(mounted.dom.container);
		assert.equal(pending(mounted.dom.container), 'work');

		await mounted.render('project-b', () => 'project-b-result');
		assert.equal(pending(mounted.dom.container), '');
		await act(async () => {
			first.resolve('project-a-result');
			await first.promise;
			await Promise.resolve();
		});
		assert.deepEqual(events.filter((event) => event.includes('project-a-result')), []);

		await start(mounted.dom.container);
		assert.deepEqual(events.slice(-3), [
			'start:project-b',
			'success:project-b-result',
			'settled:project-b',
		]);
		assert.equal(pending(mounted.dom.container), '');
	} finally {
		await mounted.unmount();
	}
});

test('owned dialog work admits one operation and suppresses completion after unmount', async () => {
	const completion = deferred<string>();
	const events: string[] = [];
	const mounted = await mountHarness('project-a', () => completion.promise, events);
	await act(async () => {
		const button = buttonWithText(mounted.dom.container, 'Start');
		void reactProps(button).onClick({});
		void reactProps(button).onClick({});
	});
	assert.deepEqual(events, ['owner:project-a', 'start:project-a']);

	await mounted.unmount();
	await act(async () => {
		completion.resolve('late-result');
		await completion.promise;
		await Promise.resolve();
	});
	assert.deepEqual(events, ['owner:project-a', 'start:project-a']);
});

test('reset revokes callbacks and admits replacement work for the same owner', async () => {
	const first = deferred<string>();
	const events: string[] = [];
	const mounted = await mountHarness('project-a', () => first.promise, events);
	try {
		await start(mounted.dom.container);
		await click(mounted.dom.container, 'Reset');
		assert.equal(pending(mounted.dom.container), '');
		await mounted.render('project-a', () => 'replacement-result');
		await act(async () => {
			first.resolve('stale-result');
			await first.promise;
			await Promise.resolve();
		});
		assert.equal(events.includes('success:stale-result'), false);

		await start(mounted.dom.container);
		assert.deepEqual(events.slice(-3), [
			'start:project-a',
			'success:replacement-result',
			'settled:project-a',
		]);
	} finally {
		await mounted.unmount();
	}
});

function Harness({
	owner,
	operation,
	events,
}: Readonly<{
	owner: string;
	operation: () => unknown;
	events: string[];
}>) {
	const state = useOwnedDialogOperation({
		owner,
		blocked: false,
		run: (work) => work(),
		onOwnerChange: () => { events.push(`owner:${owner}`); },
	});
	return <>
		<button type="button" onClick={() => state.perform('work', operation, {
			onStart: () => { events.push(`start:${owner}`); },
			onSuccess: (result) => { events.push(`success:${String(result)}`); },
			onFailure: (failure) => { events.push(`failure:${String(failure)}`); },
			onSettled: () => { events.push(`settled:${owner}`); },
		})}>Start</button>
		<button type="button" onClick={state.reset}>Reset</button>
		<output data-pending>{state.pending}</output>
	</>;
}

async function mountHarness(
	initialOwner: string,
	initialOperation: () => unknown,
	events: string[],
) {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const render = async (owner: string, operation: () => unknown) => {
		await act(async () => root.render(<Harness owner={owner} operation={operation} events={events} />));
	};
	await render(initialOwner, initialOperation);
	return {
		dom,
		render,
		async unmount() {
			await act(async () => root.unmount());
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			dom.restore();
		},
	};
}

async function start(root: ReactTestElement): Promise<void> {
	await click(root, 'Start');
}

async function click(root: ReactTestElement, label: string): Promise<void> {
	await act(async () => {
		void reactProps(buttonWithText(root, label)).onClick({});
		await Promise.resolve();
		await Promise.resolve();
	});
}

function pending(root: ReactTestElement): string {
	return root.querySelector('[data-pending]')?.textContent ?? '';
}

function buttonWithText(root: ReactTestElement, text: string): ReactTestElement {
	const button = root.querySelectorAll('button').find((candidate) => candidate.textContent === text);
	if (!button) throw new Error(`Missing button ${text}.`);
	return button;
}
