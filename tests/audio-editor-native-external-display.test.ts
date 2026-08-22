/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createExternalDisplaySessionStore,
	listSelectableExternalDisplays,
	resolveExternalDisplayColorMode,
	restoreExternalDisplaySession,
	NATIVE_EXTERNAL_DISPLAY_AUDIO_ROUTE,
	NATIVE_EXTERNAL_DISPLAY_MAXIMUM_RGBA_BYTES,
	NATIVE_EXTERNAL_DISPLAY_PERSISTENCE,
	NativeExternalDisplayError,
	type ExternalDisplayDescriptorV1,
} from '../src/common/editor/native-external-display.ts';

test('the bounded frame contract admits the registered UHD clean-display cohort', () => {
	const uhdRgbaBytes = 3_840 * 2_160 * 4;
	assert.ok(NATIVE_EXTERNAL_DISPLAY_MAXIMUM_RGBA_BYTES >= uhdRgbaBytes);
	assert.equal(NATIVE_EXTERNAL_DISPLAY_MAXIMUM_RGBA_BYTES, 64 * 1_024 * 1_024);
});

test('the menu offers non-primary displays only', () => {
	const displays = [primary(), secondary('display-2'), secondary('display-3')];

	assert.deepEqual(
		listSelectableExternalDisplays(displays, 'x11').map((display) => display.displayId),
		['display-2', 'display-3'],
	);
	assert.deepEqual(listSelectableExternalDisplays([primary()], 'macos'), []);
});

test('native Wayland reports unavailable instead of approximating placement', () => {
	const displays = [primary(), secondary('display-2')];

	assert.deepEqual(listSelectableExternalDisplays(displays, 'wayland'), []);
	// XWayland presents as x11 and is where Linux qualification runs.
	assert.equal(listSelectableExternalDisplays(displays, 'x11').length, 1);

	const store = createExternalDisplaySessionStore('wayland');
	assert.throws(() => store.open(secondary('display-2'), 0), refuses('native-wayland-placement-unavailable'));
});

test('HDR is claimed only when the display is both capable and colour managed', () => {
	assert.equal(resolveExternalDisplayColorMode(secondary('d', { hdrCapable: true, colorManaged: true })), 'hdr');
	assert.equal(resolveExternalDisplayColorMode(secondary('d', { hdrCapable: true, colorManaged: false })), 'sdr');
	assert.equal(resolveExternalDisplayColorMode(secondary('d', { hdrCapable: false, colorManaged: true })), 'sdr');
	assert.equal(resolveExternalDisplayColorMode(secondary('d')), 'sdr');
});

test('a session opens on the chosen display and reports its exact colour mode', () => {
	const store = createExternalDisplaySessionStore('windows');
	const session = store.open(secondary('display-2', { hdrCapable: true, colorManaged: true }), 1_000);

	assert.deepEqual(session, { displayId: 'display-2', colorMode: 'hdr', openedAtMs: 1_000 });
	assert.deepEqual(store.snapshot(), session);
});

test('the programme output never opens on the primary display or twice at once', () => {
	const store = createExternalDisplaySessionStore('macos');

	assert.throws(() => store.open(primary(), 0), NativeExternalDisplayError);
	store.open(secondary('display-2'), 0);
	assert.throws(() => store.open(secondary('display-3'), 1), refuses('already-open'));
});

test('the menu command and Escape both close the surface without reporting a loss', () => {
	for (const reason of ['menu-command', 'escape-key'] as const) {
		const store = createExternalDisplaySessionStore('x11');
		store.open(secondary('display-2'), 0);
		const closure = store.close(reason, 500);

		assert.deepEqual(closure, {
			displayId: 'display-2', reason, atMs: 500, reportsLoss: false,
		});
		assert.equal(store.snapshot(), null);
		assert.equal(store.close(reason, 600), null, 'closing again is a no-op');
	}
});

test('removing the display closes the surface and reports the loss', () => {
	const store = createExternalDisplaySessionStore('x11');
	store.open(secondary('display-2'), 0);

	assert.equal(store.observeDisplays([primary(), secondary('display-2')], 100), null);
	const closure = store.observeDisplays([primary()], 200);
	assert.deepEqual(closure, {
		displayId: 'display-2', reason: 'display-removed', atMs: 200, reportsLoss: true,
	});
	assert.equal(store.snapshot(), null);
});

test('a display that becomes the primary one ends the session without claiming a loss', () => {
	const store = createExternalDisplaySessionStore('x11');
	store.open(secondary('display-2'), 0);

	const closure = store.observeDisplays([{ ...secondary('display-2'), primary: true }], 300);
	assert.deepEqual(closure, {
		displayId: 'display-2', reason: 'display-became-primary', atMs: 300, reportsLoss: false,
	});
	assert.equal(store.snapshot(), null);
});

test('the selection is session-only and audio never moves', () => {
	assert.equal(NATIVE_EXTERNAL_DISPLAY_PERSISTENCE, 'session-only');
	assert.equal(NATIVE_EXTERNAL_DISPLAY_AUDIO_ROUTE, 'existing-selected-mix-device');
	assert.equal(restoreExternalDisplaySession(), null);

	// A fresh store after a restart knows nothing about the previous session.
	const before = createExternalDisplaySessionStore('x11');
	before.open(secondary('display-2'), 0);
	assert.equal(createExternalDisplaySessionStore('x11').snapshot(), null);
});

test('an unknown windowing system or malformed display is refused', () => {
	assert.throws(() => createExternalDisplaySessionStore('mir' as never), RangeError);
	const store = createExternalDisplaySessionStore('x11');
	assert.throws(() => store.open(secondary(''), 0), NativeExternalDisplayError);
	assert.throws(() => store.open(secondary('display-2'), -1), RangeError);
	store.open(secondary('display-2'), 0);
	assert.throws(() => store.close('exploded' as never, 1), RangeError);
});

function refuses(refusal: string) {
	return (error: unknown): boolean => {
		assert.ok(error instanceof NativeExternalDisplayError);
		assert.equal(error.refusal, refusal);
		return true;
	};
}

function primary(): ExternalDisplayDescriptorV1 {
	return {
		displayId: 'display-1', label: 'Built-in', primary: true,
		width: 2_560, height: 1_440, hdrCapable: false, colorManaged: false,
	};
}

function secondary(
	displayId: string,
	overrides: Partial<ExternalDisplayDescriptorV1> = {},
): ExternalDisplayDescriptorV1 {
	return {
		displayId, label: 'Programme', primary: false,
		width: 1_920, height: 1_080, hdrCapable: false, colorManaged: false,
		...overrides,
	};
}
