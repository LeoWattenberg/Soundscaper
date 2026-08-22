/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '..');

test('Electron main owns OpenFX utility-process spawning and never exposes a plug-in path', async () => {
	const source = await readFile(join(ROOT, 'desktop/framescaper-openfx-electron-runtime.mjs'), 'utf8');
	assert.match(source, /utilityProcess\.fork/iu);
	assert.match(source, /openfx-helper-process\.js/iu);
	assert.match(source, /startFramescaperOpenFxRuntime/iu);
	assert.match(source, /framescaper-openfx-fingerprint-runtime/iu);
	assert.doesNotMatch(source, /child_process|shell:\s*true/iu);
});

test('the utility-process entry self-tests before negotiating one closed OpenFX kind', async () => {
	const source = await readFile(join(ROOT, 'desktop/openfx-helper-process.js'), 'utf8');
	const selfTest = source.indexOf('await selfTestFramescaperOpenFxHelper');
	const worker = source.indexOf('createOpenFxHelperWorker({');
	assert.ok(selfTest >= 0 && worker > selfTest);
	assert.match(source, /validateFramescaperOpenFxHelperProcessConfig/iu);
	assert.match(source, /createOpenFxHelperJobRunner\(config\)/u);
	assert.doesNotMatch(source, /executeJavaScript|BrowserWindow|ipcRenderer/iu);
});
