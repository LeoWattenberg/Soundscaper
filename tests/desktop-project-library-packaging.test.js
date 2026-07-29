/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
	compileDesktopProjectLibraryRuntime,
	stageDesktopApplicationSources,
} from '../scripts/lib/desktop-project-library-runtime.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('desktop runtime compilation emits importable JavaScript with rewritten extensions', async (context) => {
	const temporaryRoot = await mkdtemp(join(tmpdir(), 'scape-desktop-runtime-'));
	context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
	const outputRoot = join(temporaryRoot, 'runtime');
	const result = await compileDesktopProjectLibraryRuntime({ repositoryRoot: ROOT, outputRoot });
	assert.deepEqual(result.files, [
		'application-lifecycle.js',
		'project-library-abort.js',
		'project-library-contract.js',
		'project-library-host.js',
		'project-library-persistence.js',
		'project-library.js',
	]);
	for (const name of result.files) {
		const source = await readFile(join(outputRoot, name), 'utf8');
		assert.doesNotMatch(source, /from ['"].*\.ts['"]/u);
	}
	const runtime = await import(`${pathToFileURL(join(outputRoot, 'project-library-host.js')).href}?test=${Date.now()}`);
	assert.equal(typeof runtime.DesktopProjectLibraryHost?.start, 'function');
});

test('desktop staging excludes raw TypeScript and includes the compiled runtime', async (context) => {
	const temporaryRoot = await mkdtemp(join(tmpdir(), 'scape-desktop-stage-'));
	context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
	const runtimeRoot = join(temporaryRoot, 'runtime');
	const applicationDesktopRoot = join(temporaryRoot, 'application', 'desktop');
	await compileDesktopProjectLibraryRuntime({ repositoryRoot: ROOT, outputRoot: runtimeRoot });
	await stageDesktopApplicationSources({
		desktopSourceRoot: join(ROOT, 'desktop'),
		applicationDesktopRoot,
		runtimeRoot,
	});
	await access(join(applicationDesktopRoot, 'main.mjs'));
	await access(join(applicationDesktopRoot, 'renderer-save-owner.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'project-library-host.js'));
	await assert.rejects(() => access(join(applicationDesktopRoot, 'project-library-host.ts')), /ENOENT/u);
});

test('desktop main initializes and disposes the library without expanding renderer IPC', async () => {
	const [mainSource, preloadSource, prepareSource, packageMetadata] = await Promise.all([
		readFile(join(ROOT, 'desktop', 'main.mjs'), 'utf8'),
		readFile(join(ROOT, 'desktop', 'preload.mjs'), 'utf8'),
		readFile(join(ROOT, 'scripts', 'desktop-prepare.mjs'), 'utf8'),
		readFile(join(ROOT, 'package.json'), 'utf8').then(JSON.parse),
	]);
	const readyIndex = mainSource.indexOf('await app.whenReady()');
	const appDataIndex = mainSource.indexOf("app.getPath('appData')");
	assert.ok(readyIndex >= 0 && appDataIndex > readyIndex, 'shared appData is resolved only after Electron is ready');
	assert.match(mainSource, /DesktopProjectLibraryHost\.start/u);
	assert.match(mainSource, /owner: \{ product: PRODUCT_ID/u);
	assert.match(mainSource, /new DesktopApplicationShutdown/u);
	assert.match(mainSource, /name: 'project library', run: closeProjectLibraryHost/u);
	assert.match(mainSource, /name: 'read capabilities'.*readCapabilities\.dispose\(\)/su);
	assert.match(mainSource, /name: 'save sessions'.*saves\.dispose\(\)/su);
	const startIndex = mainSource.indexOf('void startApplication()');
	const beforeQuitIndex = mainSource.indexOf("app.on('before-quit'");
	const willQuitIndex = mainSource.indexOf("app.on('will-quit'");
	assert.ok(beforeQuitIndex >= 0 && beforeQuitIndex < startIndex, 'quit intent is observed before startup begins');
	assert.ok(willQuitIndex >= 0 && willQuitIndex < startIndex, 'async shutdown is installed before startup begins');
	const willQuit = mainSource.slice(willQuitIndex, mainSource.indexOf('\n});', willQuitIndex));
	assert.match(willQuit, /event\.preventDefault\(\)/u, 'Electron waits for the explicit async shutdown path');
	assert.match(willQuit, /void exitApplication\(0\)/u);
	assert.match(mainSource, /resolveDesktopProjectLibraryAppData/u);
	assert.doesNotMatch(preloadSource, /projectLibrary|libraryRoot|appData/u);
	assert.match(prepareSource, /compileDesktopProjectLibraryRuntime/u);
	assert.match(prepareSource, /stageDesktopApplicationSources/u);
	assert.match(prepareSource, /desktopRuntime/u);
	assert.equal(packageMetadata.scripts['desktop:dev'], 'npm run desktop:prepare && electron .desktop-build/app');
});

test('desktop main owns save capabilities by committed renderer document', async () => {
	const mainSource = await readFile(join(ROOT, 'desktop', 'main.mjs'), 'utf8');
	assert.match(
		mainSource,
		/webContents\.on\('did-start-navigation'.*details\.isMainFrame && !details\.isSameDocument.*revokeRendererSaveOwner\(webContents\)/su,
	);
	assert.match(mainSource, /webContents\.on\('did-frame-navigate'.*frameProcessId.*frameRoutingId.*activateRendererSaveOwner/su);
	assert.match(mainSource, /webContents\.on\('render-process-gone'.*revokeRendererSaveOwner/su);
	assert.match(mainSource, /mainWindow\.on\('closed'.*revokeRendererSaveOwner\(webContents\)/su);

	const chooseStart = mainSource.indexOf('async function chooseSaveTarget');
	const chooseEnd = mainSource.indexOf('\nfunction ', chooseStart);
	const chooseSource = mainSource.slice(chooseStart, chooseEnd);
	const captureIndex = chooseSource.indexOf('rendererSaveOwnerFor(event)');
	const dialogIndex = chooseSource.indexOf('await dialog.showSaveDialog');
	assert.ok(captureIndex >= 0 && captureIndex < dialogIndex, 'save-dialog ownership is captured before awaiting user input');
	assert.match(chooseSource, /registerPath\(result\.filePath, \{ owner,/u);

	for (const channel of ['beginWrite', 'writeChunk', 'finishWrite', 'abortWrite']) {
		const handlerStart = mainSource.indexOf(`handle(IPC.${channel}`);
		const handlerEnd = mainSource.indexOf('\n\thandle(', handlerStart + 1);
		assert.ok(handlerStart >= 0, `missing ${channel} handler`);
		assert.match(
			mainSource.slice(handlerStart, handlerEnd),
			/rendererSaveOwnerFor\(event\)/u,
			`${channel} must receive its owner from trusted main-process state`,
		);
	}

	const revokeStart = mainSource.indexOf('function revokeRendererSaveOwner');
	const revokeEnd = mainSource.indexOf('\nfunction ', revokeStart + 1);
	const revokeSource = mainSource.slice(revokeStart, revokeEnd);
	assert.ok(revokeStart >= 0);
	assert.ok(
		revokeSource.indexOf('rendererSaveOwnership.revoke') < revokeSource.indexOf('startRendererSaveRevocation'),
		'revocation closes document admission synchronously before asynchronous cleanup',
	);
	const cleanupStart = mainSource.indexOf('function startRendererSaveRevocation');
	const cleanupEnd = mainSource.indexOf('\nfunction ', cleanupStart + 1);
	const cleanupSource = mainSource.slice(cleanupStart, cleanupEnd);
	assert.match(cleanupSource, /saves\.revokeOwner\(owner\)\.catch/u);
	assert.match(cleanupSource, /Desktop renderer save cleanup failed/u);

	const ownerForStart = mainSource.indexOf('function rendererSaveOwnerFor');
	const ownerForEnd = mainSource.indexOf('\nfunction ', ownerForStart + 1);
	const ownerForSource = mainSource.slice(ownerForStart, ownerForEnd);
	assert.match(ownerForSource, /event\.processId/u);
	assert.match(ownerForSource, /event\.frameId/u);

	const trustStart = mainSource.indexOf('function assertTrustedIpc');
	const trustEnd = mainSource.indexOf('\nfunction ', trustStart + 1);
	const trustSource = mainSource.slice(trustStart, trustEnd);
	assert.match(trustSource, /!event\.senderFrame/u);
	assert.match(trustSource, /event\.sender\.mainFrame/u);
});
