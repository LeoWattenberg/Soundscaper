/* SPDX-License-Identifier: AGPL-3.0-only */

const EXPORT_DIRECTORY_NAME = 'audio-editor-exports';
const EXPORT_FILE_LOCK_PREFIX = 'audio-editor-export-file:';
const UNLOCKED_EXPORT_MINIMUM_AGE_MS = 24 * 60 * 60 * 1000;
const FAILED_SCAN_RETRY_MS = 60 * 1000;
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;

interface RecoveryLoopOptions {
	readonly now?: () => number;
	readonly schedule?: (callback: () => void, delay: number) => void;
}

/** Run once now, then revisit skipped files when they become eligible. */
export function createTemporaryExportRecoveryLoop(
	scan: () => Promise<number | null>,
	options: RecoveryLoopOptions = {},
): () => Promise<void> | undefined {
	const now = options.now ?? Date.now;
	const schedule = options.schedule ?? ((callback: () => void, delay: number) => {
		globalThis.setTimeout(callback, delay);
	});
	let running = false;
	let scheduled = false;
	const start = (): Promise<void> | undefined => {
		if (running || scheduled) return;
		running = true;
		return Promise.resolve().then(scan).then(
			(nextEligibleAt) => {
				running = false;
				if (nextEligibleAt !== null) arm(nextEligibleAt);
			},
			() => {
				running = false;
				arm(now() + FAILED_SCAN_RETRY_MS);
			},
		);
	};
	const arm = (at: number): void => {
		scheduled = true;
		const delay = Math.max(1, Math.min(MAX_TIMER_DELAY_MS, Math.ceil(at - now())));
		schedule(() => {
			scheduled = false;
			void start();
		}, delay);
	};
	return start;
}

/** A page reload drops its leases, making abandoned OPFS exports removable. */
export async function recoverAbandonedTemporaryExports(): Promise<number | null> {
	const storage = globalThis.navigator?.storage as StorageManager & {
		getDirectory?(): Promise<FileSystemDirectoryHandle>;
	} | undefined;
	if (typeof storage?.getDirectory !== 'function') return null;
	const root = await storage.getDirectory();
	let directory: FileSystemDirectoryHandle;
	try { directory = await root.getDirectoryHandle(EXPORT_DIRECTORY_NAME); }
	catch (error) {
		if (error instanceof Error && error.name === 'NotFoundError') return null;
		throw error;
	}
	const locks = globalThis.navigator?.locks;
	const scanTime = Date.now();
	const unlockedCutoff = scanTime - UNLOCKED_EXPORT_MINIMUM_AGE_MS;
	const errors: unknown[] = [];
	let nextEligibleAt: number | null = null;
	for await (const [name, handle] of directory.entries()) {
		if (handle.kind !== 'file') continue;
		try {
			if (locks?.request) {
				const removed = await locks.request(`${EXPORT_FILE_LOCK_PREFIX}${name}`, { ifAvailable: true }, async (lock) => {
					if (!lock) return false;
					await directory.removeEntry(name);
					return true;
				});
				if (!removed) {
					const retryAt = scanTime + FAILED_SCAN_RETRY_MS;
					nextEligibleAt = Math.min(nextEligibleAt ?? retryAt, retryAt);
				}
			} else {
				// Without Web Locks, another tab may still own a recently written file.
				const file = await (handle as FileSystemFileHandle).getFile();
				if (Number.isFinite(file.lastModified)) {
					if (file.lastModified <= unlockedCutoff) await directory.removeEntry(name);
					else {
						const eligibleAt = file.lastModified + UNLOCKED_EXPORT_MINIMUM_AGE_MS;
						nextEligibleAt = Math.min(nextEligibleAt ?? eligibleAt, eligibleAt);
					}
				}
			}
		} catch (error) {
			errors.push(error);
		}
	}
	if (errors.length) throw new AggregateError(errors, 'Could not remove all abandoned temporary exports.');
	return nextEligibleAt;
}

const startRecovery = createTemporaryExportRecoveryLoop(recoverAbandonedTemporaryExports);

export function startTemporaryExportRecovery(): void {
	void startRecovery();
}
