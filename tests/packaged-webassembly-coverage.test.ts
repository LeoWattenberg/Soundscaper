/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import { createPackagedWebAssemblyAuthenticator } from '../scripts/lib/packaged-webassembly-coverage.mjs';

const WASM = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

test('packaged app-scheme Wasm is bound to the exact installed renderer file', async (context) => {
	const root = await workspace(context);
	const path = join(root, 'renderer/assets/pffft-BbtAeRsi.wasm');
	await mkdir(join(root, 'renderer/assets'), { recursive: true });
	await writeFile(path, WASM);
	const authenticate = createPackagedWebAssemblyAuthenticator({
		allowAppUrl: true,
		productId: 'soundscaper',
		resourcesRoot: root,
		webAssemblyResources: [record('renderer/assets/pffft-BbtAeRsi.wasm')],
	});
	const url = 'soundscaper-app://bundle/assets/pffft-BbtAeRsi.wasm';
	assert.equal(await authenticate({ bytes: WASM, url }), true);
	for (const candidate of [
		`${url}?cache=1`, `${url}#fragment`, url.replace('/pffft-', '/%70ffft-'),
		url.replace('soundscaper-app:', 'framescaper-app:'),
		'soundscaper-app://user@bundle/assets/pffft-BbtAeRsi.wasm',
	]) await assert.rejects(authenticate({ bytes: WASM, url: candidate }), /unapproved WebAssembly URL/u);
	await assert.rejects(
		authenticate({ bytes: Buffer.from([...WASM.slice(0, -1), 1]), url }),
		/differs from its installed regular file/u,
	);
});

test('local-assistance file Wasm is restricted to a canonical Resources file URL', async (context) => {
	const root = await workspace(context);
	const path = join(root, 'runtime/model/engine.wasm');
	await mkdir(join(root, 'runtime/model'), { recursive: true });
	await writeFile(path, WASM);
	const authenticate = createPackagedWebAssemblyAuthenticator({
		allowFileUrl: true,
		productId: 'framescaper',
		resourcesRoot: root,
		webAssemblyResources: [record('runtime/model/engine.wasm')],
	});
	const url = pathToFileURL(path).href;
	assert.equal(await authenticate({ bytes: WASM, url }), true);
	await assert.rejects(authenticate({ bytes: WASM, url: `${url}?changed=1` }), /unapproved WebAssembly URL/u);
	await assert.rejects(authenticate({
		bytes: WASM,
		url: pathToFileURL(join(root, '../outside.wasm')).href,
	}), /unapproved WebAssembly URL/u);
});

test('packaged runtime Wasm follows the exact custom-protocol mount split', async (context) => {
	const root = await workspace(context);
	await mkdir(join(root, 'runtime/model'), { recursive: true });
	await mkdir(join(root, 'renderer/runtime-model'), { recursive: true });
	await writeFile(join(root, 'runtime/model/engine.wasm'), WASM);
	await writeFile(join(root, 'renderer/runtime-model/engine.wasm'), WASM);
	const authenticate = createPackagedWebAssemblyAuthenticator({
		allowAppUrl: true,
		productId: 'soundscaper',
		resourcesRoot: root,
		webAssemblyResources: [
			record('renderer/runtime-model/engine.wasm'),
			record('runtime/model/engine.wasm'),
		],
	});
	assert.equal(await authenticate({
		bytes: WASM, url: 'soundscaper-app://bundle/runtime/model/engine.wasm',
	}), true);
	assert.equal(await authenticate({
		bytes: WASM, url: 'soundscaper-app://bundle/runtime-model/engine.wasm',
	}), true);
	for (const url of [
		'soundscaper-app://bundle/runtime',
		'soundscaper-app://bundle/runtime//model/engine.wasm',
		'soundscaper-app://bundle/runtime/../runtime/model/engine.wasm',
	]) await assert.rejects(authenticate({ bytes: WASM, url }), /unapproved WebAssembly URL/u);
});

test('packaged authentication stays bound to unique immutable prelaunch records', async (context) => {
	const root = await workspace(context);
	const path = join(root, 'renderer/engine.wasm');
	await mkdir(join(root, 'renderer'), { recursive: true });
	await writeFile(path, WASM);
	const identity = record('renderer/engine.wasm');
	assert.throws(() => createPackagedWebAssemblyAuthenticator({
		allowAppUrl: true,
		productId: 'soundscaper',
		resourcesRoot: root,
		webAssemblyResources: [identity, identity],
	}), /invalid resource identity/u);
	const authenticate = createPackagedWebAssemblyAuthenticator({
		allowAppUrl: true,
		productId: 'soundscaper',
		resourcesRoot: root,
		webAssemblyResources: [identity],
	});
	const swapped = Buffer.from([...WASM.slice(0, -1), 1]);
	await writeFile(path, swapped);
	await assert.rejects(authenticate({
		bytes: swapped, url: 'soundscaper-app://bundle/engine.wasm',
	}), /differs from its installed regular file/u);
});

async function workspace(context: { after(callback: () => Promise<void>): void }) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-packaged-wasm-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	return root;
}

function record(path: string) {
	return { path, byteLength: WASM.byteLength, sha256: createHash('sha256').update(WASM).digest('hex') };
}
