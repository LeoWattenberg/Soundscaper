/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	externalDisplayPlacementSupport,
	FramescaperExternalDisplayController,
	type FramescaperExternalDisplayWindow,
} from '../desktop/external-display-controller.ts';
import { createFramescaperNativeExternalDisplayPort } from '../desktop/native-services-external-display-port.ts';

test('Linux native Wayland placement fails closed while X11 and XWayland are explicit', () => {
	assert.deepEqual(externalDisplayPlacementSupport('linux', 'wayland'), {
		supported: false, reason: 'native-wayland-placement-unavailable',
	});
	assert.deepEqual(externalDisplayPlacementSupport('linux', 'x11'), { supported: true, reason: null });
	assert.deepEqual(externalDisplayPlacementSupport('linux', 'xwayland'), { supported: true, reason: null });
	assert.equal(externalDisplayPlacementSupport('darwin', undefined).supported, true);
	assert.equal(externalDisplayPlacementSupport('win32', undefined).supported, true);
});

test('the session window is sandboxed, shares evaluated frames, and falls back explicitly to SDR', async () => {
	const sent: Array<{ channel: string; payload: unknown }> = [];
	const created: unknown[] = [];
	const losses: string[] = [];
	const window = fakeWindow(sent);
	const controller = new FramescaperExternalDisplayController({
		platform: 'linux', linuxSessionType: 'xwayland', isEnabled: () => true,
		createWindow: (options) => { created.push(options); return window; },
		onLoss: (reason) => losses.push(reason),
	});
	const display = {
		displayId: 'display-2',
		label: 'Programme',
		primary: false,
		bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
		width: 1920,
		height: 1080,
		hdrCapable: true,
		colorManaged: false,
	};

	const opened = await controller.open(display, 'hdr');
	assert.equal(opened.dynamicRange, 'sdr-fallback');
	assert.deepEqual(created, [{
		bounds: display.bounds,
		show: false,
		frame: false,
		backgroundColor: '#000000',
		webPreferences: {
			sandbox: true, contextIsolation: true, nodeIntegration: false,
			webSecurity: true, allowRunningInsecureContent: false,
		},
	}]);
	assert.equal(window.shows, 1);

	const rgba = Uint8Array.of(0, 0, 0, 255, 255, 255, 255, 255);
	const rgbaSha256 = createHash('sha256').update(rgba).digest('hex');
	controller.present({
		sequence: 1,
		evaluationFingerprint: 'a'.repeat(64),
		width: 2,
		height: 1,
		dynamicRange: 'hdr',
		rgbaSha256,
		rgba,
	});
	assert.deepEqual(sent, [{
		channel: 'framescaper:external-display:v1:frame',
		payload: {
			sequence: 1,
			evaluationFingerprint: 'a'.repeat(64),
			width: 2,
			height: 1,
			dynamicRange: 'sdr',
			rgbaSha256,
			rgba,
		},
	}]);
	assert.throws(() => controller.present({
		sequence: 1, evaluationFingerprint: 'a'.repeat(64), width: 2, height: 1,
		dynamicRange: 'sdr', rgbaSha256, rgba,
	}), /strictly increasing/u);

	controller.reconcileDisplays([]);
	assert.equal(window.closes, 1);
	assert.deepEqual(losses, ['display-removed']);
	assert.equal(controller.snapshot().active, false);
});

test('external display is session-only and remains off when its capability is not enabled', async () => {
	let windows = 0;
	const controller = new FramescaperExternalDisplayController({
		platform: 'darwin',
		createWindow: () => { windows += 1; return fakeWindow([]); },
	});
	await assert.rejects(() => controller.open({
		displayId: 'display-2', label: 'Client', primary: false,
		bounds: { x: 0, y: 0, width: 100, height: 100 },
		width: 100, height: 100, hdrCapable: true, colorManaged: true,
	}, 'sdr'), /disabled/u);
	assert.equal(windows, 0);
	assert.deepEqual(controller.snapshot(), {
		active: false, displayId: null, dynamicRange: null, lastSequence: null,
	});
});

test('the native-services display port reconciles screen changes and disposes its session', async () => {
	const window = fakeWindow([]);
	const reported: unknown[] = [];
	let inventory = [{
		displayId: 'display-2', label: 'Client', primary: false,
		bounds: { x: 100, y: 0, width: 100, height: 100 },
		width: 100, height: 100, hdrCapable: false, colorManaged: true,
	}];
	const changes: Array<() => void> = [];
	let unsubscribed = 0;
	const port = createFramescaperNativeExternalDisplayPort({
		platform: 'darwin', isEnabled: () => true, listDisplays: () => inventory,
		createWindow: () => window,
		onError: (error) => reported.push(error),
		subscribe: (listener) => { changes.push(listener); return () => { unsubscribed += 1; }; },
	});
	assert.equal(port.list()[0]?.displayId, 'display-2');
	await port.open(inventory[0]!);
	assert.equal(port.activeDisplayId(), 'display-2');
	inventory = [];
	assert.equal(changes.length, 1);
	changes[0]!();
	assert.equal(port.activeDisplayId(), null);
	assert.equal(reported.length, 1);
	assert.match(String(reported[0]), /external display.*display-removed/iu);
	port.dispose();
	assert.equal(unsubscribed, 1);
});

function fakeWindow(sent: Array<{ channel: string; payload: unknown }>) {
	const window = {
		shows: 0,
		closes: 0,
		closed: false,
		bounds: [] as unknown[],
		async load() {},
		show() { this.shows += 1; },
		close() { this.closes += 1; this.closed = true; },
		isDestroyed() { return this.closed; },
		setBounds(bounds: unknown) { this.bounds.push(bounds); },
		send(channel: string, payload: unknown) { sent.push({ channel, payload }); },
	} satisfies FramescaperExternalDisplayWindow & {
		shows: number; closes: number; closed: boolean; bounds: unknown[];
	};
	return window;
}
