/* SPDX-License-Identifier: AGPL-3.0-only */

import { lstatSync, mkdirSync, readdirSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { configureDesktopBrowserCachesSync, migrateDesktopBrowserCaches } from './desktop-browser-cache.ts';
import { migrateDesktopProjectLibraries } from './desktop-project-library-migration.ts';
import { resolveDesktopProjectsDirectory } from './desktop-projects-directory.ts';
import { migrateDesktopStorageEntries } from './desktop-storage-migration.ts';
import { migrateDesktopStorageEntriesSync } from './desktop-storage-migration-sync.ts';
import { resolveDesktopStoragePaths } from './desktop-storage-paths.ts';

interface DesktopStorageApplication {
	getPath(name: 'home' | 'appData' | 'userData'): string;
	setPath(name: 'sessionData' | 'crashDumps', path: string): void;
	setAppLogsPath(path: string): void;
	readonly commandLine: {
		getSwitchValue(name: string): string;
		appendSwitch(name: string, value: string): void;
	};
}

interface DesktopStorageBootstrapOptions {
	readonly app: DesktopStorageApplication;
	readonly appName: string;
	readonly platform: NodeJS.Platform;
	readonly environment: Readonly<Record<string, string | undefined>>;
	readonly argv: readonly string[];
}

const BROWSER_FILES = Object.freeze([
	'Partitions', 'IndexedDB', 'Local Storage', 'File System', 'WebStorage', 'blob_storage',
	'Session Storage', 'Service Worker', 'Storage', 'databases', 'Dictionaries',
	'Preferences', 'Local State', 'Network', 'Network Persistent State',
	'Cookies', 'Cookies-journal', 'Cookies-wal', 'Cookies-shm',
	'Trust Tokens', 'Trust Tokens-journal', 'DIPS', 'DIPS-wal', 'DIPS-shm',
	'SharedStorage', 'SharedStorage-wal', 'SharedStorage-shm', 'Shared Dictionary',
]);
const DATA_FILES = Object.freeze([
	'models', 'runtime', 'linked-video-locators-project-v1.json',
	'framescaper-native-image-sequence-import-v1',
]);
const STATE_FILES = Object.freeze([
	'freesound-session.json', 'native-plugin-quarantine-v1.json', 'logs',
	...['soundscaper-delivery-services-v1.sqlite', 'framescaper-native-services-v1.sqlite']
		.flatMap((name) => [name, `${name}-wal`, `${name}-shm`]),
]);
const BROWSER_CACHE_FILES = Object.freeze(['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache']);
const CACHE_FILES = Object.freeze([
	'external-ffmpeg', 'desktop-audio-codecs', 'desktop-video-codecs', 'assistance-staging-v1',
	'framescaper-native-scratch', 'framescaper-native-v14-helper', 'framescaper-openfx-scratch',
	'framescaper-native-image-sequence-decode-helper',
]);

/** Configure Electron synchronously; migrate only after the single-instance lock. */
export function configureDesktopStorage(options: DesktopStorageBootstrapOptions) {
	const { app, appName, environment } = options;
	// Artifact tests and explicitly selected profiles must never touch the real home.
	const isolated = app.commandLine.getSwitchValue('user-data-dir') !== ''
		|| options.argv.some((argument) => /^--soundscaper-(?:smoke|nightly-tests|soak-debug)(?:=|-|$)/u.test(argument));
	const platform = isolated ? 'darwin' : options.platform;
	const legacyAppData = app.getPath('appData');
	const paths = resolveDesktopStoragePaths({
		platform, environment, appName, homePath: app.getPath('home'),
		appDataPath: legacyAppData, userDataPath: app.getPath('userData'),
	});
	const enabled = platform === 'linux';
	const legacyRenderInputs = join(paths.configRoot, 'framescaper-native-render-inputs');
	const renderInputRoot = enabled && hasLegacyRenderInputs(legacyRenderInputs)
		? legacyRenderInputs : join(paths.stateRoot, 'framescaper-native-render-inputs');
	let prepared = false;
	return Object.freeze({
		...paths,
		xdgEnabled: enabled,
		renderInputRoot,
		projectsDirectory(): Promise<string | null> {
			return isolated ? Promise.resolve(null) : resolveDesktopProjectsDirectory({
				platform: options.platform, homePath: app.getPath('home'),
				configHomePath: legacyAppData, environment,
			});
		},
		prepareBeforeReady(): void {
			if (prepared || !enabled) { prepared = true; return; }
			// Electron starts writing Local State and Crashpad before asynchronous I/O
			// settles. Relocate its profile synchronously before changing its paths.
			migrateDesktopStorageEntriesSync([
				...BROWSER_FILES.map((name) => ({
					source: join(paths.configRoot, name), destination: join(paths.sessionDataRoot, name),
				})),
				...BROWSER_CACHE_FILES.map((name) => ({
					source: join(paths.configRoot, name), destination: join(paths.cacheRoot, 'browser', name),
				})),
				{ source: join(paths.configRoot, 'Crashpad'), destination: paths.crashDumpsRoot },
			]);
			for (const path of [paths.dataRoot, paths.cacheRoot, paths.stateRoot,
				paths.sessionDataRoot, paths.logsRoot, paths.crashDumpsRoot]) {
				mkdirSync(path, { recursive: true, mode: 0o700 });
			}
			configureDesktopBrowserCachesSync(paths.sessionDataRoot, paths.cacheRoot);
			app.setPath('sessionData', paths.sessionDataRoot);
			app.setAppLogsPath(paths.logsRoot);
			app.setPath('crashDumps', paths.crashDumpsRoot);
			app.commandLine.appendSwitch('disk-cache-dir', join(paths.cacheRoot, 'chromium'));
			prepared = true;
		},
		async migrate(): Promise<void> {
			if (isolated) return;
			if (!prepared) throw new Error('Desktop storage must be prepared under the single-instance lock before ready.');
			await migrateDesktopProjectLibraries({
				legacyAppDataPath: legacyAppData, projectLibraryAppDataPath: paths.projectLibraryAppData, appName,
			});
			if (!enabled) return;
			const preserveModels = await hasChosenLegacyModels(paths.configRoot);
			await migrateDesktopStorageEntries([{
				source: join(paths.configRoot, 'runtime', '.archives'),
				destination: join(paths.cacheRoot, 'runtime-archives'),
			}]);
			const entries = (names: readonly string[], destinationRoot: string) => names.map((name) => ({
				source: join(paths.configRoot, name), destination: join(destinationRoot, name),
			}));
			await migrateDesktopStorageEntries([
				...entries(DATA_FILES.filter((name) => name !== 'models' || !preserveModels), paths.dataRoot),
				...entries(STATE_FILES, paths.stateRoot),
				...entries(CACHE_FILES, paths.cacheRoot),
			]);
			await mkdir(join(paths.sessionDataRoot, 'Partitions', `${appName.toLowerCase()}-production`),
				{ recursive: true, mode: 0o700 });
			await migrateDesktopBrowserCaches(paths.sessionDataRoot, paths.cacheRoot);
		},
	});
}

async function hasChosenLegacyModels(configRoot: string): Promise<boolean> {
	try {
		const settings: unknown = JSON.parse(await readFile(join(configRoot, 'desktop-settings.json'), 'utf8'));
		if (!settings || typeof settings !== 'object' || !('schemaVersion' in settings)
			|| settings.schemaVersion !== 1 || !('modelsDirectory' in settings)) return false;
		const chosen = settings.modelsDirectory;
		if (typeof chosen !== 'string' || chosen.length > 4096 || chosen.includes('\0') || !isAbsolute(chosen)) return false;
		const path = relative(join(configRoot, 'models'), resolve(chosen));
		return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
	} catch (error) {
		if (error instanceof SyntaxError || (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) return false;
		throw error;
	}
}

function hasLegacyRenderInputs(path: string): boolean {
	try {
		const metadata = lstatSync(path);
		if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
			throw new Error('Legacy native render inputs must be a regular directory.');
		}
		// Claimed carriers pin filesystem identities. Keep their original directory
		// until they drain; copying them would invalidate paused queue work.
		return readdirSync(path).length > 0;
	} catch (error) {
		if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return false;
		throw error;
	}
}
