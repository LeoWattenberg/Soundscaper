/* SPDX-License-Identifier: AGPL-3.0-only */

import { stat } from 'node:fs/promises';

/**
 * Staging files are opened owner-only so another local account cannot read a
 * half-written export, and the committing `rename` keeps that inode — so the
 * staging mode would otherwise become the published file's. Restore the mode
 * publication deserves on the still-open staging descriptor: the destination's
 * own mode when an existing file is being replaced, so a deliberately private
 * destination is never widened and an already-published one is never narrowed,
 * and otherwise the umask default a plain write would have produced.
 */
export async function restorePublishedFileMode(handle, targetPath, options = {}) {
	const { statImpl = stat, platform = process.platform, umaskImpl = readUmask } = options;
	if (platform === 'win32' || typeof handle?.chmod !== 'function') return null;
	const mode = (await existingFileMode(targetPath, statImpl)) ?? defaultPublishedMode(umaskImpl);
	if (mode === null) return null;
	try {
		await handle.chmod(mode);
		return mode;
	} catch {
		// A destination that refuses fchmod (CIFS, vfat, some FUSE mounts) still
		// publishes its bytes; it simply cannot carry a mode of its own.
		return null;
	}
}

async function existingFileMode(targetPath, statImpl) {
	try {
		const existing = await statImpl(targetPath);
		return existing.isFile() ? existing.mode & 0o7777 : null;
	} catch {
		// An absent destination is the ordinary first save, not a failure.
		return null;
	}
}

function defaultPublishedMode(umaskImpl) {
	try {
		return 0o666 & ~umaskImpl();
	} catch {
		// Reading the mask is unsupported off the main thread; keep the staging mode.
		return null;
	}
}

function readUmask() {
	return process.umask();
}
