/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import StaleBuildDialog from '../src/common/site/StaleBuildDialog.jsx';
import {
	installReactTestDom, reactProps, type ReactTestDom, type ReactTestElement,
} from './helpers/react-test-dom.ts';
import {
	installStaleBuildDetection,
	staleBuildSnapshot,
} from '../src/common/offline/stale-build-runtime.ts';

const RUNNING_MODULE = 'https://soundscaper.org/assets/index-D6uVhEs0.js';
const RETIRED_CHUNK = new TypeError(
	'Failed to fetch dynamically imported module: https://soundscaper.org/assets/ExportDialog-a1.js',
);
const COPY = Object.freeze({
	staleBuildTitle: 'This tab is running an old build',
	staleBuildMessage: 'Reload to pick up the published one.',
	staleBuildCancel: 'Not now',
	staleBuildReload: 'Reload',
});

/** One turn is enough: the injected probe resolves immediately. */
const settle = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); };

/**
 * The dialog reads a module-level store, so a mounted root and an installed
 * controller have to come down together however the test ends.
 */
function harness() {
	const dom = installReactTestDom();
	const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
	// The dialog is a .jsx module, which compiles to the classic runtime here.
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
	const reloads: number[] = [];
	const target = new EventTarget();
	const teardown = installStaleBuildDetection({
		moduleUrl: RUNNING_MODULE,
		target,
		probe: () => Promise.resolve('stale'),
		discard: (options) => { options.reload(); return Promise.resolve(); },
		reload: () => { reloads.push(1); },
	});
	let root: Root | null = null;
	return {
		dom,
		reloads,
		async render(): Promise<void> {
			root ??= createRoot(dom.container as unknown as Element);
			await act(async () => { root?.render(React.createElement(StaleBuildDialog, { copy: COPY })); });
		},
		async retire(): Promise<void> {
			const event = new Event('vite:preloadError');
			Object.assign(event, { payload: RETIRED_CHUNK });
			await act(async () => { target.dispatchEvent(event); await settle(); });
		},
		async close(): Promise<void> {
			if (root) await act(async () => { root?.unmount(); });
			actEnvironment.IS_REACT_ACT_ENVIRONMENT = priorActEnvironment;
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
			else Reflect.deleteProperty(globalThis, 'React');
			teardown();
			dom.restore();
		},
	};
}

function click(node: ReactTestElement): unknown {
	return reactProps(node).onClick?.({});
}

function actions(dom: ReactTestDom): ReactTestElement[] {
	return dom.one('.stale-build-actions').querySelectorAll('button');
}

test('an idle store renders no prompt at all', async () => {
	const context = harness();
	try {
		await context.render();
		assert.equal(context.dom.find('[data-stale-build-overlay]'), null);
	} finally {
		await context.close();
	}
});

test('a retired build prompts with a labelled alert dialog and focuses reloading', async () => {
	const context = harness();
	try {
		await context.render();
		await context.retire();
		const surface = context.dom.one('[role="alertdialog"]');
		assert.equal(surface.getAttribute('aria-modal'), 'true');
		assert.equal(surface.getAttribute('aria-labelledby'), 'stale-build-title');
		assert.equal(surface.getAttribute('aria-describedby'), 'stale-build-message');
		assert.equal(context.dom.one('[id="stale-build-title"]').textContent, COPY.staleBuildTitle);
		assert.equal(context.dom.one('[id="stale-build-message"]').textContent, COPY.staleBuildMessage);
		// The prompt interrupts, so the recovery it recommends is what the keyboard
		// lands on rather than the dismissal beside it.
		assert.equal(context.dom.container.ownerDocument.activeElement,
			context.dom.one('[data-stale-build-reload]'));
	} finally {
		await context.close();
	}
});

test('declining the prompt closes it without reloading', async () => {
	const context = harness();
	try {
		await context.render();
		await context.retire();
		await act(async () => { click(actions(context.dom)[0]!); });
		assert.equal(staleBuildSnapshot().status, 'dismissed');
		assert.equal(context.dom.find('[data-stale-build-overlay]'), null);
		assert.deepEqual(context.reloads, []);
	} finally {
		await context.close();
	}
});

test('confirming reloads once and holds the prompt open with both actions inert', async () => {
	const context = harness();
	try {
		await context.render();
		await context.retire();
		await act(async () => { click(context.dom.one('[data-stale-build-reload]')); await settle(); });
		assert.equal(staleBuildSnapshot().status, 'reloading');
		assert.deepEqual(context.reloads, [1]);
		// The tab is on its way out, so the prompt stays up rather than flashing
		// back to the surface that could not load, and neither button acts again.
		assert.ok(context.dom.find('[data-stale-build-overlay]'));
		for (const button of actions(context.dom)) {
			assert.ok(button.hasAttribute('disabled'), 'a reloading tab still offers a live button');
		}
		await act(async () => { click(context.dom.one('[data-stale-build-reload]')); await settle(); });
		assert.deepEqual(context.reloads, [1]);
	} finally {
		await context.close();
	}
});
