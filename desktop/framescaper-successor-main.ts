/* SPDX-License-Identifier: AGPL-3.0-only */
import { createMotionscaperNativeEncoder } from './motionscaper-native-executor.ts';
import { createMotionscaperDeliveryAuthority } from './motionscaper-delivery-authority.ts';
import { dispatchFramescaperSuccessorDeliveryCall } from './framescaper-successor-delivery-ipc.ts';
import { FRAMESCAPER_SUCCESSOR_DELIVERY_CHANNEL } from '../src/framescaper/editor-successor-native-delivery-contract.ts';
import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, session } from 'electron';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { FRAMESCAPER_SUCCESSOR_DESKTOP as identity, normalizeFramescaperSuccessorDesktopMetadata, framescaperSuccessorDesktopDocumentUrl, framescaperSuccessorDesktopEnvironment } from './framescaper-successor-contract.ts';
import { createIsolatedRendererProtocolHandler } from './isolated-renderer-protocol.ts';
import { createTrustedDesktopIpc } from './main-trusted-ipc.ts';
import { registerMotionSavedFileIpc } from './motion-saved-file-ipc.ts';
app.setName(identity.name);
if (!app.commandLine.getSwitchValue('user-data-dir')) app.setPath('userData', join(app.getPath('appData'), identity.userDataDirectory));
app.setAppUserModelId(identity.appId);
protocol.registerSchemesAsPrivileged([{ scheme: identity.scheme, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, codeCache: true } }]);
let window: BrowserWindow | null = null, owner: object = {}, quitting = false;
let delivery: ReturnType<typeof createMotionscaperDeliveryAuthority> | null = null;
let files: ReturnType<typeof registerMotionSavedFileIpc> | null = null;
if (!app.requestSingleInstanceLock()) app.quit();
else {
	app.on('second-instance', () => { window?.show(); window?.focus(); });
	app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
	app.on('activate', () => { if (!window && files) void createWindow().catch(failStartup); });
	app.on('before-quit', event => {
		if (quitting) return; event.preventDefault(); quitting = true;
		void (async () => { try { await disposeAuthorities(); app.quit(); } catch (error) { failStartup(error); } })();
	});
	void start().catch(failStartup);
}
async function start(): Promise<void> {
	const metadata = normalizeFramescaperSuccessorDesktopMetadata(JSON.parse(await readFile(new URL('./product.json', import.meta.url), 'utf8')));
	if (process.env.SCAPE_PRODUCT && process.env.SCAPE_PRODUCT !== 'framescaper'
		|| process.env.SCAPE_FRAMESCAPER_LINE && process.env.SCAPE_FRAMESCAPER_LINE !== 'successor'
		|| process.env.SCAPE_FRAMESCAPER_DESKTOP_PROFILE && process.env.SCAPE_FRAMESCAPER_DESKTOP_PROFILE !== identity.profile
		|| app.isPackaged && app.getVersion() !== metadata.applicationVersion) throw new Error('Framescaper successor package identity does not match its declared development line.');
	await app.whenReady(); const desktopSession = session.fromPartition(identity.partition);
	desktopSession.setPermissionCheckHandler(() => false); desktopSession.setPermissionRequestHandler((_contents, _permission, callback) => { callback(false); });
	const renderer = app.isPackaged ? join(process.resourcesPath, 'renderer') : resolve(import.meta.dirname, '../../renderer');
	await desktopSession.protocol.handle(identity.scheme, createIsolatedRendererProtocolHandler(renderer, identity.scheme));
	const { handle } = createTrustedDesktopIpc({ ipcMain, windowFor: () => window, assertDocumentUrl: url => { if (!framescaperSuccessorDesktopDocumentUrl(url)) throw new Error('Untrusted Framescaper successor document.'); } });
	const payload: unknown = JSON.parse(await readFile(new URL('./native-payload.json', import.meta.url), 'utf8'));
	const encoder = await createMotionscaperNativeEncoder(app.isPackaged ? process.resourcesPath : resolve(import.meta.dirname, '../..'), payload);
	delivery = createMotionscaperDeliveryAuthority({ encoder, chooseOutput: async suggestedName => {
		const selectedOwner = owner; const selectedWindow = window; if (!selectedWindow) throw new Error('No active successor document.');
		const selection = await dialog.showSaveDialog(selectedWindow, { title: 'Export Frame sequence as ProRes 4444', defaultPath: suggestedName, filters: [{ name: 'QuickTime movie', extensions: ['mov'] }] });
		if (selectedOwner !== owner || selectedWindow !== window || selectedWindow.isDestroyed()) throw new Error('Frame sequence destination selection lost its document.');
		return selection.canceled ? null : selection.filePath ?? null;
	} });
	const nativeDelivery = delivery;
	handle(FRAMESCAPER_SUCCESSOR_DELIVERY_CHANNEL, (_event, method, payload) => dispatchFramescaperSuccessorDeliveryCall(nativeDelivery, method, payload));
	handle(identity.environmentChannel, () => framescaperSuccessorDesktopEnvironment(metadata.applicationVersion, process.platform, encoder !== null));
	files = registerMotionSavedFileIpc({ productId: 'framescaper', framescaperLine: 'successor', handle,
		removeHandler: channel => ipcMain.removeHandler(channel), ownerFor: () => owner, isOwnerCurrent: value => value === owner && !!window && !window.isDestroyed(),
		chooseFile: async () => {
			if (!window) throw new Error('No active Framescaper successor window.');
			const selection = await dialog.showOpenDialog(window, { title: 'Connect saved Motionscaper composition', properties: ['openFile'], filters: [{ name: 'Motionscaper project', extensions: ['mscape'] }] });
			return selection.canceled ? null : selection.filePaths[0] ?? null;
		},
	});
	Menu.setApplicationMenu(Menu.buildFromTemplate([...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []), { label: 'File', submenu: [{ role: 'close' }] }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }]));
	await createWindow();
}
async function releaseAuthorities(actions: readonly Promise<unknown>[]): Promise<void> {
	const results = await Promise.allSettled(actions); const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
	if (failures.length) throw new AggregateError(failures, 'Successor native authority cleanup failed.');
}
async function disposeAuthorities(): Promise<void> { await releaseAuthorities([Promise.resolve(files?.dispose()), Promise.resolve(delivery?.dispose())]); }
async function revokeOwner(): Promise<void> { const previous = owner; owner = {}; await releaseAuthorities([Promise.resolve(files?.revokeOwner(previous)), Promise.resolve(delivery?.abortActive())]); }
async function createWindow(): Promise<void> {
	const target = new BrowserWindow({ title: identity.name, width: 1280, height: 800, minWidth: 720, minHeight: 480,
		webPreferences: { preload: join(import.meta.dirname, 'preload.cjs'), partition: identity.partition, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, allowRunningInsecureContent: false } });
	window = target;
	target.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
	target.webContents.on('will-navigate', (event, url) => { if (!framescaperSuccessorDesktopDocumentUrl(url)) event.preventDefault(); });
	target.webContents.on('will-attach-webview', event => { event.preventDefault(); });
	target.webContents.on('did-start-navigation', details => { if (details.isMainFrame && !details.isSameDocument) void revokeOwner().catch(failStartup); });
	target.webContents.on('render-process-gone', () => { void revokeOwner().catch(failStartup); });
	target.on('closed', () => { if (window === target) window = null; void revokeOwner().catch(failStartup); });
	await target.loadURL(`${identity.origin}/`);
	if (process.argv.includes('--framescaper-successor-shell-smoke')) {
		const { smokeFramescaperSuccessorShell } = await import('./framescaper-successor-smoke.ts');
		const evidence = await smokeFramescaperSuccessorShell(target); await disposeAuthorities();
		console.log(`FRAMESCAPER_SUCCESSOR_SHELL_SMOKE ${JSON.stringify({ ...evidence, arch: process.arch })}`); app.exit(0);
	}
}
function failStartup(error: unknown): void {
	if (process.argv.includes('--framescaper-successor-shell-smoke')) console.error(error);
	else dialog.showErrorBox('Framescaper Development could not start', error instanceof Error ? error.message : 'Desktop startup failed.'); app.exit(1);
}
