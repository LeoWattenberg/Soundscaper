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
	EDITOR_PATH_PREFIX,
	EXTERNAL_DESTINATIONS,
	IPC,
	SESSION_PARTITION,
	SUPPORTED_LOCALES,
	UPDATE_TAG_PREFIX,
} from './constants.js';
import { ReadCapabilityStore } from './file-capabilities.js';
import { extractProjectPaths } from './file-associations.js';
import { acceptsSystemAudioRequest, selectSystemAudioStreams } from './display-capture.js';
import { createProtocolHandler, registerAppScheme } from './protocol.js';
import { AtomicSaveManager, SaveTargetStore } from './save-targets.js';
import { DesktopSettingsStore } from './settings.js';
import { ReleaseChecker } from './update-check.js';
import {
	acceptsFile,
	assertEditorDocumentUrl,
	isAppUrl,
	isEditorDocumentUrl,
	validateFileChoice,
	validateLocale,
	validateSaveChoice,
} from './validation.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pendingOpenPaths = [];
const readCapabilities = new ReadCapabilityStore();
const saveTargets = new SaveTargetStore();
const saves = new AtomicSaveManager({ targets: saveTargets });

let mainWindow = null;
let settings = null;
let releaseChecker = null;
let rendererReady = false;
let pendingClose = null;
let allowNextClose = false;
let applicationIsQuitting = false;

app.setName(APP_NAME);
app.enableSandbox();
registerAppScheme(protocol);

app.on('open-file', (event, filePath) => {
	event.preventDefault();
	enqueueProjectPath(filePath);
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
	void startApplication().catch((error) => {
		console.error('Soundscaper desktop failed to start:', cleanError(error));
		app.exit(1);
	});
}

async function startApplication() {
	await app.whenReady();
	if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
	const resources = resourceRoots();
	settings = new DesktopSettingsStore(resolve(app.getPath('userData'), 'desktop-settings.json'));
	await settings.load([app.getLocale(), ...app.getPreferredSystemLanguages()]);
	releaseChecker = new ReleaseChecker({ currentVersion: app.getVersion(), settings, tagPrefix: UPDATE_TAG_PREFIX });

	const desktopSession = session.fromPartition(SESSION_PARTITION);
	await desktopSession.protocol.handle(APP_SCHEME, createProtocolHandler({
		rendererRoot: resources.renderer,
		runtimeRoot: resources.runtime,
		readCapabilities,
	}));
	configureSessionSecurity(desktopSession);
	registerIpcHandlers();
	installMenu();
	await createWindow();
	void checkForUpdates(false);

	app.on('activate', () => {
		if (!BrowserWindow.getAllWindows().length) void createWindow();
	});
	app.on('before-quit', () => { applicationIsQuitting = true; });
	app.on('window-all-closed', () => {
		if (process.platform !== 'darwin') app.quit();
	});
	app.on('will-quit', () => {
		void readCapabilities.dispose();
		void saves.dispose();
	});
}

async function createWindow() {
	if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
	rendererReady = false;
	pendingClose = null;
	allowNextClose = false;
	const locale = settings.snapshot().locale;
	mainWindow = new BrowserWindow({
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
	lockNavigation(mainWindow);
	installArtifactSmokeProbe(mainWindow);
	mainWindow.once('ready-to-show', () => mainWindow?.show());
	mainWindow.on('enter-full-screen', () => sendToRenderer(IPC.fullscreenChanged, { fullscreen: true }));
	mainWindow.on('leave-full-screen', () => sendToRenderer(IPC.fullscreenChanged, { fullscreen: false }));
	mainWindow.on('close', (event) => {
		if (allowNextClose || !rendererReady) return;
		event.preventDefault();
		if (pendingClose) return;
		pendingClose = { requestId: randomUUID(), reason: applicationIsQuitting ? 'quit' : 'window-close' };
		sendToRenderer(IPC.closeRequested, pendingClose);
	});
	mainWindow.on('closed', () => {
		mainWindow = null;
		rendererReady = false;
		pendingClose = null;
	});
	await mainWindow.loadURL(`${APP_ORIGIN}${EDITOR_PATH_PREFIX}/embed/${encodeURIComponent(locale)}/`);
	return mainWindow;
}

function registerIpcHandlers() {
	handle(IPC.environment, () => ({
		platform: process.platform,
		arch: process.arch,
		version: app.getVersion(),
		locale: settings.snapshot().locale,
		supportedLocales: [...SUPPORTED_LOCALES],
		capabilities: { displayAudio: process.platform === 'win32', updates: settings.snapshot().updatesEnabled },
	}));
	handle(IPC.chooseFiles, (_event, value) => chooseFiles(value));
	handle(IPC.releaseRead, (_event, id) => readCapabilities.release(opaqueId(id, 64)));
	handle(IPC.chooseSaveTarget, (_event, value) => chooseSaveTarget(value));
	handle(IPC.beginWrite, (_event, value) => saves.begin({ targetId: opaqueId(value?.targetId, 48), size: value?.size }));
	handle(IPC.writeChunk, (_event, value) => saves.writeChunk({ writeId: opaqueId(value?.writeId, 32), offset: value?.offset, bytes: value?.bytes }));
	handle(IPC.finishWrite, (_event, id) => saves.finish(opaqueId(id, 32)));
	handle(IPC.abortWrite, (_event, id) => saves.abort(opaqueId(id, 32)));
	handle(IPC.setLocale, async (_event, value) => {
		const locale = validateLocale(value);
		await settings.setLocale(locale);
		rendererReady = false;
		await mainWindow.loadURL(`${APP_ORIGIN}${EDITOR_PATH_PREFIX}/embed/${encodeURIComponent(locale)}/`);
		return locale;
	});
	handle(IPC.setFullscreen, (_event, enabled) => {
		mainWindow.setFullScreen(enabled === true);
		return mainWindow.isFullScreen();
	});
	handle(IPC.checkForUpdates, () => checkForUpdates(true));
	handle(IPC.openExternal, async (_event, destination) => {
		const url = EXTERNAL_DESTINATIONS[String(destination || '')];
		if (!url) throw new TypeError('Unsupported external destination');
		await shell.openExternal(url);
	});
	handle(IPC.editText, (_event, value) => {
		const command = String(value || '');
		if (!['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'].includes(command)) throw new TypeError('Unsupported text edit command');
		mainWindow.webContents[command]();
		return true;
	});
	on(IPC.rendererReady, () => {
		rendererReady = true;
		void dispatchPendingProjects();
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
	assertEditorDocumentUrl(event.senderFrame?.url || event.sender.getURL());
}

async function chooseFiles(value) {
	const choice = validateFileChoice(value);
	const result = await dialog.showOpenDialog(mainWindow, {
		title: choice.purpose === 'project' ? 'Import Audacity interchange' : 'Import files',
		properties: choice.multiple ? ['openFile', 'multiSelections'] : ['openFile'],
		filters: choice.filters,
	});
	if (result.canceled) return [];
	const descriptors = [];
	try {
		for (const filePath of result.filePaths) {
			if (!acceptsFile(choice.purpose, filePath)) throw new TypeError('The selected file type is not allowed');
			descriptors.push(await readCapabilities.registerPath(filePath));
		}
		return descriptors;
	} catch (error) {
		await Promise.all(descriptors.map((descriptor) => readCapabilities.release(descriptor.id)));
		throw error;
	}
}

async function chooseSaveTarget(value) {
	const choice = validateSaveChoice(value);
	const result = await dialog.showSaveDialog(mainWindow, {
		title: choice.purpose === 'project' ? 'Export Audacity interchange' : 'Export',
		defaultPath: choice.suggestedName,
		filters: choice.filters,
	});
	return result.canceled || !result.filePath ? null : saveTargets.registerPath(result.filePath);
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

async function dispatchPendingProjects() {
	while (rendererReady && pendingOpenPaths.length && mainWindow && !mainWindow.isDestroyed()) {
		const filePath = pendingOpenPaths.shift();
		try {
			sendToRenderer(IPC.openProject, await readCapabilities.registerPath(filePath));
		} catch (error) {
			void dialog.showMessageBox(mainWindow, {
				type: 'error',
				title: 'Could not open project',
				message: `${APP_NAME} could not read the selected project.`,
				detail: cleanError(error),
			});
		}
	}
}

function enqueueProjectPath(filePath) {
	if (!filePath || !['.aup4', '.scape'].includes(extname(filePath).toLowerCase())) return;
	const absolutePath = isAbsolute(filePath) ? filePath : resolve(filePath);
	if (!pendingOpenPaths.includes(absolutePath)) pendingOpenPaths.push(absolutePath);
	if (rendererReady) void dispatchPendingProjects();
}

function configureSessionSecurity(desktopSession) {
	desktopSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
		if (!isAppUrl(requestingOrigin || webContents?.getURL())) return false;
		if (permission === 'fullscreen') return true;
		if (permission === 'display-capture') return process.platform === 'win32';
		if (permission !== 'media') return false;
		const mediaTypes = details?.mediaTypes || [];
		return mediaTypes.length > 0 && mediaTypes.every((type) => type === 'audio');
	});
	desktopSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
		if (!isAppUrl(details?.requestingUrl || webContents?.getURL())) return callback(false);
		if (permission === 'fullscreen') return callback(true);
		if (permission === 'display-capture') return callback(process.platform === 'win32');
		if (permission !== 'media') return callback(false);
		const mediaTypes = details?.mediaTypes || [];
		callback(mediaTypes.length > 0 && mediaTypes.every((type) => type === 'audio'));
	});
	if (process.platform === 'win32') {
		desktopSession.setDisplayMediaRequestHandler((request, callback) => {
			if (!acceptsSystemAudioRequest(request)) return callback({});
			void desktopCapturer.getSources({
				types: ['screen'],
				thumbnailSize: { width: 0, height: 0 },
			}).then((sources) => callback(selectSystemAudioStreams(request, sources)))
				.catch(() => callback({}));
		});
	}
	desktopSession.on('will-download', (_event, item) => item.cancel());
}

function lockNavigation(window) {
	window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
	window.webContents.on('will-navigate', (event, url) => {
		if (!isEditorDocumentUrl(url)) event.preventDefault();
	});
	window.webContents.on('will-attach-webview', (event) => event.preventDefault());
}

function installArtifactSmokeProbe(window) {
	if (!process.argv.includes('--soundscaper-smoke')) return;
	const timeout = setTimeout(() => {
		console.error('SOUNDSCAPER_DESKTOP_SMOKE timed out');
		app.exit(2);
	}, 15_000);
	window.webContents.once('did-fail-load', (_event, code, description) => {
		clearTimeout(timeout);
		console.error(`SOUNDSCAPER_DESKTOP_SMOKE load failed: ${code} ${description}`);
		app.exit(2);
	});
	window.webContents.once('did-finish-load', async () => {
		try {
			const result = await window.webContents.executeJavaScript(`({
				url: location.href,
				title: document.title,
				bridge: Object.keys(window.soundscaperDesktop?.v1 || {}).sort(),
				hasEditor: Boolean(document.querySelector('main')),
				nodeExposed: typeof globalThis.process !== 'undefined' || typeof globalThis.require !== 'undefined',
			})`);
			const valid = result.url.startsWith(`${APP_ORIGIN}${EDITOR_PATH_PREFIX}/embed/`)
				&& result.title === APP_NAME
				&& result.hasEditor
				&& !result.nodeExposed
				&& result.bridge.includes('getEnvironment')
				&& result.bridge.includes('chooseFiles')
				&& result.bridge.includes('beginWrite')
				&& result.bridge.includes('respondToClose');
			console.log(`SOUNDSCAPER_DESKTOP_SMOKE ${JSON.stringify(result)}`);
			clearTimeout(timeout);
			app.exit(valid ? 0 : 2);
		} catch (error) {
			clearTimeout(timeout);
			console.error(`SOUNDSCAPER_DESKTOP_SMOKE failed: ${cleanError(error)}`);
			app.exit(2);
		}
	});
}

function installMenu() {
	const command = (id) => () => sendToRenderer(IPC.menuCommand, { command: id });
	const template = [
		...(process.platform === 'darwin' ? [{
			label: APP_NAME,
			submenu: [{ role: 'about' }, { type: 'separator' }, { label: 'Preferences', accelerator: 'CmdOrCtrl+,', click: command('preferences') }, { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }],
		}] : []),
		{
			label: 'File',
			submenu: [
				{ label: 'Import Audacity Interchange…', accelerator: 'CmdOrCtrl+O', click: command('project:open') },
				{ label: 'Save', accelerator: 'CmdOrCtrl+S', click: command('project:save') },
				{ label: 'Export Audacity Interchange As…', accelerator: 'CmdOrCtrl+Shift+S', click: command('project:save-as') },
				{ label: 'Export Audio…', accelerator: 'CmdOrCtrl+Shift+E', click: command('audio:export') },
				{ type: 'separator' },
				process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' },
			],
		},
		{
			label: 'Edit',
			submenu: [
				{ label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: command('edit:undo') },
				{ label: 'Redo', accelerator: process.platform === 'darwin' ? 'CmdOrCtrl+Shift+Z' : 'CmdOrCtrl+Y', click: command('edit:redo') },
				{ type: 'separator' },
				{ label: 'Cut', accelerator: 'CmdOrCtrl+X', click: command('edit:cut') },
				{ label: 'Copy', accelerator: 'CmdOrCtrl+C', click: command('edit:copy') },
				{ label: 'Paste', accelerator: 'CmdOrCtrl+V', click: command('edit:paste') },
				{ label: 'Select All', accelerator: 'CmdOrCtrl+A', click: command('edit:select-all') },
			],
		},
		{ label: 'View', submenu: [{ role: 'reload', visible: !app.isPackaged }, { role: 'toggleDevTools', visible: !app.isPackaged }, { type: 'separator', visible: !app.isPackaged }, { role: 'togglefullscreen' }] },
		{ label: 'Window', role: 'windowMenu' },
		{
			label: 'Help',
			submenu: [
				{ label: `${APP_NAME} Help`, click: () => void shell.openExternal(EXTERNAL_DESTINATIONS.help) },
				{ label: 'Check for Updates…', click: () => void checkForUpdates(true) },
				{ label: 'View Source', click: () => void shell.openExternal(EXTERNAL_DESTINATIONS.source) },
			],
		},
	];
	Menu.setApplicationMenu(Menu.buildFromTemplate(template));
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
	if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, value);
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
