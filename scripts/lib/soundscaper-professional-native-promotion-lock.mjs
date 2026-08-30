/* SPDX-License-Identifier: AGPL-3.0-only */

/** Fail-closed repository lock and ownership fence for standalone promotions. */

import { randomUUID } from 'node:crypto';
import {
	lstat, mkdir, open, readFile, realpath, rmdir, unlink, writeFile,
} from 'node:fs/promises';
import { resolve } from 'node:path';

const LOCK_NAME = '.soundscaper-professional-native-promotion.lock';
const OWNER_NAME = 'owner.json';
const ACQUISITION_TIMEOUT_MS = 30_000;
const RETRY_MS = 20;

export async function acquireSoundscaperProfessionalNativePromotionLock(repositoryRoot) {
	const configRoot = resolve(repositoryRoot, 'config');
	const lockPath = resolve(configRoot, LOCK_NAME);
	const ownerPath = resolve(lockPath, OWNER_NAME);
	const deadline = Date.now() + ACQUISITION_TIMEOUT_MS;
	for (;;) {
		try {
			await mkdir(lockPath, { mode: 0o700 });
			break;
		} catch (error) {
			if (error?.code !== 'EEXIST') throw error;
			try {
				await assertLockDirectory(lockPath);
			} catch (inspectionError) {
				// The holder may release between mkdir's EEXIST result and our
				// identity check. That is a normal retry, not a broken fence.
				if (inspectionError?.code === 'ENOENT') continue;
				throw inspectionError;
			}
			if (Date.now() >= deadline) {
				throw new Error('Timed out waiting for the professional native promotion lock.',
					{ cause: error });
			}
			await delay(RETRY_MS);
		}
	}
	const identity = await directoryIdentity(lockPath);
	const token = randomUUID();
	const ownerBytes = Buffer.from(`${JSON.stringify({
		schemaVersion: 1,
		kind: 'soundscaper-professional-native-promotion-lock',
		token,
		pid: process.pid,
	}, null, '\t')}\n`, 'utf8');
	try {
		await writeFile(ownerPath, ownerBytes, { flag: 'wx', mode: 0o600 });
		const handle = await open(ownerPath, 'r');
		try { await handle.sync(); } finally { await handle.close(); }
	} catch (error) {
		await rmdir(lockPath).catch(() => undefined);
		throw error;
	}
	let released = false;
	const assertHeld = async () => {
		if (released) throw new Error('The professional native promotion fence was released.');
		const current = await directoryIdentity(lockPath);
		if (current.dev !== identity.dev || current.ino !== identity.ino) {
			throw new Error('The professional native promotion lock changed identity.');
		}
		const before = await lstat(ownerPath);
		if (!before.isFile() || before.isSymbolicLink() || await realpath(ownerPath) !== ownerPath) {
			throw new Error('The professional native promotion fence is not canonical.');
		}
		const observed = await readFile(ownerPath);
		const after = await lstat(ownerPath);
		if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
			|| !observed.equals(ownerBytes)) {
			throw new Error('The professional native promotion fence changed ownership.');
		}
		return token;
	};
	return Object.freeze({
		lockPath,
		assertHeld,
		release: async () => {
			if (released) return;
			await assertHeld();
			await unlink(ownerPath);
			const current = await directoryIdentity(lockPath);
			if (current.dev !== identity.dev || current.ino !== identity.ino) {
				throw new Error('The professional native promotion lock changed before release.');
			}
			await rmdir(lockPath);
			released = true;
		},
	});
}

async function assertLockDirectory(path) {
	const metadata = await lstat(path);
	if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(path) !== path) {
		throw new Error('The professional native promotion lock path is unsafe.');
	}
}

async function directoryIdentity(path) {
	await assertLockDirectory(path);
	const metadata = await lstat(path);
	return Object.freeze({ dev: Number(metadata.dev), ino: Number(metadata.ino) });
}

function delay(milliseconds) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
