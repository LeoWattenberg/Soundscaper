/* SPDX-License-Identifier: AGPL-3.0-only */

import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, session, shell } from 'electron';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
	MOTIONSCAPER_DESKTOP as identity, MOTIONSCAPER_DESKTOP_CHANNELS as channels,
	motionscaperDesktopDocumentUrl, motionscaperDesktopEnvironment,
} from './motionscaper-desktop-contract.ts';
import { MOTIONSCAPER_FILE_METHODS } from '../src/motionscaper/desktop-file-contract.ts';
import { createMotionscaperFileAuthority } from './motionscaper-file-authority.ts';
import { dispatchMotionscaperFileCall } from './motionscaper-file-ipc.ts';
import { createMotionscaperNativeEncoder } from './motionscaper-native-executor.ts';
import { createMotionscaperDeliveryAuthority } from './motionscaper-delivery-authority.ts';
import { dispatchMotionscaperDeliveryCall } from './motionscaper-delivery-ipc.ts';
import { createMotionscaperProtocolHandler } from './motionscaper-protocol.ts';
import { dispatchMotionscaperDocumentation } from './motionscaper-documentation.ts';

interface ProductMetadata {
	readonly schemaVersion: 1;
	readonly id: 'motionscaper';
	readonly applicationVersion: string;
	readonly updateTagPrefix: 'motionscaper-v';
}

app.setName(identity.name);
if (!app.commandLine.getSwitchValue('user-data-dir')) {
	app.setPath('userData', join(app.getPath('appData'), identity.name));
}
app.setAppUserModelId(identity.appId);
protocol.registerSchemesAsPrivileged([{
	scheme: identity.scheme,
	privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, codeCache: true },
}]);
let window: BrowserWindow | null = null;
let nativeSmoke: unknown = null;
let abortNativeDelivery: () => Promise<void> = () => Promise.resolve();
if (!app.requestSingleInstanceLock()) app.quit();
else {
	app.on('second-instance', () => { window?.show(); window?.focus(); });
	app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
	app.on('activate', () => { if (!window) void createWindow().catch(failStartup); });
	void start().catch(failStartup);
}

async function start(): Promise<void> {
	const metadata: unknown = JSON.parse(await readFile(new URL('./product.json', import.meta.url), 'utf8'));
	if (!isMetadata(metadata) || process.env.SCAPE_PRODUCT && process.env.SCAPE_PRODUCT !== identity.productId
		|| app.isPackaged && app.getVersion() !== metadata.applicationVersion) {
		throw new Error('Motionscaper desktop package identity does not match its declared release.');
	}
	await app.whenReady();
	const desktopSession = session.fromPartition(identity.partition);
	desktopSession.setPermissionCheckHandler(() => false);
	desktopSession.setPermissionRequestHandler((_contents, _permission, callback) => { callback(false); });
	const rendererRoot = app.isPackaged ? join(process.resourcesPath, 'renderer')
		: resolve(import.meta.dirname, '../../renderer');
	const nativeMetadata: unknown = JSON.parse(await readFile(new URL('./native-payload.json', import.meta.url), 'utf8'));
	const nativeEncoder = await createMotionscaperNativeEncoder(app.isPackaged ? process.resourcesPath : resolve(import.meta.dirname, '../..'), nativeMetadata);
	if (nativeEncoder && process.argv.includes('--motionscaper-shell-smoke')) {
		const { smokeMotionscaperNativeDelivery } = await import('./motionscaper-native-smoke.ts');
		nativeSmoke = await smokeMotionscaperNativeDelivery(nativeEncoder);
	}
	await desktopSession.protocol.handle(identity.scheme, createMotionscaperProtocolHandler(rendererRoot));
	ipcMain.handle(channels.environment, (event: Electron.IpcMainInvokeEvent) => {
		if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame
			|| !motionscaperDesktopDocumentUrl(event.senderFrame.url)) throw new Error('Untrusted Motionscaper caller.');
		return motionscaperDesktopEnvironment(metadata.applicationVersion, process.platform, nativeEncoder !== null);
	});
	ipcMain.handle(channels.documentation, (event: Electron.IpcMainInvokeEvent, request: unknown) => dispatchMotionscaperDocumentation({
		ownWindow: window !== null && event.sender === window.webContents,
		mainFrame: window !== null && event.senderFrame === window.webContents.mainFrame,
		url: event.senderFrame?.url ?? '',
	}, request, url => shell.openExternal(url)));
	const files = createMotionscaperFileAuthority({
		chooseOpen: async () => {
			if (!window) throw new Error('Motionscaper has no active document window.');
			const selection = await dialog.showOpenDialog(window, { title: 'Open Motionscaper project', properties: ['openFile'], filters: [{ name: 'Scape project', extensions: ['mscape', 'scape', 'fscape', 'sscape'] }] });
			return selection.canceled ? null : selection.filePaths[0] ?? null;
		},
		chooseSave: async ({ suggestedName, defaultPath }) => {
			if (!window) throw new Error('Motionscaper has no active document window.');
			const selection = await dialog.showSaveDialog(window, { title: 'Save Motionscaper project', defaultPath: defaultPath ?? suggestedName, filters: [{ name: 'Motionscaper project', extensions: ['mscape'] }] });
			return selection.canceled ? null : selection.filePath ?? null;
		},
	});
	ipcMain.handle(channels.projectFiles, (event: Electron.IpcMainInvokeEvent, method: unknown, request: unknown) => {
		if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame
			|| !motionscaperDesktopDocumentUrl(event.senderFrame.url)) throw new Error('Untrusted Motionscaper file caller.');
		return dispatchMotionscaperFileCall(files, method, request);
	});
	const delivery = createMotionscaperDeliveryAuthority({ encoder: nativeEncoder, chooseOutput: async (suggestedName) => {
		if (!window) throw new Error('Motionscaper has no active document window.');
		const selection = await dialog.showSaveDialog(window, { title: 'Export ProRes 4444', defaultPath: suggestedName, filters: [{ name: 'QuickTime movie', extensions: ['mov'] }] });
		return selection.canceled ? null : selection.filePath ?? null;
	} });
	abortNativeDelivery = () => delivery.abortActive();
	ipcMain.handle(channels.delivery, (event: Electron.IpcMainInvokeEvent, method: unknown, request: unknown) => {
		if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame
			|| !motionscaperDesktopDocumentUrl(event.senderFrame.url)) throw new Error('Untrusted Motionscaper delivery caller.');
		return dispatchMotionscaperDeliveryCall(delivery, method, request);
	});
	app.on('before-quit', () => { void Promise.all([files.dispose(), delivery.dispose()]).catch((error: unknown) => { console.error(error); }); });
	Menu.setApplicationMenu(Menu.buildFromTemplate([
		...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
		{ label: 'File', submenu: [{ role: 'close' }] },
		{ role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
	]));
	await createWindow();
}

async function createWindow(): Promise<void> {
	window = new BrowserWindow({
		title: identity.name, width: 1280, height: 800, minWidth: 720, minHeight: 480,
		webPreferences: {
			preload: join(import.meta.dirname, 'preload.cjs'), partition: identity.partition,
			sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true,
			allowRunningInsecureContent: false,
		},
	});
	window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
	window.webContents.on('will-navigate', (event, url) => { if (!motionscaperDesktopDocumentUrl(url)) event.preventDefault(); });
	window.webContents.on('will-attach-webview', (event) => { event.preventDefault(); });
	window.on('closed', () => { window = null; void abortNativeDelivery().catch((error: unknown) => { console.error(error); }); });
	window.webContents.on('render-process-gone', () => { void abortNativeDelivery().catch((error: unknown) => { console.error(error); }); });
	await window.loadURL(`${identity.origin}/`);
	if (process.argv.includes('--motionscaper-shell-smoke')) await smokeShell(window);
}

function isMetadata(value: unknown): value is ProductMetadata {
	return !!value && typeof value === 'object' && 'schemaVersion' in value && value.schemaVersion === 1
		&& 'id' in value && value.id === identity.productId
		&& 'applicationVersion' in value && typeof value.applicationVersion === 'string'
		&& 'updateTagPrefix' in value && value.updateTagPrefix === identity.updateTagPrefix;
}

function failStartup(error: unknown): void {
	if (process.argv.includes('--motionscaper-shell-smoke')) console.error(error);
	else dialog.showErrorBox('Motionscaper could not start', error instanceof Error ? error.message : 'Desktop startup failed.');
	app.exit(1);
}

async function smokeShell(target: BrowserWindow): Promise<void> {
	const evidence: unknown = await target.webContents.executeJavaScript(`(async () => {
		const deadline = Date.now() + 30000;
		while (!document.querySelector('[data-motion-editor-bound="true"][data-product="motionscaper"]')) {
			if (Date.now() >= deadline) throw new Error('Motionscaper shell did not mount.');
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		const fileRejection = await window.scapeDesktop.v1.motionFiles.read({ token: 'unadmitted', offset: 0, length: 1 }).then(() => '', (error) => String(error));
		const deliveryRejection = await window.scapeDesktop.v1.motionDelivery.cancel({ token: 'unadmitted' }).then(() => '', (error) => String(error));
		return { fileRejection, deliveryRejection, deliveryProfile: await window.scapeDesktop.v1.motionDelivery.getProfile(), environment: await window.scapeDesktop.v1.getEnvironment(),
			foreignBridge: !!(window.soundscaperDesktop || window.framescaperDesktop),
			fileBridge: ${JSON.stringify(MOTIONSCAPER_FILE_METHODS)}.every((method) => typeof window.scapeDesktop.v1.motionFiles[method] === 'function'),
			origin: location.protocol + '//' + location.host };
	})()`);
	if (!evidence || typeof evidence !== 'object' || !('foreignBridge' in evidence)
		|| evidence.foreignBridge !== false || !('fileRejection' in evidence) || !String(evidence.fileRejection).includes('read capability') || !('fileBridge' in evidence) || evidence.fileBridge !== true || !('origin' in evidence) || evidence.origin !== identity.origin) {
		throw new Error('Motionscaper shell native isolation smoke failed.');
	}
	console.log(`MOTIONSCAPER_SHELL_SMOKE ${JSON.stringify({ ...evidence, nativeSmoke, arch: process.arch })}`);
	app.exit(0);
}
