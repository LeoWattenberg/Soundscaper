/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAudioEditorProjectV10 } from '../src/common/editor/project-v10.ts';

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
import { serializeScapeProjectDocument } from '../src/common/editor/scape-project-document.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('desktop runtime compilation emits importable JavaScript with rewritten extensions', async (context) => {
	const temporaryRoot = await mkdtemp(join(tmpdir(), 'scape-desktop-runtime-'));
	context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
	const outputRoot = join(temporaryRoot, 'runtime');
	const result = await compileDesktopProjectLibraryRuntime({ repositoryRoot: ROOT, outputRoot });
	assert.deepEqual(result.files, [
		'desktop/application-lifecycle.js',
		'desktop/linked-original-locator-validation.js',
		'desktop/linked-video-locator-registry.js',
		'desktop/linked-video-locator-store.js',
		'desktop/main-window-recovery.js',
		'desktop/project-library-abort.js',
		'desktop/project-library-api.js',
		'desktop/project-library-contract.js',
		'desktop/project-library-database.js',
		'desktop/project-library-editor-managed-source.js',
		'desktop/project-library-editor-media-service.js',
		'desktop/project-library-editor-service.js',
		'desktop/project-library-file-inventory.js',
		'desktop/project-library-host.js',
		'desktop/project-library-media-binding.js',
		'desktop/project-library-media-body.js',
		'desktop/project-library-media-capacity.js',
		'desktop/project-library-media-inventory-reclamation.js',
		'desktop/project-library-media-inventory-schema.js',
		'desktop/project-library-media-inventory-store.js',
		'desktop/project-library-media-inventory.js',
		'desktop/project-library-media-reclamation.js',
		'desktop/project-library-media-reuse.js',
		'desktop/project-library-media.js',
		'desktop/project-library-persistence.js',
		'desktop/project-library-projects.js',
		'desktop/project-library-reclamation.js',
		'desktop/project-library-sequential-upload.js',
		'desktop/project-library-stage-inventory.js',
		'desktop/project-library-writer-coordinator.js',
		'desktop/project-library.js',
		'src/common/editor/adm-project-metadata.js',
		'src/common/editor/broadcast-wave.js',
		'src/common/editor/cart-metadata.js',
		'src/common/editor/ixml.js',
		'src/common/editor/persisted-audio-effect-validation.js',
		'src/common/editor/project-bext-metadata.js',
		'src/common/editor/project-feature-capabilities.js',
		'src/common/editor/project-feature-requirement-types.js',
		'src/common/editor/project-feature-requirements.js',
		'src/common/editor/project-schema-version.js',
		'src/common/editor/project-v10-foundation-validation.js',
		'src/common/editor/project-v10-validation.js',
		'src/common/editor/project-v9-document-validation.js',
		'src/common/editor/project-v9-media-validation.js',
		'src/common/editor/project-v9-validation-budget.js',
		'src/common/editor/project-v9-validation-primitives.js',
		'src/common/editor/retention.js',
		'src/common/editor/runtime-clip-projection.js',
		'src/common/editor/scape-project-document.js',
		'src/common/editor/scape-project-json-preflight.js',
		'src/common/editor/stable-id.js',
		'src/common/editor/terminal-channel-widths.js',
		'src/common/editor/timeline-time.js',
		'src/common/editor/video-effects.js',
		'src/common/editor/video-source-time.js',
		'src/common/editor/video-timeline.js',
		'src/common/editor/video-timing-asset-reference.js',
		'src/common/editor/wav-opaque-chunks.js',
	]);
	for (const name of result.files) {
		const source = await readFile(join(outputRoot, name), 'utf8');
		assert.doesNotMatch(source, /from ['"].*\.ts['"]/u);
	}
	const runtime = await import(`${pathToFileURL(join(outputRoot, 'desktop/project-library-host.js')).href}?test=${Date.now()}`);
	const linkedVideoRegistry = await import(`${pathToFileURL(join(outputRoot, 'desktop/linked-video-locator-registry.js')).href}?test=${Date.now()}`);
	const linkedVideoStore = await import(`${pathToFileURL(join(outputRoot, 'desktop/linked-video-locator-store.js')).href}?test=${Date.now()}`);
	const editorService = await import(`${pathToFileURL(join(outputRoot, 'desktop/project-library-editor-service.js')).href}?test=${Date.now()}`);
	const editorMediaService = await import(`${pathToFileURL(join(outputRoot, 'desktop/project-library-editor-media-service.js')).href}?test=${Date.now()}`);
	const managedMedia = await import(`${pathToFileURL(join(outputRoot, 'desktop/project-library-media.js')).href}?test=${Date.now()}`);
	assert.equal(typeof runtime.DesktopProjectLibraryHost?.start, 'function');
	assert.equal(typeof linkedVideoRegistry.FileDesktopLinkedVideoLocatorRegistry, 'function');
	assert.equal(typeof linkedVideoStore.DesktopLinkedVideoLocatorStore, 'function');
	assert.equal(typeof editorService.DesktopSharedProjectLibraryService, 'function');
	assert.equal(typeof editorMediaService.DesktopSharedProjectMediaService, 'function');
	assert.equal(typeof managedMedia.DesktopLibraryManagedMediaStore, 'function');
	let commitCalls = 0;
	const unusedManagedMediaHost = {
		publishManagedMedia: async () => { throw new Error('Unexpected managed-media publication'); },
		readManagedMedia: async () => new Uint8Array(),
		readProjectBundleById: async () => null,
	};
	const service = new editorService.DesktopSharedProjectLibraryService({
		...unusedManagedMediaHost,
		commitProjectById: async ({ project }) => {
			commitCalls += 1;
			return { catalog: {}, project };
		},
		deleteProjectById: async () => false,
		readCatalog: () => ({ projects: [] }),
		readProjectById: async () => null,
		snapshot: () => ({ owner: { product: 'soundscaper' } }),
	}, {
		createEntryId: () => 'packaging-entry-0001',
		now: () => 10_000,
	});
	const project = createAudioEditorProjectV10({
		id: 'packaging-project',
		title: 'Packaging project',
		now: '2026-07-30T12:00:00.000Z',
	});
	const validDocument = serializeScapeProjectDocument(project);
	assert.deepEqual(await service.commitSharedProject({ document: validDocument, expectedRevision: null }), {
		status: 'committed', document: validDocument,
	});
	const invalidDocument = serializeScapeProjectDocument({ ...project, tempo: { ...project.tempo, bpm: 0 } });
	await assert.rejects(() => service.commitSharedProject({
		document: invalidDocument, expectedRevision: null,
	}), /tempo\.bpm/u);
	assert.equal(commitCalls, 1);
	const boundedService = new editorService.DesktopSharedProjectLibraryService({
		...unusedManagedMediaHost,
		commitProjectById: async ({ project: committedProject }) => {
			commitCalls += 1;
			return { catalog: {}, project: committedProject };
		},
		deleteProjectById: async () => false,
		readCatalog: () => ({ projects: [] }),
		readProjectById: async () => null,
		snapshot: () => ({ owner: { product: 'soundscaper' } }),
	}, {
		createEntryId: () => 'packaging-entry-0002',
		documentLimits: {
			maximumPayloadCount: 1,
			maximumTraversalNodes: 80,
		},
		now: () => 10_000,
	});
	const overBudgetDocument = serializeScapeProjectDocument({
		...project,
		opaqueExtensions: { items: Array.from({ length: 16 }, (_, index) => index) },
	});
	await assert.rejects(
		() => boundedService.commitSharedProject({ document: overBudgetDocument, expectedRevision: null }),
		/JSON.*structural traversal node limit/iu,
	);
	assert.equal(commitCalls, 1, 'compiled structural admission must run before the host commit');
	await Promise.all([service.dispose(), boundedService.dispose()]);
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
	await access(join(applicationDesktopRoot, 'desktop-smoke.js'));
	await access(join(applicationDesktopRoot, 'direct-wav-smoke.js'));
	await access(join(applicationDesktopRoot, 'project-library-smoke-evidence.js'));
	await access(join(applicationDesktopRoot, 'project-library-source-bearing-renderer-smoke.js'));
	await access(join(applicationDesktopRoot, 'project-library-source-bearing-smoke-session.js'));
	await access(join(applicationDesktopRoot, 'project-library-source-bearing-smoke.js'));
	await access(join(applicationDesktopRoot, 'linked-video-locator-ipc.js'));
	await access(join(applicationDesktopRoot, 'linked-video-locator-runtime.js'));
	await access(join(applicationDesktopRoot, 'project-library-ipc.js'));
	await access(join(applicationDesktopRoot, 'read-selection-service.js'));
	await access(join(applicationDesktopRoot, 'renderer-save-owner.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'desktop/project-library-editor-service.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'desktop/linked-original-locator-validation.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'desktop/linked-video-locator-registry.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'desktop/linked-video-locator-store.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'desktop/project-library-editor-media-service.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'desktop/project-library-host.js'));
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
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'src/common/editor/project-v10-validation.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'src/common/editor/project-v9-validation-budget.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'src/common/editor/retention.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'src/common/editor/scape-project-document.js'));
	await access(join(applicationDesktopRoot, 'project-library-runtime', 'src/common/editor/scape-project-json-preflight.js'));
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
	assert.match(mainSource, /DesktopProjectLibraryHost\.start/u);
	assert.match(mainSource, /new DesktopSharedProjectLibraryService\(projectLibraryHost\)/u);
	assert.match(mainSource, /createDesktopSmokeProbe\(\{/u);
	assert.match(mainSource, /projectLibraryEvidence: projectLibrarySmokeEvidence/u);
	assert.match(mainSource, /desktopSmokeProbe\.attach\(mainWindow\)/u);
	assert.match(mainSource, /on\(IPC\.rendererReady.*desktopSmokeProbe\.rendererReady\(\)/su);
	assert.match(mainSource, /projectLibrarySmokeEvidence.*createDesktopProjectLibrarySmokeEvidence\(projectLibraryHost/su);
	assert.doesNotMatch(mainSource, /webContents\.executeJavaScript/u);
	assert.match(mainSource, /registerDesktopProjectLibraryIpc\(\{ handle, ownerFor: rendererSaveOwnerFor/u);
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
