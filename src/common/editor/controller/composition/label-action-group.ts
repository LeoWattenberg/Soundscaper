/* SPDX-License-Identifier: AGPL-3.0-only */

import type { LabelService } from '../edit/internal/label-service.ts';
import type { EditorTrackService } from '../track-audio/internal/track-service.ts';
import { deferAsyncControllerMethods, deferControllerMethods } from './internal/deferred-controller-methods.ts';

type LabelMutationCommand =
	| Readonly<{
		type: 'label/update';
		trackId: string | null;
		labelId: string;
		changes: Readonly<Record<string, unknown>>;
	}>
	| Readonly<{
		type: 'label/remove';
		trackId: string | null;
		labelId: string;
	}>;

interface EditorLabelActionGroupDependencies {
	getTrack(): Pick<EditorTrackService, 'addLabel'>;
	getLabelService(): LabelService;
	commit(command: LabelMutationCommand): unknown;
}

const editorLabelActionGroups = new WeakSet<object>();

/** Build the public label port without resolving its mutually dependent owners. */
export function createEditorLabelActionGroup(dependencies: EditorLabelActionGroupDependencies) {
	const { addLabel } = deferControllerMethods(dependencies.getTrack, ['addLabel']);
	const { importLabelFile, importCueFile, exportLabels } = deferAsyncControllerMethods(
		dependencies.getLabelService,
		['importLabelFile', 'importCueFile', 'exportLabels'],
	);
	const actions = Object.freeze({
		add: addLabel,
		update: (trackId: string | null, labelId: string, changes: Readonly<Record<string, unknown>>) => (
			dependencies.commit({ type: 'label/update', trackId, labelId, changes })
		),
		remove: (trackId: string | null, labelId: string) => (
			dependencies.commit({ type: 'label/remove', trackId, labelId })
		),
		importFile: importLabelFile,
		importCueFile,
		export: exportLabels,
	});
	editorLabelActionGroups.add(actions);
	return actions;
}

export type EditorLabelActionGroup = ReturnType<typeof createEditorLabelActionGroup>;

/** Admit only the frozen group built by this owner, retaining the known CUE diagnostic. */
export function assertEditorLabelActionGroup(value: unknown): asserts value is EditorLabelActionGroup {
	if (!value || typeof value !== 'object'
		|| typeof Object.getOwnPropertyDescriptor(value, 'importCueFile')?.value !== 'function') {
		throw new TypeError('Missing editor action dependency: labels.importCueFile.');
	}
	if (!editorLabelActionGroups.has(value)) {
		throw new TypeError('Invalid editor action dependency: labels.');
	}
}
