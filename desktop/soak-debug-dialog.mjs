/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdir } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, resolve } from 'node:path';

import { SOAK_DEBUG_FLAG } from './soak-debug-process-metrics.mjs';

export const SOAK_DEBUG_OUTPUT_DIRECTORY_PREFIX = '--soundscaper-soak-debug-output-directory=';

/**
 * Automates only save destinations owned by an explicit soak run. All other
 * dialog methods and ordinary application launches retain Electron behavior.
 */
export function createSoakDebugDialog(delegate, argv) {
	assertDialog(delegate);
	if (!Array.isArray(argv) || !argv.includes(SOAK_DEBUG_FLAG)) return boundDialog(delegate);
	const roots = argv.filter((argument) => (
		typeof argument === 'string' && argument.startsWith(SOAK_DEBUG_OUTPUT_DIRECTORY_PREFIX)
	)).map((argument) => argument.slice(SOAK_DEBUG_OUTPUT_DIRECTORY_PREFIX.length));
	if (roots.length !== 1 || !roots[0]) {
		throw new TypeError('Desktop soak debug requires exactly one output directory.');
	}
	if (!isAbsolute(roots[0]) || roots[0].includes('\0')) {
		throw new TypeError('The desktop soak-debug output directory must be absolute.');
	}
	const outputRoot = resolve(roots[0]);
	let saveSequence = 0;
	return new Proxy(delegate, {
		get(target, property) {
			if (property === 'showSaveDialog') return async (...args) => {
				const options = dialogOptions(args);
				await mkdir(outputRoot, { recursive: true });
				saveSequence += 1;
				return {
					canceled: false,
					filePath: join(outputRoot, sequencedName(options.defaultPath, saveSequence)),
				};
			};
			if (property === 'showOpenDialog') return async (...args) => {
				const options = dialogOptions(args);
				if (options.title !== 'Select delivery destination'
					|| !Array.isArray(options.properties)
					|| !options.properties.includes('openDirectory')) {
					return target.showOpenDialog(...args);
				}
				const destination = join(outputRoot, 'delivery-destination');
				await mkdir(destination, { recursive: true });
				return { canceled: false, filePaths: [destination] };
			};
			const value = Reflect.get(target, property, target);
			return typeof value === 'function' ? value.bind(target) : value;
		},
	});
}

function boundDialog(delegate) {
	return new Proxy(delegate, {
		get(target, property) {
			const value = Reflect.get(target, property, target);
			return typeof value === 'function' ? value.bind(target) : value;
		},
	});
}

function dialogOptions(args) {
	const options = args.at(-1);
	return options && typeof options === 'object' && !Array.isArray(options) ? options : {};
}

function sequencedName(defaultPath, sequence) {
	const candidate = typeof defaultPath === 'string' ? basename(defaultPath) : '';
	const safe = candidate.replace(/[^A-Za-z0-9._ -]/gu, '-').replace(/^\.+/u, '').slice(0, 180)
		|| 'soundscaper-output';
	const extension = extname(safe).slice(0, 32);
	const stem = (extension ? safe.slice(0, -extension.length) : safe).slice(0, 140) || 'soundscaper-output';
	return `${stem}-${String(sequence).padStart(4, '0')}${extension}`;
}

function assertDialog(value) {
	if (!value || typeof value !== 'object'
		|| typeof value.showSaveDialog !== 'function' || typeof value.showOpenDialog !== 'function') {
		throw new TypeError('Soak-debug dialog automation requires the Electron dialog interface.');
	}
}
