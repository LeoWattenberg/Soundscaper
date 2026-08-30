/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	FRAMESCAPER_WEB_VCR_TARGET_BINDING,
	createFramescaperWebVcrTargetObserverV1,
	validateFramescaperWebVcrTargetObservationV1,
} from '../desktop/framescaper-web-vcr-target-observer.ts';

test('target observation validates a bounded closed candidate inventory', () => {
	const observation = validateFramescaperWebVcrTargetObservationV1(observationPayload());
	assert.equal(Object.isFrozen(observation), true);
	assert.equal(Object.isFrozen(observation.candidates), true);
	assert.equal(observation.candidates[0]?.slot, 7);
	assert.throws(() => validateFramescaperWebVcrTargetObservationV1({
		...observationPayload(),
		candidates: Array.from({ length: 17 }, () => observationPayload().candidates[0]),
	}), /candidate|limit/iu);
	assert.throws(() => validateFramescaperWebVcrTargetObservationV1({
		...observationPayload(),
		candidates: [{ ...observationPayload().candidates[0], documentCookie: 'leak' }],
	}), /closed|unsupported/iu);
	assert.throws(() => validateFramescaperWebVcrTargetObservationV1({
		...observationPayload(), ended: { slot: 7, generation: 1 },
	}), /missing|unsupported/iu);
});

test('observer installs only a fixed isolated-world binding and maps targets to opaque IDs', async () => {
	const commands: Array<Readonly<{ method: string; parameters: unknown }>> = [];
	const listeners = new Set<(event: unknown, method: string, parameters: unknown) => void>();
	const observations: unknown[] = [];
	let attached = false;
	let navigationGeneration = 3;
	const observer = createFramescaperWebVcrTargetObserverV1({
		debuggerPort: {
			isAttached: () => attached,
			attach: (version) => { assert.equal(version, '1.3'); attached = true; },
			detach: () => { attached = false; },
			sendCommand: async (method, parameters) => {
				commands.push({ method, parameters });
				if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main-frame' } } };
				return method === 'Runtime.callFunctionOn'
					? { result: { type: 'boolean', value: true } } : {};
			},
			on: (name, listener) => { assert.equal(name, 'message'); listeners.add(listener); },
			removeListener: (name, listener) => { assert.equal(name, 'message'); listeners.delete(listener); },
		},
		viewport: { width: 1920, height: 1080 },
		navigationGeneration: () => navigationGeneration,
		createOpaqueId: () => 'd'.repeat(32),
		onObservation: (value) => observations.push(value),
		onFailure: (error) => assert.fail(String(error)),
	});
	await observer.start();
	assert.deepEqual(commands.map(({ method }) => method), [
		'Page.enable', 'Runtime.enable', 'Page.getFrameTree',
		'Runtime.addBinding', 'Page.addScriptToEvaluateOnNewDocument',
	]);
	assert.deepEqual(commands[3]?.parameters, {
		name: FRAMESCAPER_WEB_VCR_TARGET_BINDING,
		executionContextName: 'framescaper-web-vcr-target-v1',
	});
	const trackerSource = (commands[4]?.parameters as { source?: unknown }).source;
	assert.equal(typeof trackerSource, 'string');
	assert.match(String(trackerSource), /visibleClip|overflowX|overflowY/u);
	assert.match(String(trackerSource), /borderLeftWidth.*paddingLeft|contentRect/u);
	assert.match(String(trackerSource), /globalThis\.top !== globalThis/u);
	assert.match(String(trackerSource), /currentSrc|mediaIdentity\.generation/u);
	assert.match(String(trackerSource), /parts\.length > 2|manualFallbackReason: 'canvas-player'/u);
	assert.match(String(trackerSource), /hasTransformedAncestor|current = current\.parentElement/u);
	assert.match(String(trackerSource), /clipRect: clip/u);
	assert.match(String(trackerSource), /candidateGeometryWithinBounds/u);
	assert.match(String(trackerSource), /intrinsic\.width <= 16_384|component\.fraction >= -4/u);
	assert.match(String(trackerSource), /recordingToken: activeRecordingToken/u);
	assert.doesNotMatch(JSON.stringify(commands), /executeScript|evaluate\b/iu);
	for (const listener of listeners) listener({}, 'Runtime.executionContextCreated', {
		context: {
			id: 11, name: 'framescaper-web-vcr-target-v1',
			auxData: { frameId: 'main-frame' },
		},
	});
	for (const listener of listeners) listener({}, 'Runtime.executionContextCreated', {
		context: {
			id: 22, name: 'framescaper-web-vcr-target-v1',
			auxData: { frameId: 'subframe' },
		},
	});
	await observer.setRecordingToken('e'.repeat(32));
	assert.deepEqual(commands.at(-1)?.parameters, {
		functionDeclaration: `function (token) {
	const fence = globalThis.__framescaperWebVcrRecordingFenceV1;
	return Boolean(fence && fence.set(token) === true);
}`,
		executionContextId: 11,
		arguments: [{ value: 'e'.repeat(32) }],
		returnByValue: true,
		awaitPromise: false,
		userGesture: false,
	});

	for (const listener of listeners) listener({}, 'Runtime.bindingCalled', {
		name: 'hostile-page-binding', payload: JSON.stringify(observationPayload()), executionContextId: 11,
	});
	assert.equal(observations.length, 0);
	const hostileSubframe = {
		...observationPayload(99), ended: { slot: 7, generation: 1, recordingToken: 'e'.repeat(32) },
	};
	for (const listener of listeners) listener({}, 'Runtime.bindingCalled', {
		name: FRAMESCAPER_WEB_VCR_TARGET_BINDING,
		payload: JSON.stringify(hostileSubframe), executionContextId: 22,
	});
	assert.equal(observations.length, 0, 'subframe geometry and ended events are ignored');
	for (const listener of listeners) listener({}, 'Runtime.bindingCalled', {
		name: FRAMESCAPER_WEB_VCR_TARGET_BINDING,
		payload: JSON.stringify(observationPayload()), executionContextId: 11,
	});
	assert.equal(observations.length, 1);
	assert.deepEqual(observations[0], {
		navigationGeneration: 3,
		selection: {
			kind: 'target',
			target: {
				targetId: 'd'.repeat(32), generation: 1, mediaState: 'playing',
				aperture: { x: 0, y: 0, width: 1, height: 1 },
				intrinsicSize: { width: 1920, height: 1080 },
			},
			visibleArea: 2073600,
		},
		targets: [{ targetId: 'd'.repeat(32), generation: 1, mediaState: 'playing' }],
		endedTarget: null,
	});
	for (const listener of listeners) listener({}, 'Runtime.bindingCalled', {
		name: FRAMESCAPER_WEB_VCR_TARGET_BINDING,
		payload: JSON.stringify(observationPayload(2)), executionContextId: 11,
	});
	for (const listener of listeners) listener({}, 'Runtime.bindingCalled', {
		name: FRAMESCAPER_WEB_VCR_TARGET_BINDING,
		payload: JSON.stringify(observationPayload(1)), executionContextId: 11,
	});
	assert.equal(observations.length, 1, 'duplicate and rollback sequences are ignored per navigation');
	navigationGeneration = 4;
	for (const listener of listeners) listener({}, 'Runtime.bindingCalled', {
		name: FRAMESCAPER_WEB_VCR_TARGET_BINDING,
		payload: JSON.stringify(observationPayload(1)), executionContextId: 11,
	});
	assert.equal(observations.length, 2, 'a new navigation resets the isolated-world sequence');
	const clipped = observationPayload(2);
	clipped.candidates[0] = {
		...clipped.candidates[0],
		generation: 2,
		clipRect: { x: 480, y: 270, width: 960, height: 540 },
	};
	for (const listener of listeners) listener({}, 'Runtime.bindingCalled', {
		name: FRAMESCAPER_WEB_VCR_TARGET_BINDING,
		payload: JSON.stringify(clipped), executionContextId: 11,
	});
	assert.deepEqual((observations[2] as {
		selection: { kind: string; target: { aperture: unknown; generation: number } };
		targets: unknown;
	}), {
		selection: {
			kind: 'target',
			target: {
				targetId: 'd'.repeat(32), generation: 2, mediaState: 'playing',
				aperture: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
				intrinsicSize: { width: 1920, height: 1080 },
			},
			visibleArea: 518400,
		},
		targets: [{ targetId: 'd'.repeat(32), generation: 2, mediaState: 'playing' }],
		navigationGeneration: 4,
		endedTarget: null,
	});
	const exactEnded = {
		...observationPayload(3),
		candidates: [{ ...observationPayload(3).candidates[0], generation: 2, mediaState: 'ended' }],
		ended: { slot: 7, generation: 2, recordingToken: 'e'.repeat(32) },
	};
	for (const listener of listeners) listener({}, 'Runtime.bindingCalled', {
		name: FRAMESCAPER_WEB_VCR_TARGET_BINDING,
		payload: JSON.stringify(exactEnded), executionContextId: 11,
	});
	assert.deepEqual((observations[3] as { endedTarget: unknown }).endedTarget, {
		targetId: 'd'.repeat(32), generation: 2, endedRecordingToken: 'e'.repeat(32),
	});
	observer.dispose();
	assert.equal(attached, false);
	assert.equal(listeners.size, 0);
});

function observationPayload(sequence = 2) {
	return {
		version: 1,
		sequence,
		candidates: [{
			slot: 7,
			generation: 1,
			mediaState: 'playing',
			elementRect: { x: 0, y: 0, width: 1920, height: 1080 },
			clipRect: null as Readonly<{ x: number; y: number; width: number; height: number }> | null,
			intrinsicSize: { width: 1920, height: 1080 },
			objectFit: 'contain',
			objectPosition: {
				x: { fraction: 0.5, offsetPixels: 0 },
				y: { fraction: 0.5, offsetPixels: 0 },
			},
			manualFallbackReason: null,
		}],
		ended: null,
	};
}
