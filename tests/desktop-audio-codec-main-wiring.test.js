/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('desktop main registers codec IPC after preferences and joins owner and shutdown cleanup', async () => {
	const [mainSource, registrationSource] = await Promise.all([
		readFile(new URL('../desktop/main.mjs', import.meta.url), 'utf8'),
		readFile(new URL('../desktop/desktop-audio-codec-registration.mjs', import.meta.url), 'utf8'),
	]);
	assert.match(mainSource, /import \{ registerDesktopAudioCodecs \} from '\.\/desktop-audio-codec-registration\.mjs'/u);
	const preferenceIndex = mainSource.indexOf('externalFfmpegPreferences = await registerExternalFfmpegPreferences');
	const codecIndex = mainSource.indexOf('desktopAudioCodecs = await registerDesktopAudioCodecs');
	assert.ok(preferenceIndex >= 0 && codecIndex > preferenceIndex,
		'the request-scoped runtime receives the initialized external preference service');
	assert.match(mainSource, /registerDesktopAudioCodecs\(\{ channels: IPC, handle, removeHandler: \(channel\) => ipcMain\.removeHandler\(channel\), ownerFor: rendererSaveOwnerFor, externalFfmpegPreferences: externalFfmpegPreferences\.service, platform: process\.platform, architecture: process\.arch, operatingSystemVersion: process\.getSystemVersion\(\), userDataPath: app\.getPath\('userData'\), desktopRoot: __dirname, packaged: app\.isPackaged, resourcesPath: process\.resourcesPath, forkUtilityProcess: \(modulePath, arguments_, options\) => utilityProcess\.fork\(modulePath, arguments_, options\) \}\)/u);
	assert.match(mainSource, /revokeDesktopAudioCodecs: \(owner\) => desktopAudioCodecs\?\.revokeOwner\(owner\)/u);
	assert.match(mainSource, /name: 'desktop audio codecs', run: \(\) => desktopAudioCodecs\?\.dispose\(\)/u);
	assert.match(registrationSource, /import\('\.\/project-library-runtime\/desktop\/desktop-audio-codec-runtime-composition\.js'\)/u);
	assert.match(registrationSource, /import\('\.\/project-library-runtime\/desktop\/desktop-audio-codec-main-ipc\.js'\)/u);
	assert.match(registrationSource, /import\('\.\/project-library-runtime\/desktop\/bundled-audio-codec-runtime\.js'\)/u);
	assert.match(registrationSource, /import\('\.\/project-library-runtime\/desktop\/bundled-flac-audio-codec-runtime\.js'\)/u);
	assert.match(registrationSource, /import\('\.\/project-library-runtime\/desktop\/bundled-twolame-audio-codec-runtime\.js'\)/u);
	assert.match(registrationSource, /import\('\.\/project-library-runtime\/desktop\/bundled-wavpack-audio-codec-runtime\.js'\)/u);
	assert.match(registrationSource, /import\('\.\/project-library-runtime\/desktop\/os-audio-codec-runtime\.js'\)/u);
	assert.match(registrationSource, /import\('\.\/os-audio-codec-electron-spawn\.mjs'\)/u);
	assert.match(registrationSource, /import\('\.\/soundscaper-professional-native-payload\.mjs'\)/u);
	assert.doesNotMatch(mainSource, /createBundledRuntime|createOperatingSystemRuntime/u,
		'native runtime factories remain encapsulated by the desktop codec registration');
});
