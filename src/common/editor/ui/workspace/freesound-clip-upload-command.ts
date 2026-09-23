/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback } from 'react';

interface UploadClip {
	readonly id: string;
	readonly kind?: string;
	readonly title?: string;
	readonly sourceId?: string;
}

interface UploadProject {
	readonly id: string;
	readonly clips: readonly UploadClip[];
	readonly projectBin?: Readonly<{ readonly clips?: readonly UploadClip[] }>;
	readonly sources?: readonly Readonly<{ readonly id: string }>[];
}

interface FreesoundClipUploadCommandInput {
	readonly controller: object;
	readonly project: UploadProject | null | undefined;
	readonly missingSourceIds?: readonly string[];
	readonly openPanel: (panelId: 'freesound') => void;
	readonly onError: (error: unknown) => void;
}

const pendingCommands = new WeakMap<object, Map<string, Promise<void>>>();

/** Keep the account/queue implementation in its optional chunk while menus expose the command. */
export function queueFreesoundClipUploadCommand(
	input: FreesoundClipUploadCommandInput,
	clipId: string,
): boolean {
	const reference = freesoundClipUploadReference(input.project, clipId, input.missingSourceIds);
	if (!reference) return false;
	input.openPanel('freesound');
	const key = `${reference.projectId}\u0000${reference.clipId}`;
	const pending = pendingCommands.get(input.controller) ?? new Map<string, Promise<void>>();
	if (pending.has(key)) return true;
	const command = import('./freesound-panel-session.ts')
		.then(({ requestFreesoundClipUpload }) => requestFreesoundClipUpload(input.controller, reference));
	pending.set(key, command);
	pendingCommands.set(input.controller, pending);
	void command.then(undefined, input.onError).finally(() => {
		if (pending.get(key) !== command) return;
		pending.delete(key);
		if (!pending.size) pendingCommands.delete(input.controller);
	});
	return true;
}

export function freesoundClipUploadReference(
	project: UploadProject | null | undefined,
	clipId: string,
	missingSourceIds: readonly string[] = [],
) {
	const clip = [...(project?.clips ?? []), ...(project?.projectBin?.clips ?? [])]
		.find((candidate) => candidate.id === clipId);
	const sourceAvailable = project?.sources?.some(({ id }) => id === clip?.sourceId) === true
		&& !missingSourceIds.includes(clip?.sourceId ?? '');
	return clip?.kind === 'audio' && project && sourceAvailable ? Object.freeze({
		projectId: project.id, clipId: clip.id, clipTitle: clip.title,
	}) : null;
}

export function useFreesoundClipUploadCommand(input: FreesoundClipUploadCommandInput) {
	return useCallback(
		(clipId: string) => { queueFreesoundClipUploadCommand(input, clipId); },
		[input.controller, input.missingSourceIds, input.onError, input.openPanel, input.project],
	);
}
