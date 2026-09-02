/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useRef } from 'react';

import { useMenuTriggerDismissal } from '../src/common/editor/ui/use-menu-trigger-dismissal.ts';
import { editorToolbarFocusables } from '../src/common/editor/ui/workspace-shortcuts.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

type Listener = (event: Event) => void;

// A stand-in for the document the vendored ContextMenu listens on: it records
// capture-phase pointerdown listeners so the test can dispatch to them in
// registration order, exactly as a browser would.
function fakeOwnerDocument() {
	const listeners: Listener[] = [];
	return {
		listeners,
		addEventListener(type: string, listener: Listener, capture?: boolean) {
			if (type === 'pointerdown' && capture) listeners.push(listener);
		},
		removeEventListener(type: string, listener: Listener) {
			const index = listeners.indexOf(listener);
			if (index >= 0) listeners.splice(index, 1);
		},
		dispatch(target: unknown) {
			for (const listener of [...listeners]) listener({ target } as unknown as Event);
		},
	};
}

async function mountGuard(ownerDocument: ReturnType<typeof fakeOwnerDocument>, trigger: object) {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let consume: (() => boolean) | null = null;
	function Harness({ isOpen }: { isOpen: boolean }) {
		const triggerRef = useRef(trigger as Element);
		consume = useMenuTriggerDismissal(triggerRef, isOpen);
		return null;
	}
	const render = async (isOpen: boolean) => {
		await act(async () => root.render(<Harness isOpen={isOpen} />));
	};
	await render(false);
	return {
		render,
		consume: () => {
			assert.ok(consume, 'the guard rendered');
			return consume();
		},
		cleanup: async () => {
			await act(async () => root.unmount());
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			dom.restore();
		},
	};
}

test('a pointer press on the trigger of an open menu is remembered before the menu sees it, then consumed once', async () => {
	const ownerDocument = fakeOwnerDocument();
	const node = { ownerDocument: null as unknown };
	const trigger = { ownerDocument, contains: (candidate: unknown) => candidate === node };
	const guard = await mountGuard(ownerDocument, trigger);
	try {
		assert.equal(ownerDocument.listeners.length, 1, 'the guard listens from mount, ahead of any menu');
		// The menu registers its own outside-pointerdown listener only once open.
		let menuClosedBy: unknown = null;
		ownerDocument.addEventListener('pointerdown', (event) => { menuClosedBy = event.target; }, true);

		await guard.render(true);
		ownerDocument.dispatch(node);
		assert.equal(menuClosedBy, node, 'the menu still closes on the press');
		assert.equal(guard.consume(), true, 'the click that follows is a dismissal, not a request to open');
		assert.equal(guard.consume(), false, 'the record clears once consumed');

		await guard.render(true);
		ownerDocument.dispatch({ elsewhere: true });
		assert.equal(guard.consume(), false, 'a press elsewhere is an ordinary outside close');

		await guard.render(false);
		ownerDocument.dispatch(node);
		assert.equal(guard.consume(), false, 'pressing the trigger of a closed menu opens it as usual');
	} finally {
		await guard.cleanup();
	}
	assert.equal(ownerDocument.listeners.length, 1, 'unmounting removes the guard listener');
});

test('toolbar roving focus skips the vendored checkbox when it is disabled', () => {
	const element = (attributes: Record<string, string>, className = '') => ({
		className,
		matches: (selector: string) => selector.split(',').some((part) => {
			const candidate = part.trim();
			if (candidate === ':disabled') return attributes.disabled === 'true';
			if (candidate === '[aria-disabled="true"]') return attributes['aria-disabled'] === 'true';
			if (candidate === '[role="checkbox"].checkbox--disabled') {
				return attributes.role === 'checkbox' && className.split(' ').includes('checkbox--disabled');
			}
			return false;
		}),
		getAttribute: (name: string) => attributes[name] ?? null,
		closest: () => null,
		getClientRects: () => [{}],
	});
	const enabled = element({ role: 'checkbox' }, 'checkbox checkbox--unchecked');
	const disabled = element({ role: 'checkbox' }, 'checkbox checkbox--unchecked checkbox--disabled');
	const button = element({});
	const toolbar = { querySelectorAll: () => [button, enabled, disabled] } as unknown as Element;
	assert.deepEqual(editorToolbarFocusables(toolbar), [button, enabled]);
});
