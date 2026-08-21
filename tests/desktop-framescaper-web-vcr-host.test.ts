/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	FRAMESCAPER_WEB_VCR_PARTITION,
	createFramescaperWebVcrGuestWindowOptionsV1,
	createFramescaperWebVcrHostLifecycleV1,
	createFramescaperWebVcrPopupWindowOptionsV1,
} from '../desktop/framescaper-web-vcr-host.ts';

const OWNER = Object.freeze(Object.create(null)) as object;

test('guest window options use the persistent isolated offscreen profile with no preload', () => {
	assert.equal(FRAMESCAPER_WEB_VCR_PARTITION, 'persist:framescaper-web-vcr-v1');
	assert.deepEqual(createFramescaperWebVcrGuestWindowOptionsV1('720p'), {
		show: false,
		width: 1280,
		height: 720,
		useContentSize: true,
		webPreferences: {
			partition: FRAMESCAPER_WEB_VCR_PARTITION,
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false,
			nodeIntegrationInSubFrames: false,
			webSecurity: true,
			allowRunningInsecureContent: false,
			backgroundThrottling: false,
			offscreen: { deviceScaleFactor: 1 },
		},
	});
	const fourK = createFramescaperWebVcrGuestWindowOptionsV1('4k');
	assert.deepEqual({ width: fourK.width, height: fourK.height, offscreen: fourK.webPreferences.offscreen }, {
		width: 1920, height: 1080, offscreen: { deviceScaleFactor: 2 },
	});
	assert.equal('preload' in fourK.webPreferences, false, 'remote guests receive no preload');
	assert.equal(Object.isFrozen(fourK.webPreferences), true);
	assert.deepEqual(createFramescaperWebVcrPopupWindowOptionsV1(), {
		show: true, width: 520, height: 640, useContentSize: true,
		webPreferences: {
			partition: FRAMESCAPER_WEB_VCR_PARTITION, sandbox: true, contextIsolation: true,
			nodeIntegration: false, nodeIntegrationInSubFrames: false, webSecurity: true,
			allowRunningInsecureContent: false,
		},
	});
	assert.equal('offscreen' in createFramescaperWebVcrPopupWindowOptionsV1().webPreferences, false);
	assert.equal('preload' in createFramescaperWebVcrPopupWindowOptionsV1().webPreferences, false);
});

test('host bounds HTTPS popups and keeps recording contents alive when the panel closes', () => {
	const harness = host();
	const primary = content('primary', harness.events);
	const reference = harness.value.open(OWNER, 1, primary);
	for (let index = 0; index < 4; index += 1) {
		const popup = content(`popup-${String(index)}`, harness.events);
		assert.equal(harness.value.registerPopup(
			OWNER, reference, `https://login${String(index)}.example.com/`, popup,
		), true);
	}
	assert.equal(harness.value.registerPopup(
		OWNER, reference, 'https://overflow.example.com/', content('overflow', harness.events),
	), false);
	assert.throws(() => harness.value.setPhase(OWNER, reference, 'recording'), /transition/iu);
	harness.value.setPhase(OWNER, reference, 'preparing');
	harness.value.setPhase(OWNER, reference, 'recording');
	assert.equal(harness.value.registerPopup(
		OWNER, reference, 'https://late.example.com/', content('late', harness.events),
	), false);
	assert.equal(harness.value.closePanel(OWNER, reference), 'hidden');
	assert.deepEqual(harness.events, []);
	assert.throws(() => harness.value.setPhase(OWNER, reference, 'ready'), /transition/iu);
	harness.value.setPhase(OWNER, reference, 'finalizing');
	harness.value.setPhase(OWNER, reference, 'ready');
	assert.equal(harness.value.closePanel(OWNER, reference), 'destroyed');
	assert.deepEqual(harness.events, [
		'destroy:popup-0', 'destroy:popup-1', 'destroy:popup-2', 'destroy:popup-3', 'destroy:primary',
	]);
});

test('browser data clearing requires a fresh idle nonce and destroys contents before storage', async () => {
	const harness = host();
	const reference = harness.value.open(OWNER, 1, content('primary', harness.events));
	harness.value.registerPopup(OWNER, reference, 'https://login.example.com/', content('popup', harness.events));
	const confirmation = harness.value.issueDataClearConfirmation(OWNER, reference);
	assert.equal(confirmation.expiresAtMs, 31_000);
	await harness.value.clearBrowserData(OWNER, reference, confirmation.nonce);
	assert.deepEqual(harness.events, [
		'destroy:popup', 'destroy:primary', 'clear-auth', 'clear-cache', 'clear-storage',
	]);
	assert.throws(
		() => harness.value.clearBrowserData(OWNER, reference, confirmation.nonce),
		/owner|session|confirmation/iu,
	);

	const second = harness.value.open(OWNER, 2, content('second', harness.events));
	harness.value.setPhase(OWNER, second, 'preparing');
	harness.value.setPhase(OWNER, second, 'recording');
	assert.throws(() => harness.value.issueDataClearConfirmation(OWNER, second), /idle/iu);
	harness.value.setPhase(OWNER, second, 'recovery');
	harness.value.setPhase(OWNER, second, 'ready');
	const expired = harness.value.issueDataClearConfirmation(OWNER, second);
	harness.advance(30_000);
	assert.throws(() => harness.value.clearBrowserData(OWNER, second, expired.nonce), /expired/iu);
});

function host() {
	let nowMs = 1_000;
	let nextId = 1;
	const events: string[] = [];
	const value = createFramescaperWebVcrHostLifecycleV1({
		now: () => nowMs,
		createOpaqueId: () => (nextId++).toString(16).padStart(32, '0'),
		browserSession: {
			clearAuthCache: async () => { events.push('clear-auth'); },
			clearCache: async () => { events.push('clear-cache'); },
			clearStorageData: async () => { events.push('clear-storage'); },
		},
	});
	return { value, events, advance: (milliseconds: number) => { nowMs += milliseconds; } };
}

function content(name: string, events: string[]) {
	let destroyed = false;
	return {
		isDestroyed: () => destroyed,
		destroy() {
			if (destroyed) return;
			destroyed = true;
			events.push(`destroy:${name}`);
		},
	};
}
