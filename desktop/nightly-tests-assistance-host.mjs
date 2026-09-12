/* SPDX-License-Identifier: AGPL-3.0-only */

import { access, mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { resolvePackagedProductExecutable } from '../scripts/lib/desktop-nightly-tests-packaged-runtime.mjs';

export const NIGHTLY_ASSISTANCE_HOST_FLAG = '--soundscaper-nightly-assistance-host';

export function resolveNightlyAssistanceHostPlan({ argv, environment, platform = process.platform, arch = process.arch }) {
	if (!argv.includes(NIGHTLY_ASSISTANCE_HOST_FLAG) || environment.SOUNDSCAPER_LOCAL_ASSISTANCE_REAL_MODELS !== '1') {
		throw new Error('The real assistance host requires the explicit nightly model test mode.');
	}
	if (readArgument(argv, '--remote-debugging-address=') !== '127.0.0.1') {
		throw new Error('The nightly assistance debugger must bind only to 127.0.0.1.');
	}
	const port = Number(readArgument(argv, '--remote-debugging-port='));
	if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('The nightly assistance debugger port is invalid.');
	const profile = absolute(readArgument(argv, '--user-data-dir='), 'Nightly assistance profile');
	const modelCache = absolute(environment.SOUNDSCAPER_LOCAL_ASSISTANCE_MODEL_CACHE, 'Nightly assistance model cache');
	const productId = environment.SOUNDSCAPER_LOCAL_ASSISTANCE_PRODUCT_ID;
	const productRoot = absolute(environment.SOUNDSCAPER_PACKAGED_PRODUCT_ROOT, 'Packaged product root');
	const executable = resolvePackagedProductExecutable({
		productRoot,
		productId, platform, arch,
	});
	const resources = platform === 'darwin'
		? resolve(dirname(executable), '../Resources') : join(dirname(executable), 'resources');
	// electron-builder can only embed integrity metadata for an ASAR at the
	// root of a directory-valued extraResource. The product packager places this
	// host-only copy there while the product executable keeps its original ASAR.
	const productApp = join(productRoot, `${productId}.asar`);
	return Object.freeze({ productId, profile, modelCache, productApp, runtimeRoot: join(resources, 'runtime'),
		preload: join(productApp, 'desktop/preload.mjs'),
		document: join(import.meta.dirname, 'nightly-tests-assistance.html') });
}

/** This host is packaged only in the diagnostic launcher, never in either editor. */
export async function startNightlyAssistanceHost({ app, BrowserWindow, ipcMain }, dependencies = {}) {
	const plan = resolveNightlyAssistanceHostPlan({
		argv: dependencies.argv ?? process.argv, environment: dependencies.environment ?? process.env,
	});
	const verifyFile = dependencies.access ?? access;
	// Electron treats an archive root as its virtual directory, whose empty entry
	// cannot be passed to fs.access. Check readability through its preload entry.
	await verifyFile(plan.preload);
	await (dependencies.mkdir ?? mkdir)(plan.profile, { recursive: true, mode: 0o700 });
	app.setPath('userData', plan.profile);
	await app.whenReady();
	const { registerAssistance, IPC } = await (dependencies.loadProductModules ?? loadProductModules)(plan.productApp);
	const window = new BrowserWindow({
		width: 960, height: 640, show: false,
		webPreferences: {
			preload: plan.preload,
			additionalArguments: [`--soundscaper-product=${plan.productId}`],
			nodeIntegration: false, contextIsolation: true, sandbox: true,
			webSecurity: true, allowRunningInsecureContent: false, webviewTag: false,
			backgroundThrottling: false,
		},
	});
	const documentUrl = pathToFileURL(plan.document).href;
	const assertSender = (event) => {
		if (event.sender !== window.webContents || !event.senderFrame
			|| event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== documentUrl) {
			throw new Error('The assistance diagnostic IPC sender is not its active local test document.');
		}
	};
	const handled = [];
	const listeners = [];
	const handle = (channel, listener) => {
		handled.push(channel);
		ipcMain.handle(channel, (event, ...args) => { assertSender(event); return listener(event, ...args); });
	};
	const on = (channel, listener) => {
		const guarded = (event, ...args) => { assertSender(event); return listener(event, ...args); };
		listeners.push([channel, guarded]);
		ipcMain.on(channel, guarded);
	};
	window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
	window.webContents.on('will-navigate', (event, url) => { if (url !== documentUrl) event.preventDefault(); });
	window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
	let modelsDirectory = plan.modelCache;
	const assistance = registerAssistance({
		channels: IPC, handle, on, app, runtimeRoot: plan.runtimeRoot,
		sendToRenderer: (channel, payload) => {
			if (!window.isDestroyed()) window.webContents.send(channel, payload);
		},
		settings: { snapshot: () => ({ modelsDirectory }), setModelsDirectory: (value) => { modelsDirectory = value; } },
		windowFor: () => window,
		// The tester explicitly launched this download/inference diagnostic. Only
		// native consent UI is supplied here; model data, IPC, and inference are real.
		dialog: {
			showMessageBox: async (...args) => {
				const options = args.at(-1);
				if (options?.title !== 'Local Assistance consent') throw new Error('Unexpected diagnostic dialog.');
				return { response: 0 };
			},
			showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
		},
		// The model suite stages its own audio and frame packs; it never provisions
		// or invokes the unrelated optional system FFmpeg installation.
		externalFfmpegPreferences: { admission: () => null, invalidateAdmission: () => undefined },
	});
	let disposed = false;
	const dispose = async () => {
		if (disposed) return;
		disposed = true;
		await assistance.dispose();
		for (const channel of handled) ipcMain.removeHandler(channel);
		for (const [channel, listener] of listeners) ipcMain.removeListener(channel, listener);
	};
	window.on('closed', () => { void dispose().then(() => app.exit(0), (error) => { console.error(error); app.exit(2); }); });
	await window.loadFile(plan.document);
	return Object.freeze({ window, dispose, plan });
}

async function loadProductModules(productApp) {
	const [registration, constants] = await Promise.all([
		import(pathToFileURL(join(productApp, 'desktop/assistance-registration.mjs')).href),
		import(pathToFileURL(join(productApp, 'desktop/constants.js')).href),
	]);
	return { registerAssistance: registration.registerAssistance, IPC: constants.IPC };
}

function readArgument(argv, prefix) {
	const values = argv.filter((argument) => argument.startsWith(prefix));
	if (values.length !== 1) throw new Error(`Nightly assistance requires exactly one ${prefix} argument.`);
	return values[0].slice(prefix.length);
}

function absolute(value, label) {
	if (typeof value !== 'string' || !isAbsolute(value)) throw new TypeError(`${label} must be an absolute path.`);
	return resolve(value);
}
