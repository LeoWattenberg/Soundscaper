/* SPDX-License-Identifier: AGPL-3.0-only */

import { constants as fsConstants } from 'node:fs';
import { access as nodeAccess, mkdir as nodeMkdir } from 'node:fs/promises';
import { isAbsolute, resolve, win32 } from 'node:path';

/** Compose main-owned FFmpeg preferences without loading any FFmpeg library. */
export async function registerExternalFfmpegPreferences(options) {
	validateOptions(options);
	const modules = await (options.loadModules ?? loadRuntimeModules)();
	validateModules(modules);
	const workingDirectory = resolve(options.userDataPath, 'external-ffmpeg');
	await (options.mkdir ?? nodeMkdir)(workingDirectory, { recursive: true, mode: 0o700 });
	const installerRunner = modules.createExternalFfmpegInstallerNodeRunner();
	const installer = modules.createExternalFfmpegInstallerBroker({
		runner: installerRunner, cwd: workingDirectory, environment: options.environment,
	});
	const probe = modules.createExternalFfmpegPreferenceNodeProbe({
		platform: options.platform, architecture: options.architecture,
		workingDirectory, environment: options.environment,
	});
	const abort = new AbortController();
	const plannedInstall = modules.planExternalFfmpegInstall({
		platform: options.platform, architecture: options.architecture,
		...(options.platform === 'win32'
			? { packageManagerExecutable: windowsPackageManagerExecutable(options.environment) }
			: {}),
	});
	const installPlan = await admittedInstallPlan(
		plannedInstall, options.platform,
		options.packageManagerExecutableAvailable ?? packageManagerExecutableAvailable,
	);
	const plan = () => installPlan;
	const service = modules.createExternalFfmpegPreferenceService({
		settings: options.settings,
		choose: () => chooseExecutable(options),
		probe,
		plan,
		confirm: (candidate) => confirmInstall(options, candidate),
		install: (candidate) => installer.install({
			plan: candidate, confirmed: true, signal: abort.signal,
		}),
	});
	if (options.settings.snapshot().externalFfmpegSelection !== null) {
		await service.rescan();
	}
	const ipc = modules.registerExternalFfmpegPreferenceMainIpc({
		channels: options.channels, handle: options.handle,
		removeHandler: options.removeHandler, service,
	});
	let disposed = false;
	return Object.freeze({
		service,
		dispose() {
			if (disposed) return;
			disposed = true;
			abort.abort(new Error('The desktop FFmpeg preference service stopped.'));
			ipc.dispose();
		},
	});
}

function windowsPackageManagerExecutable(environment) {
	const localAppData = environment.LOCALAPPDATA;
	if (typeof localAppData !== 'string' || localAppData.length < 1
		|| localAppData.length > 4_096 || localAppData.includes('\0')
		|| !win32.isAbsolute(localAppData)) return undefined;
	return win32.join(localAppData, 'Microsoft', 'WindowsApps', 'winget.exe');
}

async function admittedInstallPlan(result, platform, available) {
	if (result.status !== 'planned') return result;
	let executableAvailable;
	try { executableAvailable = await available(result.plan.executable, platform) === true; }
	catch { executableAvailable = false; }
	return executableAvailable ? result : Object.freeze({
		status: 'unsupported', reason: 'package-manager-unresolved',
		detail: `${result.plan.source === 'winget' ? 'WinGet' : 'Homebrew'} is not installed at its trusted executable location.`,
	});
}

async function packageManagerExecutableAvailable(path, platform) {
	try {
		await nodeAccess(path, platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK);
		return true;
	} catch { return false; }
}

async function chooseExecutable(options) {
	const result = await options.dialog.showOpenDialog(options.windowFor(), {
		title: 'Choose external FFmpeg',
		properties: ['openFile'],
		filters: options.platform === 'win32'
			? [{ name: 'FFmpeg executable', extensions: ['exe'] }]
			: [],
	});
	if (!result || result.canceled === true) return null;
	if (!Array.isArray(result.filePaths) || result.filePaths.length !== 1
		|| typeof result.filePaths[0] !== 'string') {
		throw new TypeError('The FFmpeg file selection result is invalid.');
	}
	return result.filePaths[0];
}

async function confirmInstall(options, plan) {
	const result = await options.dialog.showMessageBox(options.windowFor(), {
		type: 'warning', title: 'Install external FFmpeg?',
		message: `Install ${plan.packageName} with ${plan.source === 'winget' ? 'WinGet' : 'Homebrew'}?`,
		detail: plan.disclosure,
		buttons: ['Cancel', 'Install'], defaultId: 0, cancelId: 0, noLink: true,
	});
	return result?.response === 1;
}

async function loadRuntimeModules() {
	const [installer, installerNode, ipc, nodeProbe, preference] = await Promise.all([
		import('./project-library-runtime/desktop/external-ffmpeg-installer.js'),
		import('./project-library-runtime/desktop/external-ffmpeg-installer-node-runtime.js'),
		import('./project-library-runtime/desktop/external-ffmpeg-preference-main-ipc.js'),
		import('./project-library-runtime/desktop/external-ffmpeg-preference-node-probe.js'),
		import('./project-library-runtime/desktop/external-ffmpeg-preference-service.js'),
	]);
	return Object.freeze({
		createExternalFfmpegInstallerBroker: installer.createExternalFfmpegInstallerBroker,
		createExternalFfmpegInstallerNodeRunner: installerNode.createExternalFfmpegInstallerNodeRunner,
		createExternalFfmpegPreferenceNodeProbe: nodeProbe.createExternalFfmpegPreferenceNodeProbe,
		createExternalFfmpegPreferenceService: preference.createExternalFfmpegPreferenceService,
		planExternalFfmpegInstall: installer.planExternalFfmpegInstall,
		registerExternalFfmpegPreferenceMainIpc: ipc.registerExternalFfmpegPreferenceMainIpc,
	});
}

const MODULE_METHODS = Object.freeze([
	'createExternalFfmpegInstallerBroker', 'createExternalFfmpegInstallerNodeRunner',
	'createExternalFfmpegPreferenceNodeProbe', 'createExternalFfmpegPreferenceService',
	'planExternalFfmpegInstall', 'registerExternalFfmpegPreferenceMainIpc',
]);

function validateOptions(options) {
	if (!options || typeof options !== 'object' || !options.settings || !options.channels
		|| !options.dialog || typeof options.dialog.showOpenDialog !== 'function'
		|| typeof options.dialog.showMessageBox !== 'function'
		|| typeof options.windowFor !== 'function' || typeof options.handle !== 'function'
		|| typeof options.removeHandler !== 'function'
		|| typeof options.userDataPath !== 'string' || options.userDataPath.length > 4_096
		|| options.userDataPath.includes('\0') || !isAbsolute(options.userDataPath)
		|| typeof options.platform !== 'string' || typeof options.architecture !== 'string'
		|| !options.environment || typeof options.environment !== 'object'
		|| options.packageManagerExecutableAvailable !== undefined
			&& typeof options.packageManagerExecutableAvailable !== 'function'
		|| options.loadModules !== undefined && typeof options.loadModules !== 'function'
		|| options.mkdir !== undefined && typeof options.mkdir !== 'function') {
		throw new TypeError('External FFmpeg desktop registration ports are invalid.');
	}
}

function validateModules(modules) {
	if (!modules || typeof modules !== 'object'
		|| MODULE_METHODS.some((method) => typeof modules[method] !== 'function')) {
		throw new TypeError('External FFmpeg desktop runtime modules are invalid.');
	}
}
