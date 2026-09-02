/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';

import { installReactTestDom } from './helpers/react-test-dom.ts';
import { resilientModuleLoader } from '../src/common/offline/lazy-module.tsx';
import {
	dismissStaleBuild,
	installStaleBuildDetection,
	staleBuildSnapshot,
	subscribeStaleBuild,
} from '../src/common/offline/stale-build-runtime.ts';
import type { StaleBuildVerdict } from '../src/common/offline/stale-build.ts';

const RUNNING_MODULE = 'https://soundscaper.org/assets/index-D6uVhEs0.js';
const RETIRED_CHUNK = new TypeError(
	'Failed to fetch dynamically imported module: https://soundscaper.org/assets/ExportDialog-a1.js',
);

function install(verdict: StaleBuildVerdict = 'stale') {
	const target = new EventTarget();
	const reloads: number[] = [];
	const teardown = installStaleBuildDetection({
		moduleUrl: RUNNING_MODULE,
		target,
		probe: () => Promise.resolve(verdict),
		discard: (options) => { options.reload(); return Promise.resolve(); },
		reload: () => { reloads.push(1); },
	});
	return { target, teardown, reloads };
}

/** One turn is enough: the injected probe resolves immediately. */
const settle = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); };

/** Mounts an element for real, so its mount effects run, then takes it back down. */
async function mount(element: React.ReactElement): Promise<void> {
	const dom = installReactTestDom();
	const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
	actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => { root.render(element); });
		await act(async () => { root.unmount(); });
	} finally {
		actEnvironment.IS_REACT_ACT_ENVIRONMENT = priorActEnvironment;
		dom.restore();
	}
}

test('a preload error on the window drives the shared snapshot', async () => {
	const { target, teardown } = install();
	const seen: string[] = [];
	const unsubscribe = subscribeStaleBuild(() => seen.push(staleBuildSnapshot().status));
	try {
		const event = new Event('vite:preloadError');
		Object.assign(event, { payload: RETIRED_CHUNK });
		target.dispatchEvent(event);
		assert.equal(staleBuildSnapshot().status, 'checking');
		await settle();
		assert.equal(staleBuildSnapshot().prompting, true);
		assert.deepEqual(seen, ['checking', 'prompting']);
	} finally {
		unsubscribe();
		teardown();
	}
});

test('an unhandled rejection carrying a retired chunk is treated the same way', async () => {
	const { target, teardown } = install();
	try {
		const event = new Event('unhandledrejection');
		Object.assign(event, { reason: RETIRED_CHUNK });
		target.dispatchEvent(event);
		await settle();
		assert.equal(staleBuildSnapshot().prompting, true);
	} finally {
		teardown();
	}
});

test('teardown detaches the listeners and returns the snapshot to idle', async () => {
	const { target, teardown } = install();
	teardown();
	assert.equal(staleBuildSnapshot().status, 'idle');
	const event = new Event('vite:preloadError');
	Object.assign(event, { payload: RETIRED_CHUNK });
	target.dispatchEvent(event);
	await settle();
	assert.equal(staleBuildSnapshot().status, 'idle');
});

test('a retired lazy surface resolves to a component that renders nothing and reports', async () => {
	const { teardown } = install();
	try {
		const load = resilientModuleLoader<Record<string, never>>(() => Promise.reject(RETIRED_CHUNK));
		const module = await load();
		assert.equal(renderToStaticMarkup(React.createElement(module.default)), '');
		await settle();
		assert.equal(staleBuildSnapshot().prompting, true);
	} finally {
		teardown();
	}
});

test('the placeholder closes the surface it stood in for so its menu entry stays live', async () => {
	const { teardown } = install();
	try {
		const load = resilientModuleLoader<{ onClose?: () => void }>(() => Promise.reject(RETIRED_CHUNK));
		const Placeholder = (await load()).default;
		const closes: number[] = [];
		await mount(React.createElement(Placeholder, { onClose: () => closes.push(1) }));
		assert.deepEqual(closes, [1]);
	} finally {
		teardown();
	}
});

test('the placeholder stays silent on the mount that follows its own failure', async () => {
	const { teardown } = install();
	try {
		const load = resilientModuleLoader<{ onClose?: () => void }>(() => Promise.reject(RETIRED_CHUNK));
		const Placeholder = (await load()).default;
		await settle();
		assert.equal(staleBuildSnapshot().prompting, true);

		// The user cancels before the module resolution has even reached React.
		dismissStaleBuild();
		assert.equal(staleBuildSnapshot().prompting, false);
		await mount(React.createElement(Placeholder, {}));
		await settle();
		assert.equal(staleBuildSnapshot().prompting, false, 'a dismissed prompt must not return on its own');

		// Reaching for the surface again mounts it a second time, which does explain itself.
		await mount(React.createElement(Placeholder, {}));
		await settle();
		assert.equal(staleBuildSnapshot().prompting, true);
	} finally {
		teardown();
	}
});

test('a fault inside a chunk that did load is rethrown rather than absorbed', async () => {
	const { teardown } = install();
	try {
		const fault = new TypeError('effects.registerRack is not a function');
		const load = resilientModuleLoader<Record<string, never>>(() => Promise.reject(fault));
		await assert.rejects(load(), (error: unknown) => error === fault);
		assert.equal(staleBuildSnapshot().status, 'idle');
	} finally {
		teardown();
	}
});

test('a surface that loads normally is passed straight through', async () => {
	const { teardown } = install();
	try {
		const Surface = () => React.createElement('p', null, 'loaded');
		const load = resilientModuleLoader<Record<string, never>>(() => Promise.resolve({ default: Surface }));
		assert.equal((await load()).default, Surface);
		assert.equal(staleBuildSnapshot().status, 'idle');
	} finally {
		teardown();
	}
});

test('a proved stale build reloads through the shared runtime', async () => {
	const { target, teardown, reloads } = install();
	try {
		const event = new Event('vite:preloadError');
		Object.assign(event, { payload: RETIRED_CHUNK });
		target.dispatchEvent(event);
		await settle();
		const { reloadStaleBuild } = await import('../src/common/offline/stale-build-runtime.ts');
		await reloadStaleBuild();
		assert.deepEqual(reloads, [1]);
		assert.equal(staleBuildSnapshot().status, 'reloading');
	} finally {
		teardown();
	}
});
