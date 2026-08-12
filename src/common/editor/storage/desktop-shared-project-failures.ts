/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DesktopSharedMediaAcquisition } from './desktop-shared-project-media-transfer.ts';

export async function rollbackDesktopSharedMediaAcquisition(
	acquisition: DesktopSharedMediaAcquisition | null,
	primary: unknown,
): Promise<never> {
	try {
		await acquisition?.rollback();
	} catch (cleanupError) {
		throw new AggregateError(
			[primary, cleanupError],
			'Desktop shared project load and managed-source rollback both failed.',
		);
	}
	throw primary;
}

/** A shared delete succeeded, but stale local shadow data could not be removed. */
export class DesktopSharedProjectLocalCleanupError extends Error {
	readonly projectId: string;
	readonly remoteDeleted = true;

	constructor(projectId: string, cause: unknown) {
		super(`Desktop shared project ${projectId} was deleted, but local shadow cleanup failed.`, { cause });
		this.name = 'DesktopSharedProjectLocalCleanupError';
		this.projectId = projectId;
	}
}
