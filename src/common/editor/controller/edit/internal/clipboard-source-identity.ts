/* SPDX-License-Identifier: AGPL-3.0-only */

interface ClipboardSourceIdentity {
	readonly id: string;
	readonly kind?: unknown;
	readonly storageKey?: unknown;
}

/** A matching ID may reuse destination media only when its backing identity agrees. */
export function missingClipboardSourcesForPaste<Source extends ClipboardSourceIdentity>(
	projectSources: readonly Source[],
	clipboardSources: readonly Source[],
): readonly Source[] {
	const existingById = new Map(projectSources.map((source) => [source.id, source]));
	return clipboardSources.filter((source) => {
		const existing = existingById.get(source.id);
		if (!existing) return true;
		if (source.storageKey !== existing.storageKey || source.kind !== existing.kind) {
			throw new RangeError(`Clipboard source ${source.id} refers to different media in the destination project.`);
		}
		return false;
	});
}
