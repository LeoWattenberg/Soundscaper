/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The transfer protocol must stay outside every eagerly-loaded chunk group.
 *
 * The five protocol modules were first written under
 * `src/common/editor/controller/`. The `editor-controller-core` group in
 * `scripts/lib/build-chunk-groups.mjs` claims *any* file under that directory,
 * so the whole transfer protocol was swept into an eager editor chunk. Two
 * things broke: `npm run build` failed the Framescaper product-ready startup
 * graph budget (rawBytes 6704680 > 6700000), and the generated
 * `/transfer/send/` and `/transfer/receive/` documents preloaded 61 modules of
 * editor code even though they are designed as standalone pages that load the
 * transfer chunk alone.
 *
 * The directory is the claim. These modules are transfer concerns, so they live
 * under `src/common/transfer/`, which matches no chunk group rule and is
 * therefore placed by dynamic reachability behind the transfer page entry.
 */

import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';

const TRANSFER_DIRECTORY = fileURLToPath(new URL('../src/common/transfer/', import.meta.url));
const EDITOR_DIRECTORY = fileURLToPath(new URL('../src/common/editor/', import.meta.url));

const PROTOCOL_MODULES = [
	'project-transfer-bundle.ts',
	'project-transfer-bundle-admission.ts',
	'project-transfer-handshake.ts',
	'project-transfer-handshake-channel.ts',
	'project-transfer-handshake-wire.ts',
];

function editorModulesNamed(prefix: string): string[] {
	const found: string[] = [];
	const walk = (directory: string, label: string): void => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			if (entry.isDirectory()) walk(`${directory}${entry.name}/`, `${label}${entry.name}/`);
			else if (entry.name.startsWith(prefix)) found.push(`${label}${entry.name}`);
		}
	};
	walk(EDITOR_DIRECTORY, '');
	return found.sort();
}

test('the transfer protocol modules live under src/common/transfer/', () => {
	const missing = PROTOCOL_MODULES.filter((name) => !existsSync(`${TRANSFER_DIRECTORY}${name}`));
	assert.deepEqual(missing, [], 'the protocol modules must sit in the transfer directory');
});

test('no transfer protocol module is left under the editor', () => {
	// An editor directory is a claim of editor ownership, and every chunk group
	// under `src/common/editor/` is matched by path rather than by reachability.
	assert.deepEqual(editorModulesNamed('project-transfer-'), []);
});

test('no module under src/common/transfer/ is claimed by an eager chunk group', () => {
	const owned = readdirSync(TRANSFER_DIRECTORY, { withFileTypes: true })
		.filter((entry) => entry.isFile() && /\.(?:[cm]?[jt]s)$/u.test(entry.name))
		.map((entry) => `src/common/transfer/${entry.name}`)
		.filter((path) => chunkGroupForModulePath(path) !== null)
		.sort();
	assert.deepEqual(owned, [], 'these would be emitted into a path-matched startup chunk');
});
