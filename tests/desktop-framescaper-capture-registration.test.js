/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '..');

test('main delegates capture security without growing either ceiling-owned entrypoint', async () => {
	const [main, preload, registration] = await Promise.all([
		readFile(resolve(ROOT, 'desktop/main.mjs'), 'utf8'),
		readFile(resolve(ROOT, 'desktop/preload.mjs'), 'utf8'),
		readFile(resolve(ROOT, 'desktop/framescaper-capture-registration.mjs'), 'utf8'),
	]);
	assert.ok(main.split('\n').length - 1 <= 600);
	assert.ok(preload.split('\n').length - 1 <= 764);
	assert.match(main, /registerDesktopCaptureSecurity/u);
	assert.match(main, /revokeDesktopCaptureOwner/u);
	assert.match(main, /name: 'capture security'.*disposeDesktopCaptureSecurity/su);
	assert.doesNotMatch(main, /setPermissionCheckHandler|setDisplayMediaRequestHandler/u);
	assert.doesNotMatch(preload, /framescaper:capture|framescaperCaptureDesktop/u,
		'the ceiling-owned shared preload must not absorb product-only capture APIs');
	assert.match(registration, /framescaper-capture-sandbox-preload\.cjs/u);
	assert.match(registration, /productId !== 'framescaper'/u);
});

test('registration requests a bounded label-only source inventory and never transports media', async () => {
	const source = await readFile(resolve(ROOT, 'desktop/framescaper-capture-registration.mjs'), 'utf8');
	assert.match(source, /types: \['screen', 'window'\]/u);
	assert.match(source, /thumbnailSize: \{ width: 0, height: 0 \}/u);
	assert.match(source, /fetchWindowIcons: false/u);
	assert.doesNotMatch(source, /thumbnail\.toDataURL|NativeImage|ArrayBuffer|Uint8Array|Buffer\./u);
	assert.match(source, /FRAMESCAPER_CAPTURE_DESKTOP_CHANNELS\.listSources/u);
	assert.match(source, /FRAMESCAPER_CAPTURE_DESKTOP_CHANNELS\.grant/u);
	assert.match(source, /FRAMESCAPER_CAPTURE_DESKTOP_CHANNELS\.teardown/u);
	assert.match(source, /isFocused\(\)/u);
	assert.match(source, /senderFrame !== event\.sender\.mainFrame/u);
});

test('staging owns a compiled main port and a sandbox-only Framescaper capture preload', async () => {
	const [runtime, configuration] = await Promise.all([
		readFile(resolve(ROOT, 'scripts/lib/desktop-project-library-runtime.mjs'), 'utf8'),
		readFile(resolve(ROOT, 'tsconfig.desktop-runtime.json'), 'utf8'),
	]);
	assert.match(runtime, /framescaper-capture-desktop-port\.js/u);
	assert.match(runtime, /framescaper-capture-session-security\.js/u);
	assert.match(runtime, /framescaper-capture-sandbox-preload\.cjs/u);
	assert.match(configuration, /desktop\/framescaper-capture-desktop-port\.ts/u);
	assert.match(configuration, /desktop\/framescaper-capture-session-security\.ts/u);
});
