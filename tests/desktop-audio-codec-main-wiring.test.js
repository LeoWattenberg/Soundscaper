/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('desktop main registers both codec providers after preferences and joins lifecycle cleanup', async () => {
	const [mainSource, integrationSource, registrationSource] = await Promise.all([
		readFile(new URL('../desktop/main.mjs', import.meta.url), 'utf8'),
		readFile(new URL('../desktop/desktop-codec-main-integration.mjs', import.meta.url), 'utf8'),
		readFile(new URL('../desktop/desktop-audio-codec-registration.mjs', import.meta.url), 'utf8'),
	]);
	assert.match(mainSource, /import \{ registerDesktopCodecProviders \} from '\.\/desktop-codec-main-integration\.mjs'/u);
	const preferenceIndex = mainSource.indexOf('externalFfmpegPreferences = await registerExternalFfmpegPreferences');
	const codecIndex = mainSource.indexOf('desktopCodecs = await registerDesktopCodecProviders');
	assert.ok(preferenceIndex >= 0 && codecIndex > preferenceIndex,
		'the request-scoped runtime receives the initialized external preference service');
	assert.match(mainSource, /registerDesktopCodecProviders\(\{[^\n]+productId: PRODUCT_ID,[^\n]+externalFfmpegPreferences: externalFfmpegPreferences\.service,[^\n]+environment: process\.env \}\)/u);
	assert.match(mainSource, /revokeDesktopCodecs: \(owner\) => desktopCodecs\?\.revokeOwner\(owner\)/u);
	assert.match(mainSource, /revokeSoundscaperDelivery: \(owner\) => soundscaperDelivery\?\.revokeOwner\(owner\)/u);
	assert.match(mainSource, /name: 'desktop codecs', run: \(\) => desktopCodecs\?\.dispose\(\)/u);
	assert.match(mainSource, /name: 'persistent delivery', run: \(\) => soundscaperDelivery\?\.dispose\(\)/u);
	assert.match(integrationSource, /registerDesktopAudioCodecs/u);
	assert.match(integrationSource, /registerDesktopVideoCodecs/u);
	assert.match(registrationSource, /import\('\.\/project-library-runtime\/desktop\/desktop-audio-codec-runtime-composition\.js'\)/u);
	assert.match(registrationSource, /import\('\.\/project-library-runtime\/desktop\/desktop-audio-codec-main-ipc\.js'\)/u);
	assert.match(registrationSource, /import\('\.\/project-library-runtime\/desktop\/bundled-audio-codec-isolated-runtime\.js'\)/u);
	assert.match(registrationSource, /import\('\.\/project-library-runtime\/desktop\/os-audio-codec-runtime\.js'\)/u);
	assert.match(registrationSource, /import\('\.\/os-audio-codec-electron-spawn\.mjs'\)/u);
	assert.match(registrationSource, /import\('\.\/os-audio-codec-native-payload\.mjs'\)/u);
	assert.doesNotMatch(mainSource, /createBundledRuntime|createOperatingSystemRuntime/u,
		'native runtime factories remain encapsulated by the desktop codec registration');
});
