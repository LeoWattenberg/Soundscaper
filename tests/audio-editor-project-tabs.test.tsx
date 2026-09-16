/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';

import ProjectTabs from '../src/common/editor/ui/workspace/ProjectTabs.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps, ReactTestElement } from './helpers/react-test-dom.ts';

test('project tab close buttons identify their project and close it without selecting it', async () => {
	const mounted = await mountTabs();
	try {
		const close = mounted.dom.one('[aria-label="Close project: First project"]');
		assert.equal(close.nodeName, 'BUTTON');
		assert.equal(close.textContent, '×');
		const parent = close.parentNode;
		assert.ok(parent instanceof ReactTestElement);
		assert.equal(parent.querySelector('[role="tab"]')?.textContent, 'First project');
		assert.equal(parent.nodeName, 'DIV', 'close and select are separate buttons');
		await act(async () => { reactProps(close).onClick({ currentTarget: close }); });
		assert.deepEqual(mounted.closed, ['first']);
		assert.deepEqual(mounted.selected, []);
		assert.equal(mounted.dom.one('[aria-selected="true"]').textContent, 'Second project');
	} finally {
		await mounted.cleanup();
	}
});

test('focus returns to the active tab only after the requested tab actually closes', async () => {
	const mounted = await mountTabs();
	try {
		const close = mounted.dom.one('[aria-label="Close project: Second project"]');
		close.focus();
		await act(async () => { reactProps(close).onClick({ currentTarget: close }); });
		await mounted.render();
		assert.equal(close.ownerDocument.activeElement, close, 'a pending or failed close keeps its focus');
		close.ownerDocument.activeElement = close.ownerDocument.body;
		await mounted.render([{ id: 'first', title: 'First project' }], 'first');
		assert.equal(close.ownerDocument.activeElement, mounted.dom.one('[role="tab"]'));
	} finally {
		await mounted.cleanup();
	}
});

test('closing a tab does not take focus away from another control during a delayed save', async () => {
	const mounted = await mountTabs();
	try {
		const close = mounted.dom.one('[aria-label="Close project: First project"]');
		await act(async () => { reactProps(close).onClick({ currentTarget: close }); });
		const newProject = mounted.dom.one('[aria-label="New project"]');
		newProject.focus();
		await mounted.render([{ id: 'second', title: 'Second project' }]);
		assert.equal(close.ownerDocument.activeElement, newProject);
	} finally {
		await mounted.cleanup();
	}
});

test('project close buttons share the disabled state and retain one keyboard-accessible close action', async () => {
	const mounted = await mountTabs();
	try {
		assert.equal(mounted.dom.one('[aria-label="Close project: First project"]').getAttribute('tabindex'), '-1');
		assert.equal(mounted.dom.one('[aria-label="Close project: Second project"]').getAttribute('tabindex'), '0');
		await mounted.render(undefined, undefined, true);
		for (const button of mounted.dom.container.querySelectorAll('button')) {
			assert.ok(button.hasAttribute('disabled'));
		}
	} finally {
		await mounted.cleanup();
	}
});

async function mountTabs() {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const closed: string[] = [];
	const selected: string[] = [];
	const render = async (
		projects = [{ id: 'first', title: 'First project' }, { id: 'second', title: 'Second project' }],
		activeProjectId = 'second',
		disabled = false,
	) => {
		await act(async () => root.render(<ProjectTabs
			projects={projects}
			activeProjectId={activeProjectId}
			copy={ENGLISH_COPY}
			disabled={disabled}
			onSelect={(id: string) => { selected.push(id); }}
			onClose={(id: string) => { closed.push(id); }}
			onNew={() => undefined}
		/>));
	};
	await render();
	return {
		dom, closed, selected, render,
		cleanup: async () => {
			await act(async () => root.unmount());
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		},
	};
}
