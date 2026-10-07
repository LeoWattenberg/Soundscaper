/* SPDX-License-Identifier: AGPL-3.0-only */

/** Keep the keyboard subject through publication that removes its clip node. */
export function createTimelineClipRemovalFocus(readRoot: () => HTMLElement | null) {
	let focused: HTMLElement | null = null;
	let orderedClips: readonly HTMLElement[] = [];
	return Object.freeze({ remember, restore });

	function remember(target: HTMLElement): void {
		const root = readRoot();
		if (!root?.contains(target) || !target.hasAttribute('data-clip-id') || target.getAttribute('role') !== 'group') return;
		focused = target;
		orderedClips = clipGroups(root);
	}

	function restore(): void {
		const root = readRoot();
		if (!root?.isConnected || !focused || focused.isConnected) return;
		const active = root.ownerDocument.activeElement;
		const oldFocus = focused;
		const previousOrder = orderedClips;
		focused = null;
		orderedClips = [];
		if (active !== oldFocus && active !== root.ownerDocument.body) return;
		const clips = clipGroups(root);
		const index = previousOrder.indexOf(oldFocus);
		const neighbours = [...previousOrder.slice(index + 1), ...previousOrder.slice(0, index).reverse()];
		const target = clips.find(clip => clip.dataset.clipId === oldFocus.dataset.clipId)
			?? neighbours.find(clip => clips.includes(clip))
			?? clips[0]
			?? root.querySelector<HTMLElement>('.track');
		if (target?.isConnected && !target.closest('[hidden], [aria-hidden="true"]')) {
			target.focus({ preventScroll: true });
		}
	}
}

function clipGroups(root: HTMLElement): HTMLElement[] {
	return [...root.querySelectorAll<HTMLElement>('[data-clip-id]')].filter(clip => clip.getAttribute('role') === 'group');
}
