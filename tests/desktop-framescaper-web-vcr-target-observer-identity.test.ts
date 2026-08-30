/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	FRAMESCAPER_WEB_VCR_TARGET_BINDING,
	createFramescaperWebVcrTargetObserverV1,
	type FramescaperWebVcrDebuggerPort,
} from '../desktop/framescaper-web-vcr-target-observer.ts';

test('target identity churn never renames a candidate that remains live', async () => {
	const listeners = new Set<(event: unknown, method: string, parameters: unknown) => void>();
	let nextIdentity = 1;
	const stableIdentities: string[] = [];
	const debuggerPort: FramescaperWebVcrDebuggerPort = {
		isAttached: () => true,
		attach: () => undefined,
		detach: () => undefined,
		sendCommand: async (method) => method === 'Page.getFrameTree'
			? { frameTree: { frame: { id: 'main-frame' } } }
			: {},
		on: (_name, listener) => { listeners.add(listener); },
		removeListener: (_name, listener) => { listeners.delete(listener); },
	};
	const observer = createFramescaperWebVcrTargetObserverV1({
		debuggerPort,
		viewport: { width: 1_920, height: 1_080 },
		navigationGeneration: () => 1,
		createOpaqueId: () => (nextIdentity++).toString(16).padStart(32, '0'),
		onObservation: (observation) => {
			const stable = observation.targets.find(({ generation }) => generation === 1);
			if (!stable) assert.fail('stable candidate missing');
			stableIdentities.push(stable.targetId);
		},
		onFailure: (error) => assert.fail(String(error)),
	});
	await observer.start();
	emit(listeners, 'Runtime.executionContextCreated', {
		context: {
			id: 11,
			name: 'framescaper-web-vcr-target-v1',
			auxData: { frameId: 'main-frame' },
		},
	});
	for (let sequence = 1; sequence <= 70; sequence += 1) {
		emit(listeners, 'Runtime.bindingCalled', {
			name: FRAMESCAPER_WEB_VCR_TARGET_BINDING,
			executionContextId: 11,
			payload: JSON.stringify({
				version: 1,
				sequence,
				candidates: [candidate(1, 1), candidate(sequence + 1, sequence + 1)],
				ended: null,
			}),
		});
	}
	assert.equal(new Set(stableIdentities).size, 1);
	observer.dispose();
});

function candidate(slot: number, generation: number) {
	return {
		slot,
		generation,
		mediaState: 'playing',
		elementRect: { x: 0, y: 0, width: 1_920, height: 1_080 },
		clipRect: null,
		intrinsicSize: { width: 1_920, height: 1_080 },
		objectFit: 'contain',
		objectPosition: {
			x: { fraction: 0.5, offsetPixels: 0 },
			y: { fraction: 0.5, offsetPixels: 0 },
		},
		manualFallbackReason: null,
	};
}

function emit(
	listeners: ReadonlySet<(event: unknown, method: string, parameters: unknown) => void>,
	method: string,
	parameters: unknown,
): void {
	for (const listener of listeners) listener({}, method, parameters);
}
