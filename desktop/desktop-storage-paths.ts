/* SPDX-License-Identifier: AGPL-3.0-only */

import { isAbsolute, join } from 'node:path';

export interface DesktopStoragePathOptions {
	readonly platform: NodeJS.Platform;
	readonly environment: Readonly<Record<string, string | undefined>>;
	readonly homePath: string;
	readonly appDataPath: string;
	readonly userDataPath: string;
	readonly appName: string;
}

export interface DesktopStoragePaths {
	readonly configRoot: string;
	readonly dataRoot: string;
	readonly cacheRoot: string;
	readonly stateRoot: string;
	readonly projectLibraryAppData: string;
	readonly sessionDataRoot: string;
	readonly logsRoot: string;
	readonly crashDumpsRoot: string;
}

/** Keep Electron configuration paths while separating Linux data, cache and state. */
export function resolveDesktopStoragePaths(
	options: DesktopStoragePathOptions,
): Readonly<DesktopStoragePaths> {
	const { platform, environment, homePath, appDataPath, userDataPath, appName } = options;
	for (const [label, path] of Object.entries({ homePath, appDataPath, userDataPath })) {
		if (typeof path !== 'string' || path.includes('\0') || !isAbsolute(path)) {
			throw new TypeError(`Desktop storage ${label} must be an absolute path without NUL bytes.`);
		}
	}
	if (typeof appName !== 'string' || !appName || appName === '.' || appName === '..'
		|| /[/\\\0]/u.test(appName)) {
		throw new TypeError('Desktop storage appName must be a single path component without NUL bytes.');
	}
	if (platform !== 'linux') {
		return Object.freeze({
			configRoot: userDataPath,
			dataRoot: userDataPath,
			cacheRoot: userDataPath,
			stateRoot: userDataPath,
			projectLibraryAppData: appDataPath,
			sessionDataRoot: userDataPath,
			logsRoot: join(userDataPath, 'logs'),
			crashDumpsRoot: join(userDataPath, 'Crashpad'),
		});
	}
	const dataBase = xdgBase(environment.XDG_DATA_HOME, join(homePath, '.local', 'share'));
	const dataRoot = join(dataBase, appName);
	const cacheRoot = join(xdgBase(environment.XDG_CACHE_HOME, join(homePath, '.cache')), appName);
	const stateRoot = join(xdgBase(environment.XDG_STATE_HOME, join(homePath, '.local', 'state')), appName);
	return Object.freeze({
		configRoot: userDataPath,
		dataRoot,
		cacheRoot,
		stateRoot,
		projectLibraryAppData: dataBase,
		sessionDataRoot: join(dataRoot, 'browser'),
		logsRoot: join(stateRoot, 'logs'),
		crashDumpsRoot: join(stateRoot, 'Crashpad'),
	});
}

function xdgBase(value: string | undefined, fallback: string): string {
	return typeof value === 'string' && !value.includes('\0') && isAbsolute(value) ? value : fallback;
}
