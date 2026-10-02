/* SPDX-License-Identifier: AGPL-3.0-only */

interface InspectorClip {
	readonly id: string;
	readonly sourceId: string;
	readonly title?: string;
}
interface InspectorProject {
	readonly id: string;
	readonly clips: readonly InspectorClip[];
	readonly sources?: readonly { readonly id: string; readonly name?: string }[];
	readonly selection?: { readonly clipIds?: readonly string[] } | null;
}
export interface ClipPropertiesSelectionSnapshot {
	readonly project?: InspectorProject | null;
	readonly selectedClipId?: string | null;
	readonly selectedClipIds?: readonly string[];
}
export interface ClipPropertiesSelection {
	readonly projectId: string | null;
	readonly clips: readonly { readonly id: string; readonly label: string }[];
	readonly preferredClipId: string | null;
}
export interface ClipPropertiesTarget {
	readonly projectId: string | null;
	readonly clipId: string | null;
}

/** The published clip selection owns the tabs; focus only chooses their initial target. */
export function clipPropertiesSelection(snapshot: ClipPropertiesSelectionSnapshot, fallbackLabel: string): ClipPropertiesSelection {
	const project = snapshot.project;
	if (!project) return { projectId: null, clips: [], preferredClipId: null };
	const persistedIds = project.selection?.clipIds ?? [];
	const ids = snapshot.selectedClipIds ?? (persistedIds.length ? persistedIds : snapshot.selectedClipId ? [snapshot.selectedClipId] : []);
	const selected = new Set(ids);
	const clipsById = new Map(project.clips.filter(({ id }) => selected.has(id)).map((clip) => [clip.id, clip]));
	const sourcesById = new Map(project.sources?.map((source) => [source.id, source]));
	const clips = [...selected].flatMap((id) => {
		const clip = clipsById.get(id);
		return clip ? [{ id, label: clip.title || sourcesById.get(clip.sourceId)?.name || fallbackLabel }] : [];
	});
	return {
		projectId: project.id,
		clips,
		preferredClipId: clips.some(({ id }) => id === snapshot.selectedClipId)
			? snapshot.selectedClipId ?? null : clips[0]?.id ?? null,
	};
}

/** Keep a user-chosen tab until it disappears, without carrying it between projects. */
export function reconcileClipPropertiesTarget(target: ClipPropertiesTarget, selection: ClipPropertiesSelection): ClipPropertiesTarget {
	return {
		projectId: selection.projectId,
		clipId: target.projectId === selection.projectId && selection.clips.some(({ id }) => id === target.clipId)
			? target.clipId : selection.preferredClipId,
	};
}
