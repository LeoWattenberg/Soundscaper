/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

export interface DesktopProjectsDirectoryOptions {
	readonly platform: NodeJS.Platform;
	readonly homePath: string;
	/** Electron's appData path, which already honors XDG_CONFIG_HOME on Linux. */
	readonly configHomePath: string;
	readonly environment: Readonly<Record<string, string | undefined>>;
	readonly readFile?: (path: string, encoding: 'utf8') => Promise<string>;
}

/** Resolve Linux's user-facing Projects directory without executing shell configuration. */
export async function resolveDesktopProjectsDirectory(
	options: DesktopProjectsDirectoryOptions,
): Promise<string | null> {
	if (options.platform !== 'linux') return null;
	const { homePath, configHomePath, environment } = options;
	for (const [label, path] of Object.entries({ homePath, configHomePath })) {
		if (!isSafeAbsolutePath(path)) {
			throw new TypeError(`Desktop Projects ${label} must be an absolute path without NUL bytes.`);
		}
	}
	const override = environment.XDG_PROJECTS_DIR;
	if (isSafeAbsolutePath(override)) return enabledDirectory(override, homePath);
	const fallback = join(homePath, 'Projects');
	let configuration: string;
	try {
		configuration = await (options.readFile ?? readFile)(join(configHomePath, 'user-dirs.dirs'), 'utf8');
	} catch {
		return fallback;
	}
	let directory: string | undefined;
	for (const line of configuration.split(/\r?\n/u)) {
		const parsed = parseProjectsAssignment(line, homePath);
		if (parsed !== undefined) directory = parsed;
	}
	return directory === undefined ? fallback : enabledDirectory(directory, homePath);
}

function enabledDirectory(directory: string, homePath: string): string | null {
	// xdg-user-dirs uses the home directory to explicitly disable a user directory.
	return resolve(directory) === resolve(homePath) ? null : directory;
}

function isSafeAbsolutePath(path: string | undefined): path is string {
	return typeof path === 'string' && !path.includes('\0') && isAbsolute(path);
}

function parseProjectsAssignment(line: string, homePath: string): string | undefined {
	const prefix = /^[ \t]*XDG_PROJECTS_DIR[ \t]*=[ \t]*"/u.exec(line);
	if (prefix === null || line.includes('\0')) return undefined;
	let position = prefix[0].length;
	let directory = '';
	if (line[position] === '$') {
		const homePrefix = /^\$(?:HOME|\{HOME\})(?=\/|")/u.exec(line.slice(position));
		if (homePrefix === null) return undefined;
		directory = homePath;
		position += homePrefix[0].length;
	}
	for (; position < line.length; position += 1) {
		const character = line[position];
		if (character === '"') {
			return /^[ \t]*(?:#.*)?$/u.test(line.slice(position + 1)) && isSafeAbsolutePath(directory)
				? directory : undefined;
		}
		if (character === '\\') {
			position += 1;
			const escaped = line[position];
			if (escaped === undefined) return undefined;
			directory += escaped;
		} else {
			// Only a leading HOME reference expands. Other shell expressions are never interpreted.
			if (character === '$' || character === '`') return undefined;
			directory += character;
		}
	}
	return undefined;
}
