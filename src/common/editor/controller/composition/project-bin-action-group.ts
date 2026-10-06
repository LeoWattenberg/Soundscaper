/* SPDX-License-Identifier: AGPL-3.0-only */

import type { createSourceRuntimeComposition } from '../source/source-runtime-composition.ts';
import type { createImportComposition } from '../import/import-composition.ts';
import { deferAsyncControllerMethods, deferControllerMethods } from './internal/deferred-controller-methods.ts';
import { registerProductProjectBinActionGroup, type ProductProjectBinActions } from './internal/product-project-bin-actions.ts';

export { bindProductProjectBinActions } from './internal/product-project-bin-actions.ts';
export type { ProductProjectBinActions } from './internal/product-project-bin-actions.ts';

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
	let productActions: ProductProjectBinActions | null = null;
	const resolve = <Result>(result: Result | undefined, fallback: () => Result): Result => result === undefined ? fallback() : result;
	const group = Object.freeze({
		moveFromTimeline: (...args: Parameters<typeof actions.moveClipsToProjectBin>) => {
			const result = productActions?.moveFromTimeline(...args);
			return result === undefined ? actions.moveClipsToProjectBin(...args) : result;
		},
		place: (...args: Parameters<typeof actions.placeProjectBinClip>) => {
			const result = productActions?.place(...args);
			return result === undefined ? actions.placeProjectBinClip(...args) : result;
		},
		rename: (...args: Parameters<typeof actions.renameProjectBinClip>) => resolve(productActions?.rename?.(...args), () => actions.renameProjectBinClip(...args)),
		setColor: actions.setProjectBinClipColor,
		remove: (id: string) => resolve(productActions?.removeFromBin?.(id), () => actions.removeProjectBinClip(id)),
		removeFromBin: (id: string) => resolve(productActions?.removeFromBin?.(id), () => actions.removeProjectBinClip(id)),
		removeFromProject: (id: string) => resolve(productActions?.removeFromProject?.(id), () => actions.removeProjectBinSource(id)),
		selectInstances: (id: string) => resolve(productActions?.selectInstances?.(id), () => actions.selectProjectBinInstances(id)),
		instanceCount: (id: string) => resolve(productActions?.instanceCount?.(id), () => actions.projectBinInstanceCount(id)),
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
	registerProductProjectBinActionGroup(group, runtime => { productActions = runtime; });
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
