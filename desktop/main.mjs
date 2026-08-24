import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, extname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	app,
	BrowserWindow,
	desktopCapturer,
	dialog,
	ipcMain,
	Menu,
	protocol,
	session,
	shell,
} from 'electron/main';
import {
	APP_ID,
	APP_NAME,
	APP_ORIGIN,
	APP_SCHEME,
	EXTERNAL_DESTINATIONS,
	IPC,
	PRODUCT_ID,
	SESSION_PARTITION,
	SUPPORTED_LOCALES,
	UPDATE_TAG_PREFIX,
} from './constants.js';
import { DesktopApplicationShutdown, resolveDesktopProjectLibraryAppData } from './project-library-runtime/desktop/application-lifecycle.js';
import { registerAssistance } from './assistance-registration.mjs';
import { disposeDesktopCaptureSecurity, registerDesktopCaptureSecurity, revokeDesktopCaptureOwner } from './framescaper-capture-registration.mjs';
import { createFramescaperNativeServicesElectronPorts } from './framescaper-native-services-electron-ports.mjs';
import { startFramescaperNativeServicesRegistration } from './framescaper-native-services-registration.mjs';
import { FRAMESCAPER_SELECTED_V28_IMAGE_SEQUENCE_IMPORT_AUTHORITY } from './framescaper-selected-v28-route-authorities.mjs';
import { framescaperWebVcrSmokeQualification } from './framescaper-web-vcr-smoke-plan.js';
import { disposeDesktopNativeTier, registerDesktopNativeTier, revokeDesktopNativeTierOwner } from './native-tier-registration.mjs';
import { registerHostAffordances } from './host-affordances.mjs';
import { registerExternalFfmpegPreferences } from './external-ffmpeg-registration.mjs';
import { registerDesktopAudioCodecs } from './desktop-audio-codec-registration.mjs';
import { ReadCapabilityStore, throwAfterReadCapabilityRollback } from './file-capabilities.js';
import {
	createPendingProjectDelivery, PendingProjectQueue, extractProjectPaths,
	redispatchPendingProjectsAfterReadRelease,
} from './file-associations.js';
import { registerSelectedReadCapability } from './read-selection-service.js';
import { createProtocolHandler, registerAppScheme } from './protocol.js';
import { createDesktopSmokeProbe } from './desktop-smoke.js';
import { createDesktopNightlyTestsWindow } from './nightly-tests-window.mjs';
import { createDesktopLinkedVideoLocatorRuntime } from './linked-video-locator-runtime.js';
import { startDesktopProjectLibraryProductRuntime } from './project-library-product-runtime.js';
import { attachDesktopMainWindowRecovery } from './project-library-runtime/desktop/main-window-recovery.js';
import { registerDesktopNativeTierControls } from './project-library-runtime/desktop/native-tier-controls.js';
import { RendererSaveOwnership } from './renderer-save-owner.js';
import { DesktopRendererOwnershipCleanup } from './renderer-ownership-cleanup.js';
import { AtomicSaveManager, SaveTargetStore } from './save-targets.js';
import { DesktopSettingsStore } from './settings.js';
import { ReleaseChecker } from './update-check.js';
import {
	desktopWindowOptions,
	hideNativeWindowButtons,
	installDesktopApplicationMenu,
	onWindowStateChanged,
	registerFocusedWindowAccelerators,
	runWindowAction, upgradePendingCloseRequestForQuit,
} from './window-chrome.mjs';
import {
	acceptsFile,
	assertEditorDocumentUrl,
	isEditorDocumentUrl,
	validateFileChoice,
	validateLocale,
	validateSaveChoice,
} from './validation.js';
const __dirname = dirname(fileURLToPath(import.meta.url));
const readCapabilities = new ReadCapabilityStore();
const saveTargets = new SaveTargetStore();
const saves = new AtomicSaveManager({ targets: saveTargets });
const rendererSaveOwnership = new RendererSaveOwnership();
let mainWindow = null;
let nightlyTestsWindow = null;
let settings = null;
let releaseChecker = null;
let rendererReady = false;
let pendingClose = null;
let projectLibraryRuntime = null;
let projectLibraryStartup = null;
let projectLibraryIpc = null;
let linkedVideoLocators = null;
let nativeTier = null;
let nativeServices = null;
let captureSecurity = null, assistance = null, externalFfmpegPreferences = null, desktopAudioCodecs = null;
let allowNextClose = false;
let applicationIsQuitting = false;
const rendererOwnershipCleanup = new DesktopRendererOwnershipCleanup({
	revokeCapture: (owner) => revokeDesktopCaptureOwner(captureSecurity, owner),
	revokeDesktopAudioCodecs: (owner) => desktopAudioCodecs?.revokeOwner(owner),
	revokeNativeServices: (owner) => nativeServices?.revokeOwner(owner),
	revokeNativeTier: (owner) => revokeDesktopNativeTierOwner(nativeTier, owner),
	linkedVideoLocators: () => linkedVideoLocators,
	ownership: rendererSaveOwnership,
	projectLibraryIpc: () => projectLibraryIpc,
	readCapabilities,
	reportError: (error) => console.error('Desktop renderer ownership cleanup failed:', cleanError(error)),
	saves,
});
const pendingOpenProjects = new PendingProjectQueue(createPendingProjectDelivery({
	isReady: () => rendererReady && mainWindow && !mainWindow.isDestroyed(),
	currentOwner: () => rendererSaveOwnership.currentOwnerFor(mainWindow.webContents),
	isOwnerCurrent: isRendererSaveOwnerCurrent,
	register: (filePath, owner) => registerSelectedReadCapability(readCapabilities, filePath, { owner, purpose: 'project' }),
	release: (id, owner) => readCapabilities.release(id, { owner }),
	send: (descriptor) => {
		desktopSmokeProbe.observeProjectDescriptor(descriptor, (id) => readCapabilities.get(id));
		return sendToRenderer(IPC.openProject, descriptor);
	},
	reportError: reportPendingProjectError,
}));
const applicationShutdown = new DesktopApplicationShutdown({
	tasks: [
		{ name: 'desktop audio codecs', run: () => desktopAudioCodecs?.dispose() },
		{ name: 'external FFmpeg preferences', run: () => externalFfmpegPreferences?.dispose() },
		{ name: 'capture security', run: () => disposeDesktopCaptureSecurity(captureSecurity) },
		{ name: 'native services', run: () => nativeServices?.dispose() },
		{ name: 'project library', run: closeProjectLibraryHost },
		{ name: 'linked-video locators', run: () => linkedVideoLocators?.dispose() },
		{ name: 'native tier', run: () => disposeDesktopNativeTier(nativeTier) },
		{ name: 'assistance', run: () => assistance?.dispose() },
		{ name: 'read capabilities', run: () => readCapabilities.dispose() },
		{ name: 'save sessions', run: () => saves.dispose() },
	],
	exit: (code) => app.exit(code),
	reportError: (name, error) => {
		console.error(`Desktop ${name} shutdown failed:`, cleanError(error));
	},
});
const desktopSmokeProbe = createDesktopSmokeProbe({
	argv: process.argv,
	appName: APP_NAME,
	appOrigin: APP_ORIGIN,
	productId: PRODUCT_ID,
	exit: exitApplication,
	projectLibraryEvidence: projectLibrarySmokeEvidence,
	projectLibrarySnapshot: () => projectLibraryRuntime?.snapshot(),
});
app.setName(APP_NAME);
app.commandLine.appendSwitch('enable-gpu');
app.enableSandbox();
registerAppScheme(protocol);

app.on('open-file', (event, filePath) => {
	event.preventDefault();
	enqueueProjectPath(filePath);
});

app.on('before-quit', () => {
	applicationIsQuitting = true;
});

app.on('will-quit', (event) => {
	event.preventDefault();
	void exitApplication(0);
});

if (!app.requestSingleInstanceLock()) {
	app.quit();
} else {
	app.on('second-instance', (_event, argv, workingDirectory) => {
		for (const filePath of extractProjectPaths(argv, workingDirectory)) enqueueProjectPath(filePath);
		if (mainWindow && !mainWindow.isDestroyed()) {
			if (mainWindow.isMinimized()) mainWindow.restore();
			mainWindow.show();
			mainWindow.focus();
		}
	});
	for (const filePath of extractProjectPaths(process.argv, process.cwd())) enqueueProjectPath(filePath);
	void startApplication().catch(async (error) => {
		console.error('Soundscaper desktop failed to start:', cleanError(error));
		await exitApplication(1);
	});
}

async function startApplication() {
	await app.whenReady();
	linkedVideoLocators = createDesktopLinkedVideoLocatorRuntime({ readCapabilities, registryPath: resolve(app.getPath('userData'), 'linked-video-locators-v1.json') });
	await linkedVideoLocators.ready();
	if (applicationShutdown.requested) return;
	const libraryStartup = startDesktopProjectLibraryProductRuntime({
		productId: PRODUCT_ID,
		appDataPath: resolveDesktopProjectLibraryAppData({
			applicationDataPath: app.getPath('appData'),
			argv: process.argv,
		}),
		processId: process.pid,
		instanceId: randomUUID(),
		leaseQualification: desktopSmokeProbe.projectLibraryLeaseQualification(),
		onLeaseLost: (error) => {
			console.error('Shared desktop project library lease was lost:', cleanError(error));
			void exitApplication(1);
		},
	});
	projectLibraryStartup = libraryStartup;
	try {
		projectLibraryRuntime = await libraryStartup;
	} finally {
		if (projectLibraryStartup === libraryStartup) projectLibraryStartup = null;
	}
	if (applicationShutdown.requested) return;
	if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
	const resources = resourceRoots();
	settings = new DesktopSettingsStore(resolve(app.getPath('userData'), 'desktop-settings.json'));
	await settings.load([app.getLocale(), ...app.getPreferredSystemLanguages()]);
	if (applicationShutdown.requested) return;
	nativeServices = await startFramescaperNativeServicesRegistration({
		productId: PRODUCT_ID, userDataPath: app.getPath('userData'), instanceId: randomUUID(),
		processId: process.pid, settings,
		projectAuthority: projectLibraryRuntime.nativeServicesAuthority(),
		imageSequenceImportAuthority: PRODUCT_ID === 'framescaper' ? FRAMESCAPER_SELECTED_V28_IMAGE_SEQUENCE_IMPORT_AUTHORITY : null,
		watchImportAuthority: PRODUCT_ID === 'framescaper' ? Object.freeze({ currentOwner: currentRendererSaveOwner, isOwnerCurrent: isRendererSaveOwnerCurrent, locator: linkedVideoLocators.watchImportAuthority() }) : null,
		onFenced: (error) => { console.error('Framescaper native services were fenced:', cleanError(error)); void exitApplication(1); },
		...createFramescaperNativeServicesElectronPorts(settings, (error) => console.error('Framescaper native service failed:', cleanError(error))),
	});
	releaseChecker = new ReleaseChecker({ currentVersion: app.getVersion(), settings, tagPrefix: UPDATE_TAG_PREFIX });

	const desktopSession = session.fromPartition(SESSION_PARTITION);
	await desktopSession.protocol.handle(APP_SCHEME, createProtocolHandler({
		productId: PRODUCT_ID,
		rendererRoot: resources.renderer,
		runtimeRoot: resources.runtime,
		readCapabilities,
	}));
	if (applicationShutdown.requested) return;
	await registerIpcHandlers(desktopSession);
	installDesktopApplicationMenu({
		Menu,
		appName: APP_NAME,
		platform: process.platform,
		onPreferences: () => sendToRenderer(IPC.menuCommand, { command: 'preferences' }),
	});
	await createWindow();
	nightlyTestsWindow = await createDesktopNightlyTestsWindow({ argv: process.argv, BrowserWindow });
	nightlyTestsWindow?.once('closed', () => { nightlyTestsWindow = null; });
	void checkForUpdates(false);

	app.on('activate', () => {
		if (!BrowserWindow.getAllWindows().length) void createWindow();
	});
	app.on('window-all-closed', () => {
		if (process.platform !== 'darwin') app.quit();
	});
}

async function createWindow() {
	if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
	rendererReady = false;
	pendingClose = null;
	allowNextClose = false;
	mainWindow = new BrowserWindow({
		...desktopWindowOptions(),
		title: APP_NAME,
		width: 1440,
		height: 900,
		minWidth: 900,
		minHeight: 600,
		show: false,
		backgroundColor: '#1b1b1b',
		webPreferences: {
			preload: resolve(__dirname, 'preload.mjs'),
			partition: SESSION_PARTITION,
			nodeIntegration: false,
			contextIsolation: true,
			sandbox: true,
			webSecurity: true,
			allowRunningInsecureContent: false,
			webviewTag: false,
			devTools: !app.isPackaged,
		},
	});
	hideNativeWindowButtons(mainWindow, process.platform);
	lockNavigation(mainWindow);
	registerFocusedWindowAccelerators({
		window: mainWindow,
		platform: process.platform,
		development: !app.isPackaged,
		dispatch: (command) => sendToRenderer(IPC.menuCommand, { command }),
		runAction: runCurrentWindowAction,
	});
	desktopSmokeProbe.attach(mainWindow);
	const webContents = mainWindow.webContents;
	attachDesktopMainWindowRecovery({
		cleanup: async () => { rendererReady = false; await rendererOwnershipCleanup.drain(webContents); },
		editorUrl: `${APP_ORIGIN}/`,
		exit: exitApplication,
		isIntentional: () => applicationIsQuitting || allowNextClose || !mainWindow || mainWindow.isDestroyed(),
		reportError: (error) => console.error('Desktop renderer recovery failed:', cleanError(error)),
		webContents,
		windowFor: () => mainWindow,
	});
	webContents.on('did-start-navigation', (details) => {
		if (details.isMainFrame && !details.isSameDocument) revokeRendererSaveOwner(webContents);
	});
	webContents.on('did-frame-navigate', (_event, url, _code, _status, isMainFrame, frameProcessId, frameRoutingId) => {
		if (isMainFrame && isEditorDocumentUrl(url)) {
			activateRendererSaveOwner(webContents, frameProcessId, frameRoutingId);
		}
	});
	mainWindow.once('ready-to-show', () => mainWindow?.show());
	mainWindow.on('maximize', publishWindowState);
	mainWindow.on('unmaximize', publishWindowState);
	mainWindow.on('enter-full-screen', publishWindowState);
	mainWindow.on('leave-full-screen', publishWindowState);
	mainWindow.on('close', (event) => {
		if (allowNextClose || !rendererReady) return;
		event.preventDefault();
		if (pendingClose) {
			pendingClose = upgradePendingCloseRequestForQuit(pendingClose, applicationIsQuitting);
			return;
		}
		pendingClose = { requestId: randomUUID(), reason: applicationIsQuitting ? 'quit' : 'window-close' };
		sendToRenderer(IPC.closeRequested, pendingClose);
	});
	mainWindow.on('closed', () => {
		revokeRendererSaveOwner(webContents);
		mainWindow = null;
		rendererReady = false;
		pendingClose = null;
	});
	await mainWindow.loadURL(`${APP_ORIGIN}/`);
	return mainWindow;
}

function activateRendererSaveOwner(webContents, processId, frameId) {
	if (!mainWindow || mainWindow.webContents !== webContents) return;
	const { revokedOwner } = rendererSaveOwnership.activate({ webContents, processId, frameId });
	if (revokedOwner) rendererOwnershipCleanup.start(revokedOwner);
}

function revokeRendererSaveOwner(webContents) {
	rendererReady = false;
	rendererOwnershipCleanup.revoke(webContents);
}

function rendererSaveOwnerFor(event) {
	return rendererSaveOwnership.ownerFor({
		sender: event.sender,
		processId: event.processId,
		frameId: event.frameId,
	});
}

function isRendererSaveOwnerCurrent(owner) { if (!owner || !rendererReady || !mainWindow || mainWindow.isDestroyed()) return false; try { return rendererSaveOwnership.currentOwnerFor(mainWindow.webContents) === owner; } catch { return false; } }

function currentRendererSaveOwner() { if (!rendererReady || !mainWindow || mainWindow.isDestroyed()) return null; try { return rendererSaveOwnership.currentOwnerFor(mainWindow.webContents); } catch { return null; } }

async function registerIpcHandlers(desktopSession) {
	captureSecurity = registerDesktopCaptureSecurity({
		appOrigin: APP_ORIGIN, desktopCapturer, desktopRoot: __dirname, desktopSession,
		createWebVcrWindow: (options) => new BrowserWindow(options), sessionFromPartition: (partition) => session.fromPartition(partition),
		handle, removeHandler: (channel) => ipcMain.removeHandler(channel),
		ownerFor: rendererSaveOwnerFor,
		currentOwnerFor: (webContents) => rendererSaveOwnership.currentOwnerFor(webContents),
		observeWebVcrDisplaySecurityWitness: (value) => desktopSmokeProbe.observeWebVcrDisplaySecurityWitness(value),
		platform: process.platform, productId: PRODUCT_ID,
		systemVersion: process.getSystemVersion?.() ?? '', webVcrQualification: framescaperWebVcrSmokeQualification(process.argv, { packaged: app.isPackaged, productId: PRODUCT_ID }), windowFor: () => mainWindow,
	});
	projectLibraryIpc = projectLibraryRuntime.registerRendererBridge({
		desktopRoot: __dirname,
		handle,
		ownerFor: rendererSaveOwnerFor,
		removeHandler: (channel) => ipcMain.removeHandler(channel),
		session: desktopSession,
	});
	nativeServices?.registerRendererBridge({ handle, ownerFor: rendererSaveOwnerFor, removeHandler: (channel) => ipcMain.removeHandler(channel), on: (channel, listener) => ipcMain.on(channel, listener), removeListener: (channel, listener) => ipcMain.removeListener(channel, listener) });
	linkedVideoLocators.registerIpc({ dialog, handle, ownerFor: rendererSaveOwnerFor, windowFor: () => mainWindow });
	nativeTier = registerDesktopNativeTier({ channels: IPC, handle, ownerFor: rendererSaveOwnerFor, readCapabilities, settings, desktopRoot: __dirname, packaged: app.isPackaged, resourcesPath: process.resourcesPath, userDataPath: app.getPath('userData'), parentWindow: () => mainWindow, productId: PRODUCT_ID, nativePluginStateAuthority: () => projectLibraryRuntime.nativePluginStateAuthority() });
	await nativeTier.ready();
	registerDesktopNativeTierControls({ channels: IPC, handle, ownerFor: rendererSaveOwnerFor, settings, tier: nativeTier });
	externalFfmpegPreferences = await registerExternalFfmpegPreferences({ channels: IPC, handle, removeHandler: (channel) => ipcMain.removeHandler(channel), settings, dialog, windowFor: () => mainWindow, platform: process.platform, architecture: process.arch, userDataPath: app.getPath('userData'), environment: process.env });
	desktopAudioCodecs = await registerDesktopAudioCodecs({ channels: IPC, handle, removeHandler: (channel) => ipcMain.removeHandler(channel), ownerFor: rendererSaveOwnerFor, externalFfmpegPreferences: externalFfmpegPreferences.service, platform: process.platform, architecture: process.arch, userDataPath: app.getPath('userData') });
	handle(IPC.environment, () => ({
		platform: process.platform,
		arch: process.arch,
		version: app.getVersion(),
		development: !app.isPackaged,
		locale: settings.snapshot().locale,
		supportedLocales: [...SUPPORTED_LOCALES],
		capabilities: { displayAudio: process.platform === 'win32', updates: settings.snapshot().updatesEnabled },
	}));
	handle(IPC.chooseFiles, (event, value) => chooseFiles(event, value));
	handle(IPC.releaseRead, (event, id) => redispatchPendingProjectsAfterReadRelease(
		pendingOpenProjects,
		readCapabilities.release(opaqueId(id, 64), { owner: rendererSaveOwnerFor(event) }),
	));
	handle(IPC.chooseSaveTarget, (event, value) => chooseSaveTarget(event, value));
	handle(IPC.beginWrite, (event, value) => saves.begin({
		owner: rendererSaveOwnerFor(event),
		targetId: opaqueId(value?.targetId, 48),
		size: value?.size,
		maximumSize: value?.maximumSize,
		finalPrefixByteLength: value?.finalPrefixByteLength,
	}));
	handle(IPC.writeChunk, (event, value) => saves.writeChunk({ owner: rendererSaveOwnerFor(event), writeId: opaqueId(value?.writeId, 32), offset: value?.offset, bytes: value?.bytes }));
	handle(IPC.patchFinalPrefix, (event, value) => saves.patchFinalPrefix({ owner: rendererSaveOwnerFor(event), writeId: opaqueId(value?.writeId, 32), bytes: value?.bytes }));
	handle(IPC.finishWrite, (event, id) => saves.finish(opaqueId(id, 32), { owner: rendererSaveOwnerFor(event) }));
	handle(IPC.abortWrite, (event, id) => saves.abort(opaqueId(id, 32), { owner: rendererSaveOwnerFor(event) }));
	handle(IPC.setLocale, async (_event, value) => {
		const locale = validateLocale(value);
		await settings.setLocale(locale);
		rendererReady = false;
		await mainWindow.loadURL(`${APP_ORIGIN}/`);
		return locale;
	});
	handle(IPC.checkForUpdates, () => checkForUpdates(true));
	assistance = registerAssistance({ channels: IPC, handle, sendToRenderer, app, settings });
	registerHostAffordances({ channels: IPC, handle, windowFor: () => mainWindow });
	handle(IPC.windowAction, (_event, action) => runCurrentWindowAction(action));
	on(IPC.rendererReady, () => {
		rendererReady = true;
		publishWindowState();
		void desktopSmokeProbe.rendererReady();
		void pendingOpenProjects.dispatch();
	});
	on(IPC.respondToClose, (_event, response) => respondToClose(response));
}

function handle(channel, listener) {
	ipcMain.handle(channel, (event, ...args) => {
		assertTrustedIpc(event);
		return listener(event, ...args);
	});
}

function on(channel, listener) {
	ipcMain.on(channel, (event, ...args) => {
		assertTrustedIpc(event);
		listener(event, ...args);
	});
}

function assertTrustedIpc(event) {
	if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('IPC sender is not the application window');
	if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) {
		throw new Error('IPC sender is not the active main document');
	}
	assertEditorDocumentUrl(event.senderFrame.url);
}

async function chooseFiles(event, value) {
	const owner = rendererSaveOwnerFor(event);
	const choice = validateFileChoice(value);
	const smokeFilePaths = desktopSmokeProbe.resolveOpenPaths(choice);
	const result = smokeFilePaths !== null ? { canceled: false, filePaths: smokeFilePaths }
		: await dialog.showOpenDialog(mainWindow, {
			title: choice.purpose === 'project' ? 'Open project' : 'Import files',
			properties: choice.multiple ? ['openFile', 'multiSelections'] : ['openFile'], filters: choice.filters,
		});
	if (result.canceled) return [];
	const descriptors = [];
	try {
		for (const filePath of result.filePaths) {
			if (!acceptsFile(choice.purpose, filePath)) throw new TypeError('The selected file type is not allowed');
			descriptors.push(await registerSelectedReadCapability(readCapabilities, filePath, { owner, purpose: choice.purpose }));
		}
		return descriptors;
	} catch (error) {
		await throwAfterReadCapabilityRollback(readCapabilities, descriptors, owner, error);
	}
}

async function chooseSaveTarget(event, value) {
	const owner = rendererSaveOwnerFor(event);
	const choice = validateSaveChoice(value);
	const smokeFilePath = await desktopSmokeProbe.resolveSavePath(choice);
	if (smokeFilePath !== null) {
		return saveTargets.registerPath(smokeFilePath, { owner, purpose: choice.purpose });
	}
	const result = await dialog.showSaveDialog(mainWindow, {
		title: choice.purpose === 'project' ? 'Export Audacity interchange' : 'Export',
		defaultPath: choice.suggestedName,
		filters: choice.filters,
	});
	return result.canceled || !result.filePath
		? null
		: saveTargets.registerPath(result.filePath, { owner, purpose: choice.purpose });
}

function respondToClose(value) {
	if (!pendingClose || value?.requestId !== pendingClose.requestId) return;
	const request = pendingClose;
	pendingClose = null;
	if (value?.allow !== true) {
		applicationIsQuitting = false;
		return;
	}
	allowNextClose = true;
	if (request.reason === 'quit') app.quit();
	else mainWindow?.close();
}

function reportPendingProjectError(error) {
	void dialog.showMessageBox(mainWindow, {
		type: 'error',
		title: 'Could not open project',
		message: `${APP_NAME} could not read the selected project.`,
		detail: cleanError(error),
	});
}

function enqueueProjectPath(filePath) {
	if (!filePath || !['.aup3', '.aup4', '.scape'].includes(extname(filePath).toLowerCase())) return;
	const absolutePath = isAbsolute(filePath) ? filePath : resolve(filePath);
	pendingOpenProjects.enqueue(absolutePath);
	if (rendererReady) void pendingOpenProjects.dispatch();
}

function lockNavigation(window) {
	window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
	window.webContents.on('will-navigate', (event, url) => {
		if (!isEditorDocumentUrl(url)) event.preventDefault();
	});
	window.webContents.on('will-attach-webview', (event) => event.preventDefault());
}

async function checkForUpdates(manual) {
	const result = await releaseChecker.check({ manual });
	if (result.status === 'available' && mainWindow) {
		const response = await dialog.showMessageBox(mainWindow, {
			type: 'info',
			title: `${APP_NAME} update available`,
			message: `${APP_NAME} ${result.version} is available.`,
			detail: 'Updates are never downloaded or installed automatically.',
			buttons: ['View Release', 'Later'],
			defaultId: 0,
			cancelId: 1,
		});
		if (response.response === 0) await shell.openExternal(EXTERNAL_DESTINATIONS.releases);
	} else if (manual && result.status === 'current' && mainWindow) {
		await dialog.showMessageBox(mainWindow, { type: 'info', title: `${APP_NAME} is up to date`, message: 'You are using the newest available release.' });
	} else if (manual && result.status === 'error' && mainWindow) {
		await dialog.showMessageBox(mainWindow, { type: 'warning', title: 'Could not check for updates', message: result.message });
	}
	return result;
}

function sendToRenderer(channel, value) {
	if (!mainWindow || mainWindow.isDestroyed()) return false;
	mainWindow.webContents.send(channel, value);
	return true;
}

function publishWindowState() {
	return onWindowStateChanged({
		windowFor: () => mainWindow,
		send: (state) => sendToRenderer(IPC.windowStateChanged, state),
	});
}

function runCurrentWindowAction(action) {
	return runWindowAction(action, {
		windowFor: () => mainWindow,
		quit: () => app.quit(),
		development: !app.isPackaged,
	});
}

function resourceRoots() {
	if (app.isPackaged) return { renderer: resolve(process.resourcesPath, 'renderer'), runtime: resolve(process.resourcesPath, 'runtime') };
	const stagedRoot = resolve(process.cwd(), '.desktop-build');
	const renderer = resolve(stagedRoot, 'renderer');
	if (!existsSync(renderer)) throw new Error(`Desktop renderer is not staged at ${renderer}`);
	return { renderer, runtime: resolve(stagedRoot, 'runtime') };
}

function opaqueId(value, length) {
	const id = String(value || '');
	if (id.length !== length || !/^[a-f0-9]+$/u.test(id)) throw new TypeError('Invalid opaque identifier');
	return id;
}

function cleanError(error) {
	return String(error?.message || 'Unknown error').replace(/[\r\n]/gu, ' ').slice(0, 300);
}

function projectLibrarySmokeEvidence(projectId) {
	if (!projectLibraryRuntime) throw new Error('Desktop project library is unavailable');
	return projectLibraryRuntime.smokeEvidence(projectId);
}

async function closeProjectLibraryHost() {
	const startup = projectLibraryStartup;
	if (startup) await startup.catch(() => undefined);
	const registration = projectLibraryIpc;
	await registration?.dispose();
	if (projectLibraryIpc === registration) projectLibraryIpc = null;
	const runtime = projectLibraryRuntime;
	await runtime?.close();
	if (projectLibraryRuntime === runtime) projectLibraryRuntime = null;
}

function exitApplication(code) {
	return applicationShutdown.requestExit(code);
}
