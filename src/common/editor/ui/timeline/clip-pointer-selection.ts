/* SPDX-License-Identifier: AGPL-3.0-only */
interface PointerSelectionProject {
	readonly tracks: readonly Readonly<{ id: string; type?: string; clipIds?: readonly string[] }>[];
	readonly clips: readonly Readonly<{ id: string; timelineStartFrame: number; durationFrames: number }>[];
}
interface PointerSelection {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly trackIds: readonly string[];
	readonly clipIds: readonly string[];
}

/** Audacity 20ce5547 separates audio ranges, clip picks and track picks. */
export function clipBodyClickSelection(project: PointerSelectionProject, clipId: string, detail: number): PointerSelection | null {
	const clip = project.clips.find(candidate => candidate.id === clipId);
	const track = project.tracks.find(candidate => candidate.clipIds?.includes(clipId));
	if (!clip || !track || detail < 2) return null;
	return detail >= 3 ? { startFrame: 0, endFrame: 0, trackIds: [track.id], clipIds: [...track.clipIds ?? []] }
		: { startFrame: clip.timelineStartFrame, endFrame: clip.timelineStartFrame + clip.durationFrames, trackIds: [track.id], clipIds: [] };
}

export function trackPanelClickSelection(project: PointerSelectionProject, trackId: string, detail: number): PointerSelection | null {
	if (detail < 2) return null;
	if (detail >= 3) return { startFrame: 0, endFrame: 0, trackIds: project.tracks.map(track => track.id), clipIds: [] };
	const track = project.tracks.find(candidate => candidate.id === trackId);
	const clips = project.clips.filter(clip => track?.clipIds?.includes(clip.id));
	if (!clips.length) return null;
	return { startFrame: Math.min(...clips.map(clip => clip.timelineStartFrame)),
		endFrame: Math.max(...clips.map(clip => clip.timelineStartFrame + clip.durationFrames)), trackIds: [trackId], clipIds: [] };
}

export const clipPointerHasMoved = (session: Readonly<{ startX: number; startY?: number }>, x: number, y: number) => (
	Math.hypot(x - session.startX, y - (session.startY ?? y)) >= 3
);
const draggedDocuments = new WeakSet<Document>();
export const markClipPointerDrag = (document: Document) => { draggedDocuments.add(document); };
export const resetClipPointerDrag = (document: Document) => { draggedDocuments.delete(document); };
export function consumeClipPointerDrag(document: Document): boolean {
	const dragged = draggedDocuments.has(document);
	draggedDocuments.delete(document);
	return dragged;
}

interface ClipClickEvent {
	readonly target: EventTarget;
	readonly currentTarget: Element;
	readonly ctrlKey: boolean;
	readonly metaKey: boolean;
	readonly shiftKey: boolean;
	readonly detail: number;
	preventDefault(): void;
	stopPropagation(): void;
}
interface ClipPointerSelectionActions {
	selectClip(clipId: string, options: Readonly<{ toggle: boolean }>): unknown;
	setExactSelection(start: number, end: number, details: PointerSelection): unknown;
}

export function handleClipPointerClick(event: ClipClickEvent, project: PointerSelectionProject,
	timeline: ClipPointerSelectionActions, run: (operation: () => unknown) => unknown): void {
	if (consumeClipPointerDrag(event.currentTarget.ownerDocument)) { event.preventDefault(); event.stopPropagation(); return; }
	if (!(event.target instanceof Element)) return;
	const clipElement = event.target.closest<HTMLElement>('[data-clip-id]');
	if (!clipElement || event.target.closest('button, input, textarea, select, .clip-header')) return;
	const id = clipElement.dataset.clipId;
	if (!id) return;
	if ((event.ctrlKey || event.metaKey) && !event.shiftKey) {
		event.stopPropagation();
		run(() => timeline.selectClip(id, { toggle: true }));
		return;
	}
	const selection = clipBodyClickSelection(project, id, event.detail);
	if (!selection) return;
	event.preventDefault(); event.stopPropagation();
	run(() => timeline.setExactSelection(selection.startFrame, selection.endFrame, selection));
}

/** Capture only after a drag, leaving native click counts and targets intact. */
export function captureClipPointerDrag(session: Readonly<{ captureTarget?: Element; pointerId?: number }>): void {
	if (!session.captureTarget || session.pointerId === undefined) return;
	try { session.captureTarget.setPointerCapture?.(session.pointerId); }
	catch { /* A queued final move can flush after the pointer was released. */ }
}
