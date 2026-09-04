/* SPDX-License-Identifier: AGPL-3.0-only */

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The editor module inventories the chunk-ownership tests measure themselves against.
 *
 * Each list is read from the filesystem rather than written down, so a module added to one
 * of these directories is checked by the ownership tests the moment it lands instead of
 * whenever someone remembers to name it.
 */

const EDITOR_DIRECTORY = fileURLToPath(new URL('../../src/common/editor/', import.meta.url));
const ASSISTANCE_DIRECTORY = fileURLToPath(new URL('../../src/common/editor/assistance/', import.meta.url));
const EDITOR_CONTROLLER_DIRECTORY = fileURLToPath(new URL('../../src/common/editor/controller/', import.meta.url));
const MODULE_PATTERN = /\.(?:[cm]?[jt]s)$/u;

function modulesIn(directory: string, prefix: string, accept: (name: string) => boolean = () => true) {
	return readdirSync(directory, { withFileTypes: true })
		.filter((entry) => entry.isFile() && MODULE_PATTERN.test(entry.name) && accept(entry.name))
		.map((entry) => `${prefix}${entry.name}`)
		.sort();
}

/** Editor modules directly under `src/common/editor/`, which no subdirectory groups. */
export function flatEditorModules(): readonly string[] {
	return modulesIn(EDITOR_DIRECTORY, 'src/common/editor/');
}

/** Modules of the `assistance/` domain. */
export function assistanceDomainModules(): readonly string[] {
	return modulesIn(ASSISTANCE_DIRECTORY, 'src/common/editor/assistance/');
}

/** Controller modules belonging to local assistance, named by their shared prefix. */
export function localAssistanceControllerModules(): readonly string[] {
	return modulesIn(EDITOR_CONTROLLER_DIRECTORY, 'src/common/editor/controller/',
		(name) => name.startsWith('local-assistance-'));
}
