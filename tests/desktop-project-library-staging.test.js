/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	compileDesktopProjectLibraryRuntime,
	stageDesktopApplicationSources,
} from '../scripts/lib/desktop-project-library-runtime.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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
	await access(join(applicationDesktopRoot, 'desktop-smoke.js'));
	await access(join(applicationDesktopRoot, 'framescaper-v18-artifact-smoke.js'));
	await access(join(applicationDesktopRoot, 'direct-wav-smoke.js'));
	await access(join(applicationDesktopRoot, 'project-library-smoke-evidence.js'));
	await access(join(applicationDesktopRoot, 'project-library-smoke-project.js'));
	await access(join(applicationDesktopRoot, 'project-library-source-bearing-renderer-smoke.js'));
	await access(join(applicationDesktopRoot, 'project-library-source-bearing-smoke-session.js'));
	await access(join(applicationDesktopRoot, 'project-library-source-bearing-smoke.js'));
	await access(join(applicationDesktopRoot, 'linked-video-locator-ipc.js'));
	await access(join(applicationDesktopRoot, 'linked-video-locator-runtime.js'));
	await access(join(applicationDesktopRoot, 'project-library-ipc.js'));
	await access(join(applicationDesktopRoot, 'project-library-product-runtime.js'));
	await access(join(applicationDesktopRoot, 'project-library-v10-sandbox-preload.cjs'));
	await access(join(applicationDesktopRoot, 'soundscaper-project-library-v10-sandbox-preload.cjs'));
	await access(join(applicationDesktopRoot, 'framescaper-capture-sandbox-preload.cjs'));
	await access(join(applicationDesktopRoot, 'read-selection-service.js'));
	await access(join(applicationDesktopRoot, 'renderer-save-owner.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'desktop/project-library-editor-service.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'desktop/linked-original-locator-validation.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'desktop/linked-video-locator-registry.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'desktop/linked-video-locator-store.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'desktop/project-library-editor-media-service.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'desktop/project-library-host.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'desktop/project-library-v10-main.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'desktop/project-library-v10-main-ipc.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'desktop/soundscaper-project-library-v10-main.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'desktop/soundscaper-project-library-v10-main-ipc.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'desktop/project-library-media-binding.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'desktop/project-library-media-body.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'desktop/project-library-media-capacity.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'desktop/project-library-media-inventory-store.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'desktop/project-library-media-inventory.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'desktop/project-library-media-reclamation.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'desktop/project-library-media-reuse.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'desktop/project-library-media.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'desktop/project-library-reclamation.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'desktop/project-library-projects.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'desktop/project-library-sequential-upload.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'desktop/project-library-stage-inventory.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'src/common/editor/project-hierarchy-document-validation.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'src/common/editor/track-folder-v12.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'src/common/editor/track-hierarchy-v12.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'src/common/editor/timeline-annotation.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'src/common/editor/runtime-timeline-annotation-projection.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'src/common/editor/timeline-coordinate-limits.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'src/common/editor/project-validation-budget.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'src/common/editor/retention.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'src/common/editor/scape-project-document.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'src/common/editor/scape-project-json-preflight.js'));
	await assert.rejects(() => access(join(applicationDesktopRoot, 'project-library-smoke-project-v10.js')), /ENOENT/u);
	const stagedMain = await readFile(join(applicationDesktopRoot, 'main.mjs'), 'utf8');
	const runtimeImports = [...stagedMain.matchAll(/from ['"]\.\/project-library-runtime\/([^'"]+)['"]/gu)];
	assert.ok(runtimeImports.length > 0, 'desktop main must import its compiled runtime');
	for (const [, relativePath] of runtimeImports) {
		await access(join(applicationDesktopRoot, 'project-library-runtime', relativePath));
	}
	const locatorRuntime = await readFile(join(applicationDesktopRoot, 'linked-video-locator-runtime.js'), 'utf8');
	assert.match(locatorRuntime, /project-library-runtime\/desktop\/linked-video-locator-registry\.js/u);
	assert.match(locatorRuntime, /project-library-runtime\/desktop\/linked-video-locator-store\.js/u);
	await assert.rejects(() => access(join(applicationDesktopRoot, 'project-library-host.ts')), /ENOENT/u);
});

test('desktop main initializes, exposes, and disposes the shared library through bounded IPC', async () => {
	const [mainSource, preloadSource, prepareSource, packageMetadata] = await Promise.all([
		readFile(join(ROOT, 'desktop', 'main.mjs'), 'utf8'),
		readFile(join(ROOT, 'desktop', 'preload.mjs'), 'utf8'),
		readFile(join(ROOT, 'scripts', 'desktop-prepare.mjs'), 'utf8'),
		readFile(join(ROOT, 'package.json'), 'utf8').then(JSON.parse),
	]);
	const readyIndex = mainSource.indexOf('await app.whenReady()');
	const appDataIndex = mainSource.indexOf("app.getPath('appData')");
	assert.ok(readyIndex >= 0 && appDataIndex > readyIndex, 'shared appData is resolved only after Electron is ready');
	assert.match(mainSource, /startDesktopProjectLibraryProductRuntime/u);
	assert.match(mainSource, /productId:\s*PRODUCT_ID/u);
	assert.match(mainSource, /createDesktopSmokeProbe\(\{/u);
	assert.match(mainSource, /projectLibraryEvidence: projectLibrarySmokeEvidence/u);
	assert.match(mainSource, /desktopSmokeProbe\.attach\(mainWindow\)/u);
	assert.match(mainSource, /on\(IPC\.rendererReady.*desktopSmokeProbe\.rendererReady\(\)/su);
	assert.match(mainSource, /projectLibrarySmokeEvidence.*projectLibraryRuntime\.smokeEvidence/su);
	assert.doesNotMatch(mainSource, /webContents\.executeJavaScript/u);
	assert.match(mainSource, /projectLibraryRuntime\.registerRendererBridge\(\{/u);
	assert.match(mainSource, /ownerFor:\s*rendererSaveOwnerFor/u);
	assert.match(mainSource, /new DesktopApplicationShutdown/u);
	assert.match(mainSource, /name: 'project library', run: closeProjectLibraryHost/u);
	assert.match(mainSource, /nativeTier = registerDesktopNativeTier\(\{ channels: IPC, handle, ownerFor: rendererSaveOwnerFor, readCapabilities, settings/u,
		'the native tier must register through the trusted IPC wrapper with main-owned seams');
	assert.match(mainSource, /userDataPath: app\.getPath\('userData'\), parentWindow: \(\) => mainWindow/u,
		'the native tier must be handed the durable-store path and the window its pickers open over');
	assert.match(mainSource, /await nativeTier\.ready\(\)/u,
		'the durable stores behind the native surfaces must be loaded before a renderer can consult them');
	assert.match(mainSource, /name: 'native tier', run: \(\) => disposeDesktopNativeTier\(nativeTier\)/u,
		'every native helper must join the ordered shutdown barrier together');
	assert.match(mainSource, /revokeNativeTier: \(owner\) => revokeDesktopNativeTierOwner\(nativeTier, owner\)/u,
		'renderer ownership cleanup must drain every native surface together when a renderer goes away');
	// Reachability, not one particular surface: an application menu entry, a
	// toolbar control, a View > Panels panel and a keyboard shortcut each satisfy
	// the discoverability rule on their own, so pinning the menubar would forbid
	// moving these commands to any of the other three.
	assert.ok(
		[
			/desktopNativeTierMenu\(settings/u,
			/desktopNativeTierToolbar\(/u,
			/desktopNativeTierPanel\(/u,
			/desktopNativeTierShortcuts\(/u,
		].some((surface) => surface.test(mainSource)),
		'the native surfaces must stay reachable from a qualifying discoverability surface',
	);
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
	assert.match(prepareSource, /imports: DESKTOP_RUNTIME_PACKAGE_IMPORTS/u,
		'the staged application manifest must map the desktop package-imports aliases to shipped runtime members');
	assert.equal(packageMetadata.scripts['desktop:dev'], 'npm run desktop:prepare && electron .desktop-build/app');
});

test('desktop main owns file capabilities by committed renderer document', async () => {
	const mainSource = await readFile(join(ROOT, 'desktop', 'main.mjs'), 'utf8');
	const cleanupSource = await readFile(join(ROOT, 'desktop', 'renderer-ownership-cleanup.js'), 'utf8');
	assert.match(
		mainSource,
		/webContents\.on\('did-start-navigation'.*details\.isMainFrame && !details\.isSameDocument.*revokeRendererSaveOwner\(webContents\)/su,
	);
	assert.match(mainSource, /webContents\.on\('did-frame-navigate'.*frameProcessId.*frameRoutingId.*activateRendererSaveOwner/su);
	assert.match(mainSource, /attachDesktopMainWindowRecovery\(\{.*rendererOwnershipCleanup\.drain\(webContents\)/su);
	assert.match(mainSource, /mainWindow\.on\('closed'.*revokeRendererSaveOwner\(webContents\)/su);

	const chooseStart = mainSource.indexOf('async function chooseSaveTarget');
	const chooseEnd = mainSource.indexOf('\nfunction ', chooseStart);
	const chooseSource = mainSource.slice(chooseStart, chooseEnd);
	const captureIndex = chooseSource.indexOf('rendererSaveOwnerFor(event)');
	const validationIndex = chooseSource.indexOf('validateSaveChoice(value)');
	const smokeTargetIndex = chooseSource.indexOf('await desktopSmokeProbe.resolveSavePath(choice)');
	const dialogIndex = chooseSource.indexOf('await dialog.showSaveDialog');
	assert.ok(captureIndex >= 0 && captureIndex < dialogIndex, 'save-dialog ownership is captured before awaiting user input');
	assert.ok(
		validationIndex >= 0 && smokeTargetIndex > validationIndex && smokeTargetIndex < dialogIndex,
		'validated packaged-smoke targets bypass the native dialog before any user-selected path is admitted',
	);
	assert.match(chooseSource, /registerPath\(smokeFilePath, \{ owner, purpose: choice\.purpose \}\)/u);
	assert.match(chooseSource, /registerPath\(result\.filePath, \{ owner,/u);

	for (const channel of ['beginWrite', 'writeChunk', 'patchFinalPrefix', 'finishWrite', 'abortWrite']) {
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
		revokeSource.indexOf('rendererReady = false') < revokeSource.indexOf('rendererOwnershipCleanup.revoke'),
		'revocation closes document admission synchronously before asynchronous cleanup',
	);
	assert.match(cleanupSource, /const owner = this\.#ownership\.revoke\(webContents\)/u);
	assert.match(cleanupSource, /this\.#revokeNativeTier\?\.\(owner\)/u);
	assert.match(cleanupSource, /this\.#projectLibraryIpc\(\)\?\.revokeOwner\(owner\)/u);
	assert.match(cleanupSource, /this\.#readCapabilities\.revokeOwner\(owner\)/u);
	assert.match(cleanupSource, /this\.#saves\.revokeOwner\(owner\)/u);

	const chooseReadStart = mainSource.indexOf('async function chooseFiles');
	const chooseReadEnd = mainSource.indexOf('\nfunction ', chooseReadStart);
	const chooseReadSource = mainSource.slice(chooseReadStart, chooseReadEnd);
	const readCaptureIndex = chooseReadSource.indexOf('rendererSaveOwnerFor(event)');
	const readDialogIndex = chooseReadSource.indexOf('await dialog.showOpenDialog');
	assert.ok(readCaptureIndex >= 0 && readCaptureIndex < readDialogIndex,
		'read-dialog ownership is captured before awaiting user input');
	assert.match(
		chooseReadSource,
		/registerSelectedReadCapability\(readCapabilities, filePath, \{ owner, purpose: choice\.purpose \}\)/u,
	);
	assert.match(chooseReadSource, /throwAfterReadCapabilityRollback\(readCapabilities, descriptors, owner, error\)/u);

	const chooseReadHandler = mainSource.slice(
		mainSource.indexOf('handle(IPC.chooseFiles'),
		mainSource.indexOf('\n\thandle(', mainSource.indexOf('handle(IPC.chooseFiles') + 1),
	);
	assert.match(chooseReadHandler, /\(event, value\).*chooseFiles\(event, value\)/su);
	const releaseReadHandler = mainSource.slice(
		mainSource.indexOf('handle(IPC.releaseRead'),
		mainSource.indexOf('\n\thandle(', mainSource.indexOf('handle(IPC.releaseRead') + 1),
	);
	assert.match(releaseReadHandler, /rendererSaveOwnerFor\(event\)/u);
	assert.match(releaseReadHandler, /redispatchPendingProjectsAfterReadRelease/u);

	assert.match(mainSource, /new PendingProjectQueue\(createPendingProjectDelivery\(\{/u);
	const dispatchStart = mainSource.indexOf('createPendingProjectDelivery({');
	const dispatchEnd = mainSource.indexOf('}));', dispatchStart);
	const dispatchSource = mainSource.slice(dispatchStart, dispatchEnd);
	assert.match(dispatchSource, /currentOwnerFor\(mainWindow\.webContents\)/u);
	assert.match(
		dispatchSource,
		/registerSelectedReadCapability\(readCapabilities, filePath, \{ owner, purpose: 'project' \}\)/u,
	);
	assert.match(dispatchSource, /isOwnerCurrent: isRendererSaveOwnerCurrent/u,
		'owner replacement is checked by the serialized delivery service');
	assert.match(dispatchSource, /release: \(id, owner\) => readCapabilities\.release\(id, \{ owner \}\)/u);
	assert.match(
		dispatchSource,
		/desktopSmokeProbe\.observeProjectDescriptor\(descriptor, \(id\) => readCapabilities\.get\(id\)\)/u,
	);
	assert.match(dispatchSource, /return sendToRenderer\(IPC\.openProject, descriptor\)/u);

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
