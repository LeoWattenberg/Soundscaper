/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { NIGHTLY_TEST_PAYLOAD_INPUTS } from '../scripts/lib/desktop-nightly-tests-staging.mjs';

test('the declared nightly preload fixture builds from packaged sources without a generated desktop runtime', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-nightly-preload-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const repository = resolve(import.meta.dirname, '..');
	const sources = [
		'tests/helpers/desktop-preload-source.mjs', 'desktop/preload.mjs',
		'desktop/ara-preload.ts', 'desktop/blender-preload.ts',
		'src/common/editor/ara-contract.ts', 'src/common/editor/blender-contract.ts',
	];
	for (const source of sources) {
		const input = NIGHTLY_TEST_PAYLOAD_INPUTS.find((entry) => entry.source === source
			|| (entry.kind === 'directory' && source.startsWith(`${entry.source}/`)));
		assert.ok(input, `The packaged fixture must declare ${source}`);
		const suffix = source.slice(input.source.length);
		const destination = join(root, `${input.destination}${suffix}`);
		await mkdir(dirname(destination), { recursive: true });
		await copyFile(join(repository, source), destination);
	}
	// Use installed tooling, while every first-party source comes from the payload.
	await symlink(join(repository, 'node_modules'), join(root, 'node_modules'), 'dir');
	const helper = await import(pathToFileURL(join(root, sources[0])).href);
	const exposed = new Map();
	vm.runInNewContext(await helper.readDesktopPreloadSource(), {
		require: (specifier) => {
			assert.equal(specifier, 'electron');
			return {
				contextBridge: { exposeInMainWorld: (name, value) => { exposed.set(name, value); } },
				ipcRenderer: { on() {}, removeListener() {}, send() {}, invoke: async () => true },
			};
		},
	});
	assert.deepEqual([...exposed.keys()], ['scapeDesktop', 'soundscaperDesktop', 'framescaperDesktop']);
	for (const bridge of exposed.values()) {
		assert.equal(typeof bridge.v1.ara.start, 'function');
		assert.equal(await bridge.v1.releaseSaveTarget('a'.repeat(48)), true);
	}
	assert.equal(typeof exposed.get('scapeDesktop').v1.blender.select, 'function');
});
