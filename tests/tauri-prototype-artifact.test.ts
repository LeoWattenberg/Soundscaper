/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

import { stagePrototypeArtifact } from '../prototypes/tauri/stage-artifact.mjs';

const revision = '1234567890abcdef1234567890abcdef12345678';

async function fixture() {
	const root = await mkdtemp(resolve(tmpdir(), 'tauri-artifact-'));
	const host = resolve(root, 'prototypes/tauri/host');
	await mkdir(host, { recursive: true });
	await mkdir(resolve(root, 'LICENSES'), { recursive: true });
	await mkdir(resolve(root, '.tauri-prototype/target/release'), { recursive: true });
	for (const name of ['LICENSE', 'THIRD_PARTY_LICENSES.md', 'LICENSES/third-party.txt',
		'prototypes/tauri/README.md', 'prototypes/tauri/host/Cargo.toml',
		'prototypes/tauri/host/Cargo.lock', 'prototypes/tauri/host/rust-toolchain.toml',
		'.tauri-prototype/target/release/soundscaper-tauri-prototype']) {
		await writeFile(resolve(root, name), `${name}\n`);
	}
	await chmod(resolve(root, '.tauri-prototype/target/release/soundscaper-tauri-prototype'), 0o755);
	const crate = resolve(root, 'cargo-registry/noticed-1.2.3');
	await mkdir(resolve(crate, 'legal'), { recursive: true });
	await writeFile(resolve(crate, 'Cargo.toml'), 'crate manifest');
	await writeFile(resolve(crate, 'LICENSE-MIT'), 'MIT notice');
	await writeFile(resolve(crate, 'COPYING'), 'Copying terms');
	await writeFile(resolve(crate, 'NOTICE.txt'), 'Attribution notice');
	await writeFile(resolve(crate, 'legal/terms.txt'), 'Declared license file');
	await writeFile(resolve(crate, 'README.md'), 'Not a license');
	const declaration = resolve(root, 'cargo-registry/declaration-only-2.0.0');
	await mkdir(declaration, { recursive: true });
	await writeFile(resolve(declaration, 'Cargo.toml'), 'crate manifest');
	const metadata = {
		packages: [
			{ id: 'host', name: 'soundscaper-tauri-prototype', version: '0.1.0',
				manifest_path: resolve(host, 'Cargo.toml'), license: 'AGPL-3.0-only', license_file: null, repository: null, source: null },
			{ id: 'noticed', name: 'noticed', version: '1.2.3', manifest_path: resolve(crate, 'Cargo.toml'),
				license: 'MIT OR Apache-2.0', license_file: 'legal/terms.txt', repository: 'https://example.com/noticed',
				source: 'registry+https://github.com/rust-lang/crates.io-index' },
			{ id: 'declaration', name: 'declaration-only', version: '2.0.0', manifest_path: resolve(declaration, 'Cargo.toml'),
				license: 'BSD-3-Clause', license_file: null, repository: null, source: 'registry+https://github.com/rust-lang/crates.io-index' },
			{ id: 'other-target', name: 'other-target', version: '1.0.0', manifest_path: '/not-installed/Cargo.toml',
				license: 'MIT', license_file: null, repository: null, source: null },
		],
		resolve: { root: 'host', nodes: [
			{ id: 'host', dependencies: ['noticed'] },
			{ id: 'noticed', dependencies: ['declaration'] },
			{ id: 'declaration', dependencies: [] },
		] },
	};
	return { root, host, crate, metadata };
}

test('artifact stages the release executable, source pins, browser notices, and resolved Rust notices', async () => {
	const { root, crate, metadata } = await fixture();
	try {
		const artifact = await stagePrototypeArtifact({ root, platform: 'linux', revision }, { metadata });
		assert.equal(artifact, resolve(root, '.tauri-prototype/artifact'));
		assert.equal(await readFile(resolve(artifact, 'SOURCE_REVISION'), 'utf8'), `${revision}\n`);
		assert.equal(await readFile(resolve(artifact, 'SOURCE_URL'), 'utf8'), `https://github.com/LeoWattenberg/Soundscaper/tree/${revision}\n`);
		assert.equal(await readFile(resolve(artifact, 'README.md'), 'utf8'), 'prototypes/tauri/README.md\n');
		for (const name of ['LICENSE', 'THIRD_PARTY_LICENSES.md', 'LICENSES/third-party.txt',
			'prototypes/tauri/host/Cargo.toml', 'prototypes/tauri/host/Cargo.lock', 'prototypes/tauri/host/rust-toolchain.toml']) {
			assert.equal(await readFile(resolve(artifact, name), 'utf8'), `${name}\n`);
		}
		assert.equal((await stat(resolve(artifact, 'soundscaper-tauri-prototype'))).mode & 0o777, 0o755);
		for (const [name, contents] of [['LICENSE-MIT', 'MIT notice'], ['COPYING', 'Copying terms'],
			['NOTICE.txt', 'Attribution notice'], ['legal/terms.txt', 'Declared license file']]) {
			assert.equal(await readFile(resolve(artifact, 'licenses/rust/noticed-1.2.3', name!), 'utf8'), contents);
		}
		await assert.rejects(readFile(resolve(artifact, 'licenses/rust/noticed-1.2.3/README.md')), { code: 'ENOENT' });
		const inventory: { name: string; version: string; license: string; repository: string | null; source: string | null; files: string[] }[] =
			JSON.parse(await readFile(resolve(artifact, 'licenses/rust/inventory.json'), 'utf8'));
		assert.deepEqual(inventory.map(({ name }) => name), ['declaration-only', 'noticed']);
		assert.deepEqual(inventory[0], { name: 'declaration-only', version: '2.0.0', license: 'BSD-3-Clause',
			repository: null, source: 'registry+https://github.com/rust-lang/crates.io-index', files: [] });
		assert.equal(inventory[1]?.repository, 'https://example.com/noticed');
		assert.equal(inventory[1]?.license, 'MIT OR Apache-2.0');
		assert.deepEqual(inventory[1]?.files, ['COPYING', 'LICENSE-MIT', 'NOTICE.txt', 'legal/terms.txt']);
		assert.equal(await readFile(resolve(crate, 'LICENSE-MIT'), 'utf8'), 'MIT notice');
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('metadata commands use the pinned host toolchain and release feature on the current Rust target', async () => {
	const { root, host, metadata } = await fixture();
	try {
		const calls: { command: string; args: string[]; cwd: string }[] = [];
		await stagePrototypeArtifact({ root, platform: 'linux', revision }, {
			execute: (command: string, args: string[], options: { cwd: string }) => {
				calls.push({ command, args, cwd: options.cwd });
				return Promise.resolve(command === 'rustc' ? 'rustc 1.99.0\nhost: x86_64-unknown-linux-gnu\n' : JSON.stringify(metadata));
			},
		});
		assert.deepEqual(calls, [
			{ command: 'rustc', args: ['-vV'], cwd: host },
			{ command: 'cargo', args: ['metadata', '--locked', '--format-version=1', '--features', 'custom-protocol',
				'--filter-platform', 'x86_64-unknown-linux-gnu'], cwd: host },
		]);
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('Windows artifacts stage the release exe and replace old artifact contents', async () => {
	const { root, metadata } = await fixture();
	try {
		await writeFile(resolve(root, '.tauri-prototype/target/release/soundscaper-tauri-prototype.exe'), 'windows executable');
		await mkdir(resolve(root, '.tauri-prototype/artifact'), { recursive: true });
		await writeFile(resolve(root, '.tauri-prototype/artifact/stale'), 'old');
		const artifact = await stagePrototypeArtifact({ root, platform: 'win32', revision }, { metadata });
		assert.equal(await readFile(resolve(artifact, 'soundscaper-tauri-prototype.exe'), 'utf8'), 'windows executable');
		await assert.rejects(readFile(resolve(artifact, 'stale')), { code: 'ENOENT' });
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('missing required executable and pinned inputs fail before publishing an artifact', async () => {
	for (const missing of ['.tauri-prototype/target/release/soundscaper-tauri-prototype', 'LICENSE',
		'prototypes/tauri/host/Cargo.lock', 'prototypes/tauri/host/rust-toolchain.toml', 'LICENSES']) {
		const { root, metadata } = await fixture();
		try {
			await rm(resolve(root, missing), { recursive: true, force: true });
			await assert.rejects(stagePrototypeArtifact({ root, platform: 'linux', revision }, { metadata }), /Required prototype artifact input/u);
			await assert.rejects(stat(resolve(root, '.tauri-prototype/artifact')), { code: 'ENOENT' });
		} finally { await rm(root, { recursive: true, force: true }); }
	}
});

test('missing declared crate license files and malformed revisions fail staging', async () => {
	const { root, crate, metadata } = await fixture();
	try {
		await rm(resolve(crate, 'legal/terms.txt'));
		await assert.rejects(stagePrototypeArtifact({ root, platform: 'linux', revision }, { metadata }), /Required Rust notice/u);
		await assert.rejects(stagePrototypeArtifact({ root, platform: 'linux', revision: 'not-a-revision' }, { metadata }), /source revision/u);
	} finally { await rm(root, { recursive: true, force: true }); }
});
