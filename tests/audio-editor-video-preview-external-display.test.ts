/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type {
	FramescaperNativeServicesBridge,
} from '../src/common/editor/ui/framescaper-native-services-bridge.ts';
import {
	framescaperNativeServicesStoreFor,
} from '../src/common/editor/ui/framescaper-native-services-bridge.ts';
import {
	publishEvaluatedVideoPreviewFrame,
} from '../src/common/editor/ui/workspace/video-preview-external-display.ts';

const DISPLAY = Object.freeze({
	displayId: 'display-2', label: 'Programme', primary: false,
	width: 1_920, height: 1_080, hdrCapable: false, colorManaged: false,
});

test('the active display receives the preview evaluator bytes once with exact backpressure', async () => {
	const presented: Readonly<Record<string, unknown>>[] = [];
	let release: (() => void) | null = null;
	const bridge = fakeBridge('display-2', (request) => {
		presented.push(request as Readonly<Record<string, unknown>>);
		return new Promise((resolve) => { release = () => resolve({
			displays: [DISPLAY], activeDisplayId: 'display-2',
		}); });
	});
	await framescaperNativeServicesStoreFor(bridge).refresh();
	let captures = 0;
	const compositor = { captureEvaluatedRgba: () => {
		captures += 1;
		return { width: 2, height: 1, rgba: Uint8Array.of(1, 2, 3, 255, 4, 5, 6, 255) };
	} };
	const project = { id: 'project-1', revision: 8 };
	const dependencies = { resolveBridge: () => bridge };

	assert.equal(publishEvaluatedVideoPreviewFrame({
		compositor, project, timelineFrame: 48_000,
	}, dependencies), true);
	assert.equal(publishEvaluatedVideoPreviewFrame({
		compositor, project, timelineFrame: 48_001,
	}, dependencies), false);
	assert.equal(captures, 1, 'a backpressured frame is dropped before framebuffer readback');
	assert.equal(presented.length, 1);
	assert.equal(presented[0]?.sequence, 0);
	assert.equal(presented[0]?.dynamicRange, 'sdr');
	assert.match(String(presented[0]?.rgbaSha256), /^[a-f0-9]{64}$/u);
	assert.match(String(presented[0]?.evaluationFingerprint), /^[a-f0-9]{64}$/u);

	(release as unknown as () => void)();
	await turn();
	assert.equal(publishEvaluatedVideoPreviewFrame({
		compositor, project, timelineFrame: 48_001,
	}, dependencies), true);
	assert.equal(presented[1]?.sequence, 1);
	assert.notEqual(presented[1]?.evaluationFingerprint, presented[0]?.evaluationFingerprint);
	(release as (() => void) | null)?.();
	await turn();
});

test('no display session means no framebuffer capture or publication', async () => {
	let presented = 0;
	let captures = 0;
	const bridge = fakeBridge(null, async () => {
		presented += 1;
		return { displays: [DISPLAY], activeDisplayId: null };
	});
	await framescaperNativeServicesStoreFor(bridge).refresh();
	assert.equal(publishEvaluatedVideoPreviewFrame({
		compositor: { captureEvaluatedRgba: () => {
			captures += 1;
			return { width: 1, height: 1, rgba: Uint8Array.of(0, 0, 0, 255) };
		} },
		project: { id: 'project-1', revision: 0 }, timelineFrame: 0,
	}, { resolveBridge: () => bridge }), false);
	assert.equal(captures, 0);
	assert.equal(presented, 0);
});

test('active display publication refuses stale project identity and malformed RGBA geometry', async () => {
	const bridge = fakeBridge('display-2', async () => ({
		displays: [DISPLAY], activeDisplayId: 'display-2',
	}));
	await framescaperNativeServicesStoreFor(bridge).refresh();
	const dependencies = { resolveBridge: () => bridge };
	assert.throws(() => publishEvaluatedVideoPreviewFrame({
		compositor: { captureEvaluatedRgba: () => null },
		project: { id: 'project-1', revision: -1 }, timelineFrame: 0,
	}, dependencies), /project identity/iu);
	assert.throws(() => publishEvaluatedVideoPreviewFrame({
		compositor: { captureEvaluatedRgba: () => ({
			width: 2, height: 2, rgba: Uint8Array.of(0, 0, 0, 255),
		}) },
		project: { id: 'project-1', revision: 0 }, timelineFrame: 0,
	}, dependencies), /RGBA geometry/iu);
});

function fakeBridge(
	activeDisplayId: string | null,
	present: (request: unknown) => Promise<unknown>,
): FramescaperNativeServicesBridge {
	return {
		snapshot: async () => ({
			snapshotVersion: 1, runtimeAvailable: true, nativeMediaEnabled: true,
			queue: [], roots: [], watchRules: [],
		}),
		control: async () => { throw new Error('unused'); },
		reorder: async () => [],
		remove: async () => false,
		externalDisplays: async () => ({ displays: [DISPLAY], activeDisplayId }),
		presentExternalDisplay: present,
	} as FramescaperNativeServicesBridge;
}

function turn(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}
