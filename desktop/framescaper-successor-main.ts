/* SPDX-License-Identifier: AGPL-3.0-only */
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
let files: ReturnType<typeof registerMotionSavedFileIpc> | null = null;
if (!app.requestSingleInstanceLock()) app.quit();
else {
	app.on('second-instance', () => { window?.show(); window?.focus(); });
	app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
	app.on('activate', () => { if (!window && files) void createWindow().catch(failStartup); });
	app.on('before-quit', event => {
		if (quitting) return; event.preventDefault(); quitting = true;
		void (async () => { try { await files?.dispose(); app.quit(); } catch (error) { failStartup(error); } })();
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
	handle(identity.environmentChannel, () => framescaperSuccessorDesktopEnvironment(metadata.applicationVersion, process.platform));
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
async function revokeOwner(): Promise<void> { const previous = owner; owner = {}; await files?.revokeOwner(previous); }
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
		const evidence = await smokeFramescaperSuccessorShell(target); await files?.dispose();
		console.log(`FRAMESCAPER_SUCCESSOR_SHELL_SMOKE ${JSON.stringify({ ...evidence, arch: process.arch })}`); app.exit(0);
	}
}
function failStartup(error: unknown): void {
	if (process.argv.includes('--framescaper-successor-shell-smoke')) console.error(error);
	else dialog.showErrorBox('Framescaper Development could not start', error instanceof Error ? error.message : 'Desktop startup failed.'); app.exit(1);
}
