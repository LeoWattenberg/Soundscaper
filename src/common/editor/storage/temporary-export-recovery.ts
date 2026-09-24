/* SPDX-License-Identifier: AGPL-3.0-only */

const EXPORT_DIRECTORY_NAME = 'audio-editor-exports';
const EXPORT_FILE_LOCK_PREFIX = 'audio-editor-export-file:';
const UNLOCKED_EXPORT_MINIMUM_AGE_MS = 24 * 60 * 60 * 1000;

/** A page reload drops its leases, making abandoned OPFS exports removable. */
export async function recoverAbandonedTemporaryExports(): Promise<void> {
	const storage = globalThis.navigator?.storage as StorageManager & {
		getDirectory?(): Promise<FileSystemDirectoryHandle>;
	} | undefined;
	if (typeof storage?.getDirectory !== 'function') return;
	const root = await storage.getDirectory();
	let directory: FileSystemDirectoryHandle;
	try { directory = await root.getDirectoryHandle(EXPORT_DIRECTORY_NAME); }
	catch (error) {
		if (error instanceof Error && error.name === 'NotFoundError') return;
		throw error;
	}
	const locks = globalThis.navigator?.locks;
	const unlockedCutoff = Date.now() - UNLOCKED_EXPORT_MINIMUM_AGE_MS;
	const errors: unknown[] = [];
	for await (const [name, handle] of directory.entries()) {
		if (handle.kind !== 'file') continue;
		try {
			if (locks?.request) {
				await locks.request(`${EXPORT_FILE_LOCK_PREFIX}${name}`, { ifAvailable: true }, async (lock) => {
					if (lock) await directory.removeEntry(name);
				});
			} else {
				// Without Web Locks, another tab may still own a recently written file.
				const file = await (handle as FileSystemFileHandle).getFile();
				if (Number.isFinite(file.lastModified) && file.lastModified <= unlockedCutoff) {
					await directory.removeEntry(name);
				}
			}
		} catch (error) {
			errors.push(error);
		}
	}
	if (errors.length) throw new AggregateError(errors, 'Could not remove all abandoned temporary exports.');
}
