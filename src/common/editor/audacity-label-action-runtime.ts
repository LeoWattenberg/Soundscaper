/* SPDX-License-Identifier: AGPL-3.0-only */

interface LabelTarget {
	readonly trackId: string;
	readonly labelId: string;
}

interface LabelActionProject {
	readonly tracks: readonly Readonly<{
		readonly id: string;
		readonly type: string;
		readonly labels?: readonly Readonly<{ readonly id: string }>[];
	}>[];
}

interface LabelActionPorts {
	getProject(): LabelActionProject | null | undefined;
	getFocusedLabel?(): LabelTarget | null;
	hasSelectedClip(): boolean;
	addLabel(trackId?: string | null, options?: Record<string, unknown>): string | null;
	updateLabel(trackId: string, labelId: string, changes: Readonly<{ title: string }>): unknown;
	issue(type: string, payload: LabelTarget): unknown;
	renameClip(title: unknown): unknown;
}

/** Connect label creation and contextual item renaming to the inline title editor. */
export function createAudacityLabelActionRuntime(ports: LabelActionPorts) {
	function add(trackId: string | null = null, options: Record<string, unknown> = {}): string | null {
		const labelId = ports.addLabel(trackId, options);
		if (!labelId) return labelId;
		const targetTrack = ports.getProject()?.tracks.find((track) => (
			track.type === 'label' && track.labels?.some((label) => label.id === labelId)
		));
		if (targetTrack) ports.issue('edit-label', { trackId: targetTrack.id, labelId });
		return labelId;
	}

	function renameItem(title: unknown = null): unknown {
		const target = ports.getFocusedLabel?.();
		const track = target && ports.getProject()?.tracks.find((candidate) => (
			candidate.id === target.trackId && candidate.type === 'label'
			&& candidate.labels?.some((label) => label.id === target.labelId)
		));
		if (!target || !track) return ports.hasSelectedClip() ? ports.renameClip(title) : null;
		return title == null
			? ports.issue('edit-label', target)
			: ports.updateLabel(target.trackId, target.labelId, { title: String(title) });
	}

	return Object.freeze({ add, renameItem, pasteNew: (text = '') => add(null, { title: String(text) }) });
}
