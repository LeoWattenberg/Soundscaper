/* SPDX-License-Identifier: AGPL-3.0-only */

/** Immutable, no-follow custody for one authenticated third-party candidate. */

import { cp, chmod, lstat, mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { authenticatePluginCandidate } from './plugin-candidate-authentication.mjs';

const SHA256 = /^[a-f\d]{64}$/u;

export async function snapshotAuthenticatedPluginCandidate(path, expected, ports = {}) {
	const copy = ports.copy ?? cp;
	const remove = ports.remove ?? rm;
	const snapshotParent = ports.snapshotParent ?? tmpdir();
	const first = await authenticatePluginCandidate(path);
	assertExpected(first, expected, true);
	if (await realpath(snapshotParent) !== resolve(snapshotParent)) {
		throw new Error('The plug-in snapshot parent must remain canonical.');
	}
	const container = await mkdtemp(join(snapshotParent, 'soundscaper-plugin-snapshot-'));
	let disposed = false;
	let disposal = null;
	try {
		const snapshotPath = join(container, basename(path));
		await copy(path, snapshotPath, {
			recursive: first.kind === 'bundle', dereference: false, errorOnExist: true,
			force: false, preserveTimestamps: true, verbatimSymlinks: true,
		});
		const [sourceAfter, snapshot] = await Promise.all([
			authenticatePluginCandidate(path), authenticatePluginCandidate(snapshotPath),
		]);
		assertExpected(sourceAfter, expected, true);
		assertExpected(snapshot, expected, false);
		await makeReadOnly(container);
		const frozen = await authenticatePluginCandidate(snapshotPath);
		assertExpected(frozen, expected, false);
		return Object.freeze({
			path: snapshotPath,
			authentication: frozen,
			dispose: async () => {
				if (disposed) return;
				if (disposal === null) disposal = (async () => {
					await makeWritable(container).catch(() => undefined);
					await remove(container, {
						recursive: true, force: true, maxRetries: 5, retryDelay: 50,
					});
					disposed = true;
				})();
				try { await disposal; }
				finally { if (!disposed) disposal = null; }
			},
		});
	} catch (error) {
		await makeWritable(container).catch(() => undefined);
		await remove(container, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
		throw error;
	}
}

async function makeReadOnly(path) {
	const metadata = await lstat(path);
	if (metadata.isSymbolicLink() || (!metadata.isFile() && !metadata.isDirectory())) {
		throw new Error('A plug-in snapshot contains a symbolic or special entry.');
	}
	if (metadata.isDirectory()) {
		for (const entry of await readdir(path)) await makeReadOnly(join(path, entry));
		await chmod(path, 0o500);
	} else await chmod(path, 0o400);
}

async function makeWritable(path) {
	const metadata = await lstat(path);
	if (metadata.isSymbolicLink()) return;
	if (metadata.isDirectory()) {
		await chmod(path, 0o700);
		for (const entry of await readdir(path)) await makeWritable(join(path, entry));
	} else if (metadata.isFile()) await chmod(path, 0o600);
}

function assertExpected(actual, expected, identity) {
	if (!expected || typeof expected !== 'object' || !Number.isSafeInteger(expected.byteLength)
		|| expected.byteLength < 1 || !SHA256.test(String(expected.sha256))
		|| actual.byteLength !== expected.byteLength || actual.sha256 !== expected.sha256
		|| (identity && (actual.identity.dev !== expected.identity?.dev
			|| actual.identity.ino !== expected.identity?.ino))) {
		throw new Error('The plug-in candidate changed before immutable isolated custody.');
	}
}
