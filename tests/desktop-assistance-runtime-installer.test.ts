/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';

import { createAssistanceRuntimeInstaller } from '../desktop/assistance-runtime-installer.ts';

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const PAYLOAD = Buffer.from('verified runtime payload');

function tar(files: readonly { path: string; bytes: Buffer }[]): Buffer {
	const blocks: Buffer[] = [];
	for (const file of files) {
		const header = Buffer.alloc(512);
		header.write(file.path, 0, 100, 'utf8');
		header.write('0000644\0', 100, 'ascii');
		header.write('0000000\0', 108, 'ascii');
		header.write('0000000\0', 116, 'ascii');
		header.write(file.bytes.byteLength.toString(8).padStart(11, '0') + '\0', 124, 'ascii');
		header.write('00000000000\0', 136, 'ascii');
		header.fill(32, 148, 156);
		header.write('0', 156, 'ascii');
		header.write('ustar\0', 257, 'ascii');
		header.write('00', 263, 'ascii');
		const checksum = header.reduce((sum, byte) => sum + byte, 0);
		header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
		blocks.push(header, file.bytes, Buffer.alloc((512 - file.bytes.byteLength % 512) % 512));
	}
	return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}

function distribution(archive: Buffer, fileSha256 = sha256(PAYLOAD)) {
	return {
		schemaVersion: 1,
		targetId: 'linux-x64',
		bundles: [{
			familyId: 'onnxruntime-node', runtimeVersion: '1.29.0',
			runtimePrefix: 'assistance/onnxruntime-node/1.29.0',
			installPath: 'assistance/onnxruntime-node/1.29.0/linux-x64',
			archive: {
				url: `https://assets.soundscaper.org/runtime/assistance/onnxruntime-node/1.29.0/linux-x64/${sha256(archive)}.tar.gz`,
				byteLength: archive.byteLength, sha256: sha256(archive),
			},
			files: [{ path: 'bin/runtime', byteLength: PAYLOAD.byteLength, sha256: fileSha256,
				executable: true }],
		}],
	};
}

test('runtime installer downloads once, verifies, and installs only on explicit ensure', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'scape-runtime-install-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const archive = tar([{ path: 'bin/runtime', bytes: PAYLOAD }]);
	let fetches = 0;
	const installer = createAssistanceRuntimeInstaller({
		distribution: distribution(archive), runtimeRoot: join(root, 'runtime'),
		platform: 'linux', architecture: 'x64',
		fetchImpl: (async () => {
			fetches++;
			return { status: 200, headers: { get: () => String(archive.byteLength) },
				body: (async function* () { yield archive; })() };
		}) as unknown as typeof fetch,
	});
	assert.equal(await installer.pendingDownloadBytes('onnxruntime-node'), archive.byteLength);
	assert.equal(fetches, 0);
	await installer.ensure('onnxruntime-node');
	assert.equal(fetches, 1);
	assert.deepEqual(await readFile(join(root, 'runtime/assistance/onnxruntime-node/1.29.0/linux-x64/bin/runtime')), PAYLOAD);
	assert.equal(await installer.pendingDownloadBytes('onnxruntime-node'), 0);
	await installer.ensure('onnxruntime-node');
	assert.equal(fetches, 1);
});

test('runtime installer accepts the pinned Kokoro directory depth on Windows', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'scape-runtime-kokoro-depth-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const path = `${Array.from({ length: 17 }, (_, index) => String.fromCharCode(97 + index)).join('/')}/runtime`;
	const archive = tar([{ path, bytes: PAYLOAD }]);
	const pinned = distribution(archive);
	const bundle = pinned.bundles[0]!;
	const windowsDistribution = {
		...pinned, targetId: 'win-x64', bundles: [{
			...bundle, familyId: 'kokoro-g2p', runtimeVersion: '0.9.4',
			runtimePrefix: 'assistance/kokoro-g2p/0.9.4',
			installPath: 'assistance/kokoro-g2p/0.9.4/win-x64',
			archive: { ...bundle.archive, url: `https://assets.soundscaper.org/runtime/assistance/kokoro-g2p/0.9.4/win-x64/${sha256(archive)}.tar.gz` },
			files: [{ path, byteLength: PAYLOAD.byteLength, sha256: sha256(PAYLOAD), executable: false }],
		}],
	};
	const installer = createAssistanceRuntimeInstaller({
		distribution: windowsDistribution, runtimeRoot: join(root, 'runtime'),
		platform: 'win32', architecture: 'x64',
		fetchImpl: (async () => ({ status: 200, headers: { get: () => String(archive.byteLength) },
			body: (async function* () { yield archive; })() })) as unknown as typeof fetch,
	});
	await installer.ensure('kokoro-g2p');
	assert.equal(await installer.isInstalled('kokoro-g2p'), true);
	assert.deepEqual(await readFile(join(root, 'runtime', windowsDistribution.bundles[0]!.installPath, path)), PAYLOAD);
});

test('runtime installer refuses an archive whose extracted file differs from its pin', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'scape-runtime-invalid-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const archive = tar([{ path: 'bin/runtime', bytes: PAYLOAD }]);
	const installer = createAssistanceRuntimeInstaller({
		distribution: distribution(archive, sha256(Buffer.from('foreign'))),
		runtimeRoot: join(root, 'runtime'), platform: 'linux', architecture: 'x64',
		fetchImpl: (async () => ({ status: 200, headers: { get: () => String(archive.byteLength) },
			body: (async function* () { yield archive; })() })) as unknown as typeof fetch,
	});
	await assert.rejects(installer.ensure('onnxruntime-node'), /digest/iu);
	await assert.rejects(lstat(join(root, 'runtime/assistance/onnxruntime-node/1.29.0/linux-x64')),
		{ code: 'ENOENT' });
});

test('runtime installer refuses archive path traversal and leaves the runtime absent', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'scape-runtime-traversal-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const archive = tar([{ path: '../escape', bytes: PAYLOAD }]);
	const installer = createAssistanceRuntimeInstaller({
		distribution: distribution(archive), runtimeRoot: join(root, 'runtime'),
		platform: 'linux', architecture: 'x64',
		fetchImpl: (async () => ({ status: 200, headers: { get: () => String(archive.byteLength) },
			body: (async function* () { yield archive; })() })) as unknown as typeof fetch,
	});
	await assert.rejects(installer.ensure('onnxruntime-node'), /archive|path|inventory/iu);
	await assert.rejects(lstat(join(root, 'escape')), { code: 'ENOENT' });
});

test('one caller may cancel a shared runtime transfer without cancelling another', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'scape-runtime-shared-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const archive = tar([{ path: 'bin/runtime', bytes: PAYLOAD }]);
	let release: () => void = () => undefined;
	const gate = new Promise<void>((resolve) => { release = resolve; });
	let fetches = 0;
	const installer = createAssistanceRuntimeInstaller({
		distribution: distribution(archive), runtimeRoot: join(root, 'runtime'),
		platform: 'linux', architecture: 'x64',
		fetchImpl: (async () => {
			fetches++;
			return { status: 200, headers: { get: () => String(archive.byteLength) },
				body: (async function* () { await gate; yield archive; })() };
		}) as unknown as typeof fetch,
	});
	const firstController = new AbortController();
	const secondController = new AbortController();
	const first = installer.ensure('onnxruntime-node', firstController.signal);
	const second = installer.ensure('onnxruntime-node', secondController.signal);
	firstController.abort(new DOMException('First caller cancelled.', 'AbortError'));
	release();
	await assert.rejects(first, /cancelled/iu);
	await second;
	assert.equal(fetches, 1);
	assert.equal(await installer.isInstalled('onnxruntime-node'), true);
});

test('download estimate and repair reauthenticate both installed files and cached archive', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'scape-runtime-repair-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const archive = tar([{ path: 'bin/runtime', bytes: PAYLOAD }]);
	let fetches = 0;
	const installer = createAssistanceRuntimeInstaller({
		distribution: distribution(archive), runtimeRoot: join(root, 'runtime'),
		platform: 'linux', architecture: 'x64',
		fetchImpl: (async () => {
			fetches++;
			return { status: 200, headers: { get: () => String(archive.byteLength) },
				body: (async function* () { yield archive; })() };
		}) as unknown as typeof fetch,
	});
	await installer.ensure('onnxruntime-node');
	const installed = join(root, 'runtime/assistance/onnxruntime-node/1.29.0/linux-x64/bin/runtime');
	await writeFile(installed, 'tampered');
	assert.equal(await installer.pendingDownloadBytes('onnxruntime-node'), 0,
		'authenticated cached archive can repair the install offline');
	await writeFile(join(root, `runtime/.archives/blobs/sha256-${sha256(archive)}`), 'tampered');
	assert.equal(await installer.pendingDownloadBytes('onnxruntime-node'), archive.byteLength);
	await installer.ensure('onnxruntime-node');
	assert.equal(fetches, 2);
	assert.deepEqual(await readFile(installed), PAYLOAD);
});
