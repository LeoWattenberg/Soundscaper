/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';

import DesktopSpeedWarmupGate from '../src/common/editor/ui/DesktopSpeedWarmupGate.tsx';
import { installReactTestDom } from './helpers/react-test-dom.ts';

type Mode = 'memory' | 'speed';

function controllerFor(initialReady: boolean, initialMode: Mode) {
	let snapshot = Object.freeze({ ready: initialReady, preferences: { performance: { optimizeFor: initialMode } } });
	const listeners = new Set<() => void>();
	return {
		getSnapshot: () => snapshot,
		subscribe: (listener: () => void) => {
			listeners.add(listener);
			return () => { listeners.delete(listener); };
		},
		publish(ready: boolean, optimizeFor: Mode) {
			snapshot = Object.freeze({ ready, preferences: { performance: { optimizeFor } } });
			for (const listener of listeners) listener();
		},
	};
}

test('desktop Speed warms after readiness, blocks interactions, and keeps the mounted workspace', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const controller = controllerFor(false, 'memory');
	let finishWarmup!: () => void;
	const pending = new Promise<void>((resolve) => { finishWarmup = resolve; });
	let warmupCalls = 0;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => {
			root.render(<DesktopSpeedWarmupGate controller={controller} desktop productId="soundscaper"
				locale="en" copy={{}} loadWarmup={async () => { warmupCalls += 1; await pending; }}>
				<button type="button" data-mounted-workspace="true">Workspace</button>
			</DesktopSpeedWarmupGate>);
		});
		const workspace = dom.one('[data-mounted-workspace="true"]');
		assert.equal(dom.find('[data-desktop-speed-warmup]'), null);
		await act(async () => { controller.publish(true, 'speed'); });
		const gate = dom.one('[data-desktop-speed-warmup="loading"]');
		assert.equal(gate.hasAttribute('inert'), true);
		assert.equal(gate.getAttribute('aria-busy'), 'true');
		assert.equal(dom.one('[data-mounted-workspace="true"]'), workspace);
		assert.equal(warmupCalls, 1);
		await act(async () => { controller.publish(true, 'memory'); });
		assert.equal(dom.one('[data-desktop-speed-warmup="loading"]'), gate);
		assert.equal(warmupCalls, 1);
		await act(async () => { finishWarmup(); await pending; });
		assert.equal(gate.getAttribute('data-desktop-speed-warmup'), 'ready');
		assert.equal(gate.getAttribute('data-desktop-speed-warmup-failed'), '0');
		assert.equal(gate.hasAttribute('inert'), false);
		assert.equal(dom.one('[data-mounted-workspace="true"]'), workspace);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

test('web and initial Memory mode do not warm after a live switch to Speed', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const controller = controllerFor(true, 'memory');
	let warmupCalls = 0;
	const loadWarmup = async () => { warmupCalls += 1; };
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => {
			root.render(<DesktopSpeedWarmupGate controller={controller} desktop productId="framescaper"
				locale="en" copy={{}} loadWarmup={loadWarmup}><span>Workspace</span></DesktopSpeedWarmupGate>);
		});
		await act(async () => { controller.publish(true, 'speed'); });
		assert.equal(warmupCalls, 0);
		assert.equal(dom.find('[data-desktop-speed-warmup]'), null);
		await act(async () => {
			root.render(<DesktopSpeedWarmupGate controller={controller} desktop={false} productId="framescaper"
				locale="en" copy={{}} loadWarmup={loadWarmup}><span>Workspace</span></DesktopSpeedWarmupGate>);
		});
		assert.equal(warmupCalls, 0);
		assert.equal(dom.find('[data-desktop-speed-warmup]'), null);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

test('desktop Speed releases the gate after a fatal warmup failure and invokes once in Strict Mode', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const controller = controllerFor(true, 'speed');
	let warmupCalls = 0;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => {
			root.render(<React.StrictMode><DesktopSpeedWarmupGate controller={controller} desktop
				productId="soundscaper" locale="en" copy={{}}
				loadWarmup={async () => { warmupCalls += 1; throw new Error('manifest unavailable'); }}>
				<button type="button">Workspace</button>
			</DesktopSpeedWarmupGate></React.StrictMode>);
		});
		assert.equal(warmupCalls, 1);
		const gate = dom.one('[data-desktop-speed-warmup="ready"]');
		assert.equal(gate.getAttribute('data-desktop-speed-warmup-failed'), 'fatal');
		assert.equal(gate.hasAttribute('inert'), false);
		assert.equal(dom.one('button').textContent, 'Workspace');
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
