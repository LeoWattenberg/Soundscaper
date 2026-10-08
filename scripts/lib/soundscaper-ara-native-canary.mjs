/* SPDX-License-Identifier: AGPL-3.0-only */

/** Receipt-bound installed ARA host canary; fixture plugins never enter product payloads. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

import { targetId } from './soundscaper-professional-native-build-result-contract.mjs';

const MAXIMUM_FIXTURE_FILES = 128;
const MAXIMUM_FIXTURE_BYTES = 64 * 1024 * 1024;

export async function runInstalledAraNativeCanary(options, ports = {}) {
	const target = targetId(options.target);
	const root = options.professionalInstallRoot;
	const executable = join(root, 'self-test', `soundscaper_ara_host_self_test${target.startsWith('win-') ? '.exe' : ''}`);
	const fixture = join(root, 'self-test', 'SoundscaperARAFixture.vst3');
	const executableBytes = await regularBytes(executable);
	const inventory = await fixtureInventory(fixture);
	const result = (ports.run ?? spawnSync)(executable, [fixture], {
		encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 30_000,
	});
	if (result.status !== 0) throw new Error(`The installed ARA host canary failed: ${String(result.stderr ?? result.error ?? '')}`);
	let evidence;
	try { evidence = JSON.parse(String(result.stdout)); }
	catch { throw new Error('The installed ARA host canary evidence is not JSON.'); }
	if (evidence?.status !== 'passed' || evidence.canary !== 'ara-vst3-document-round-trip'
		|| evidence.randomAccess !== true || evidence.archiveRoundTrip !== true) {
		throw new Error('The installed ARA host canary evidence is incomplete.');
	}
	return Object.freeze({
		canary: 'ara-vst3-document-round-trip', randomAccess: true, archiveRoundTrip: true,
		executableSha256: digest(executableBytes),
		fixtureSha256: digest(Buffer.from(JSON.stringify(inventory))),
		fixtureFileCount: inventory.length,
	});
}

async function fixtureInventory(root) {
	if (await realpath(root) !== root) throw new Error('The ARA canary fixture root is symbolic.');
	const rootMetadata = await lstat(root);
	if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
		throw new Error('The ARA canary fixture root is not a directory.');
	}
	const files = [];
	let totalBytes = 0;
	async function visit(directory) {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name);
			if (entry.isSymbolicLink()) throw new Error('The ARA canary fixture contains a symbolic member.');
			if (entry.isDirectory()) await visit(path);
			else if (entry.isFile()) {
				if (files.length >= MAXIMUM_FIXTURE_FILES) throw new Error('The ARA canary fixture exceeds its file bound.');
				const bytes = await regularBytes(path);
				totalBytes += bytes.byteLength;
				if (totalBytes > MAXIMUM_FIXTURE_BYTES) throw new Error('The ARA canary fixture exceeds its byte bound.');
				files.push({ path: relative(root, path).split(sep).join('/'), byteLength: bytes.byteLength, sha256: digest(bytes) });
			} else throw new Error('The ARA canary fixture contains a special member.');
		}
	}
	await visit(root);
	if (files.length === 0) throw new Error('The ARA canary fixture is empty.');
	return files.sort((left, right) => left.path.localeCompare(right.path, 'en'));
}

async function regularBytes(path) {
	const metadata = await lstat(path);
	if (!metadata.isFile() || metadata.isSymbolicLink() || await realpath(path) !== path
		|| metadata.size < 1 || metadata.size > MAXIMUM_FIXTURE_BYTES) {
		throw new Error('The ARA canary artifact is not a bounded canonical regular file.');
	}
	return readFile(path);
}

function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
