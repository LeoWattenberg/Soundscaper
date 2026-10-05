/* SPDX-License-Identifier: AGPL-3.0-only */

import { desktopOriginalForProject } from '../../../desktop-overwrite-original.ts';
import { selectAudioEditorControllerEditBlock, type AudioEditorControllerEditState } from '../../../edit-blocking.ts';

export interface OriginalOverwriteState extends AudioEditorControllerEditState {
	readonly disposed?: boolean;
	readonly recordingFinishing?: boolean;
}

export interface OriginalOverwriteFileService {
	readonly originalOverwriteAvailable?: boolean;
	prepareOriginalOverwrite?(id: string): PromiseLike<unknown> | unknown;
}

interface OriginalOverwriteRuntime {
	readonly state: OriginalOverwriteState;
	readonly fileService?: OriginalOverwriteFileService | null;
	readonly getProject?: () => Readonly<Record<string, unknown>> | null | undefined;
	readonly handleExportAction: (action: string, settings?: unknown) => Promise<unknown> | unknown;
}

/** Reuse ordinary export rendering and publication, with a main-authorized destination. */
export function createOriginalOverwriteActions(runtime: OriginalOverwriteRuntime) {
	let preparing = false;
	const originalFile = () => {
		const project = runtime.getProject?.();
		return runtime.fileService?.originalOverwriteAvailable && typeof project?.id === 'string'
			? desktopOriginalForProject(runtime.state, project.id)
			: null;
	};
	const available = () => {
		const project = runtime.getProject?.();
		return !preparing && !runtime.state.disposed && !runtime.state.recordingFinishing
			&& !selectAudioEditorControllerEditBlock(runtime.state).blocked
			&& Array.isArray(project?.clips) && project.clips.length > 0 && originalFile() !== null;
	};
	async function overwriteOriginal(): Promise<unknown> {
		if (!available()) return;
		const original = originalFile();
		if (!original || !runtime.fileService?.prepareOriginalOverwrite) return;
		preparing = true;
		try {
			const target = await runtime.fileService.prepareOriginalOverwrite(original.id);
			const project = runtime.getProject?.();
			if (!target || runtime.state.disposed || runtime.state.recordingFinishing
				|| !Array.isArray(project?.clips) || !project.clips.length
				|| selectAudioEditorControllerEditBlock(runtime.state).blocked || originalFile() !== original) return;
			return await runtime.handleExportAction('start', {
				...original.settings, mode: 'mix', range: 'project',
				masteringSequenceId: null, loudnessNormalization: null,
				saveTarget: target,
			});
		} finally { preparing = false; }
	}
	return Object.freeze({ originalFile, overwriteOriginal, overwriteOriginalAvailable: available });
}
