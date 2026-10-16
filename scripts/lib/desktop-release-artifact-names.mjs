/* SPDX-License-Identifier: AGPL-3.0-only */

import { link, lstat, unlink } from 'node:fs/promises';

/** Preserve native package metadata while using x64/arm64 for all downloads. */
export async function normalizeDesktopReleaseArtifacts(paths) {
	const normalized = [];
	for (const path of paths) {
		const destination = path.replace(/-linux-(x86_64|amd64|aarch64)\.(AppImage|deb)$/u,
			(_match, arch, extension) => `-linux-${arch === 'aarch64' ? 'arm64' : 'x64'}.${extension}`);
		if (destination !== path) {
			const metadata = await lstat(path);
			if (!metadata.isFile() || metadata.isSymbolicLink()) {
				throw new Error('Release artifact normalization requires a regular package file.');
			}
			// Linking fails if the canonical name already exists; package bytes and
			// signatures stay untouched, and an existing artifact is never replaced.
			await link(path, destination);
			await unlink(path);
		}
		normalized.push(destination);
	}
	return normalized;
}
