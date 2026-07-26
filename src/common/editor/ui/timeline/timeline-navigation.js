import { mediaTrackBlockDestination } from '../timeline-track-block-geometry.ts';

export function trackNavigationRow(root, trackIndex) {
	return root?.querySelector(`.audio-editor-track-row[data-track-index="${trackIndex}"]`) || null;
}

export function clipGroups(root) {
	return [...(root?.querySelectorAll('[data-clip-id][role="group"]') || [])];
}

export function normalizeClipSemantics(root, { flat, tabIndex }) {
	const clips = [...root.querySelectorAll('[data-clip-id]')]
		.filter((element) => element.parentElement?.closest('[data-clip-id]') === null);
	const activeClip = clips.includes(document.activeElement) ? document.activeElement : null;
	clips.forEach((clip, index) => {
		if (clip.getAttribute('role') !== 'group') clip.setAttribute('role', 'group');
		const nextTabIndex = flat ? 0 : clip === activeClip || (!activeClip && index === 0) ? tabIndex : -1;
		if (clip.tabIndex !== nextTabIndex) clip.tabIndex = nextTabIndex;
		for (const control of clip.querySelectorAll('button, input, select, textarea, [role="button"]')) {
			if (control.tabIndex !== -1) control.tabIndex = -1;
		}
	});
}

export function focusPanelControl(panel, last = false) {
	return focusCandidate(
		panel,
		'button:not([disabled]):not([aria-label="Track icon"]), input:not([disabled]), [role="slider"]:not([aria-disabled="true"])',
		last,
	) || focusFirst(panel);
}

export function focusCandidate(root, selector, last = false) {
	const candidates = [...(root?.querySelectorAll(selector) || [])]
		.filter((element) => element.getAttribute('aria-disabled') !== 'true');
	if (last) candidates.reverse();
	for (const candidate of candidates) {
		if (focusFirst(candidate)) return true;
	}
	return false;
}

export function focusFirst(element) {
	if (!element || typeof element.focus !== 'function') return false;
	try {
		element.focus({ preventScroll: true });
	} catch {
		element.focus();
	}
	if (document.activeElement !== element) return false;
	element.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
	return true;
}

export function moveMediaTrackBlock(controller, tracks, trackId, direction) {
	const destination = mediaTrackBlockDestination(tracks, trackId, direction);
	if (destination === null) return null;
	return controller.actions.track.reorder(trackId, destination);
}
