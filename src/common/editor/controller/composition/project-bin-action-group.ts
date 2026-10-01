/* SPDX-License-Identifier: AGPL-3.0-only */

import type { createSourceRuntimeComposition } from '../source/source-runtime-composition.ts';
import type { createImportComposition } from '../import/import-composition.ts';
import { deferAsyncControllerMethods, deferControllerMethods } from './internal/deferred-controller-methods.ts';

type ProjectBinService = ReturnType<typeof createImportComposition>['projectBin'];
type ProjectVisualService = ReturnType<typeof createSourceRuntimeComposition>['projectVisual'];

interface EditorProjectBinActionGroupDependencies {
	getProjectBin(): ProjectBinService;
	getProjectVisual(): Pick<ProjectVisualService, 'getProjectBinClipVisualData'>;
}

const editorProjectBinActionGroups = new WeakSet<object>();

/** Build the public Project Bin port without resolving either owning service. */
export function createEditorProjectBinActionGroup(
	dependencies: EditorProjectBinActionGroupDependencies,
) {
	const actions = deferControllerMethods(dependencies.getProjectBin, [
		'moveClipsToProjectBin',
		'placeProjectBinClip',
		'applyProjectBinReplacement',
		'renameProjectBinClip',
		'removeProjectBinClip',
		'setProjectBinClipColor',
		'projectBinInstanceCount',
		'selectProjectBinInstances',
		'removeProjectBinSource',
	]);
	const asynchronous = deferAsyncControllerMethods(dependencies.getProjectBin, [
		'prepareProjectBinReplacement',
		'cancelProjectBinReplacement',
		'canRelinkLinkedAudio',
		'classifyLinkedAudioRelink',
		'relinkLinkedAudio',
		'canRelinkLinkedVideo',
		'classifyLinkedVideoRelink',
		'relinkLinkedVideo',
		'playPauseProjectBinClip',
		'stopProjectBinPreview',
	]);
	const { getProjectBinClipVisualData } = deferControllerMethods(dependencies.getProjectVisual, [
		'getProjectBinClipVisualData',
	]);
	const group = Object.freeze({
		moveFromTimeline: actions.moveClipsToProjectBin,
		place: actions.placeProjectBinClip,
		rename: actions.renameProjectBinClip,
		setColor: actions.setProjectBinClipColor,
		remove: actions.removeProjectBinClip,
		removeFromBin: actions.removeProjectBinClip,
		removeFromProject: actions.removeProjectBinSource,
		selectInstances: actions.selectProjectBinInstances,
		instanceCount: actions.projectBinInstanceCount,
		prepareReplacement: asynchronous.prepareProjectBinReplacement,
		applyReplacement: actions.applyProjectBinReplacement,
		cancelReplacement: asynchronous.cancelProjectBinReplacement,
		canRelinkLinkedAudio: asynchronous.canRelinkLinkedAudio,
		classifyLinkedAudioRelink: asynchronous.classifyLinkedAudioRelink,
		relinkLinkedAudio: asynchronous.relinkLinkedAudio,
		canRelinkLinkedVideo: asynchronous.canRelinkLinkedVideo,
		classifyLinkedVideoRelink: asynchronous.classifyLinkedVideoRelink,
		relinkLinkedVideo: asynchronous.relinkLinkedVideo,
		playPause: asynchronous.playPauseProjectBinClip,
		stopPreview: asynchronous.stopProjectBinPreview,
		getVisualData: getProjectBinClipVisualData,
	});
	editorProjectBinActionGroups.add(group);
	return group;
}

export type EditorProjectBinActionGroup = ReturnType<typeof createEditorProjectBinActionGroup>;

/** Admit only the frozen Project Bin group built by its owner. */
export function assertEditorProjectBinActionGroup(
	value: unknown,
): asserts value is EditorProjectBinActionGroup {
	if (!value || typeof value !== 'object'
		|| typeof Object.getOwnPropertyDescriptor(value, 'getVisualData')?.value !== 'function') {
		throw new TypeError('Missing editor action dependency: projectBin.getVisualData.');
	}
	if (!editorProjectBinActionGroups.has(value)) {
		throw new TypeError('Invalid editor action dependency: projectBin.');
	}
}
