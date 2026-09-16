/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { createDesktopNativeTierControlsStore, type DesktopNativeTierControls, type DesktopNativeTierControlAction } from '../src/common/editor/ui/desktop-host-menu.ts';

const initial: DesktopNativeTierControls = Object.freeze({ probeHelperEnabled: false, probeHelperQuarantined: false,
	audioHelperEnabled: false, audioHelperQuarantined: false, nativeEffectDiscoveryEnabled: false });

for (const [name, bridge] of [
	['absent', null],
	['environment only', { version: 1, getEnvironment: () => Promise.resolve({ platform: 'win32' }) }],
	['read only', { readNativeTierControls: () => Promise.resolve(initial) }],
	['apply only', { applyNativeTierControl: () => Promise.resolve(initial) }],
	['noncallable apply', { readNativeTierControls: () => Promise.resolve(initial), applyNativeTierControl: true }],
	['noncallable read', { readNativeTierControls: true, applyNativeTierControl: () => Promise.resolve(initial) }],
] as const) test(`${name} native bridge does not advertise native-tier polling or mutations`, () => {
	const service = createAudioEditorFileService({ bridge, scope: {} });
	assert.equal(service.isDesktop, bridge !== null);
	assert.equal(typeof service.readNativeTierControls, 'undefined');
	assert.equal(typeof service.applyNativeTierControl, 'undefined');
});

test('complete native-tier bridge preserves receiver binding and authoritative repeated polling', async () => {
	const calls: string[] = [];
	const bridge = {
		current: initial,
		readNativeTierControls() { assert.equal(this, bridge); calls.push('read'); return Promise.resolve(this.current); },
		applyNativeTierControl(request: { action: DesktopNativeTierControlAction; enabled?: boolean }) {
			assert.equal(this, bridge); calls.push(request.action);
			if (request.action === 'set-probe-helper-enabled') this.current = Object.freeze({ ...this.current, probeHelperEnabled: request.enabled === true });
			return Promise.resolve(this.current);
		},
	};
	const service = createAudioEditorFileService({ bridge, scope: {} });
	assert.equal(service.isDesktop, true);
	assert.ok(service.readNativeTierControls && service.applyNativeTierControl);
	const store = createDesktopNativeTierControlsStore({ readNativeTierControls: service.readNativeTierControls,
		applyNativeTierControl: service.applyNativeTierControl });
	let publications = 0; const unsubscribe = store.subscribe(() => { publications++; });
	assert.equal(await store.refresh(), initial);
	assert.equal(await store.refresh(), initial);
	assert.equal(publications, 1, 'Unchanged polling must retain the authoritative snapshot.');
	const applied = await store.apply('set-probe-helper-enabled', true);
	assert.equal(applied, bridge.current); assert.equal(applied?.probeHelperEnabled, true);
	assert.equal(publications, 2); assert.deepEqual(calls, ['read', 'read', 'set-probe-helper-enabled']);
	unsubscribe();
});
