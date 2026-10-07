/* SPDX-License-Identifier: AGPL-3.0-only */

/** Preserve keyboard continuation when a folder menu removes its focused row. */
export function removeTimelineFolderWithFocus<Result>(
	ownerDocument: Document | undefined,
	folderId: string,
	remove: () => Result,
): Result {
	const focused = ownerDocument?.activeElement;
	const editor = focused?.closest('[data-audio-editor]');
	const rows = [...editor?.querySelectorAll<HTMLElement>('[data-track-folder-row]') ?? []];
	const index = rows.findIndex(row => row.dataset.folderId === folderId);
	const removed = rows[index];
	const fromFolder = removed?.contains(focused ?? null);
	const fromMenu = focused?.closest('.audio-editor-track-folder-menu');
	const candidates: HTMLElement[] = [];
	if (removed && (fromFolder || fromMenu)) {
		const level = Number(removed.getAttribute('aria-level'));
		const previous = rows.slice(0, index).reverse();
		const parent = previous.find(row => Number(row.getAttribute('aria-level')) < level);
		if (parent) candidates.push(parent);
		candidates.push(...rows.slice(index + 1).filter(row => Number(row.getAttribute('aria-level')) <= level), ...previous);
		for (const row of editor?.querySelectorAll<HTMLElement>('[data-track-row]') ?? []) {
			const track = row.querySelector<HTMLElement>('.track');
			if (track) candidates.push(track);
		}
		const ruler = editor?.querySelector<HTMLElement>('[data-ruler-focus]');
		if (ruler) candidates.push(ruler);
	}
	const result = remove();
	if (ownerDocument && candidates.length) requestAnimationFrame(() => {
		const active = ownerDocument.activeElement;
		if (active !== focused && active !== ownerDocument.body) return;
		if (removed?.isConnected) return;
		const target = candidates.find(candidate => candidate.isConnected && !candidate.closest('[hidden], [aria-hidden="true"]'));
		target?.focus({ preventScroll: true });
	});
	return result;
}
