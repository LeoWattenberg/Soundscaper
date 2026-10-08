/* SPDX-License-Identifier: AGPL-3.0-only */

import { createSoundscaperNativeServicesMenuItems } from '../common/editor/ui/soundscaper-native-services-menu.ts';
import { createSoundscaperWorkflowApplicationMenuItems } from '../common/editor/ui/soundscaper-workflow-application-menu.ts';
import { appendParallelStackProcessingMenu } from '../common/editor/ui/parallel-stack-menu.ts';
import { createAraApplicationMenuItems } from '../common/editor/ui/ara-application-menu.ts';

const EMPTY_ITEMS = Object.freeze([]);

export function createFramescaperEditControlMenuItems() {
	return Object.freeze({ link: null, visibility: null });
}

export function createFramescaperVideoTrimApplicationMenuItems() {
	return EMPTY_ITEMS;
}

export function createFramescaperVideoFinishingMenuItems() {
	return EMPTY_ITEMS;
}

export function createApplicationMenuProductItems({
	productId, capabilities = {}, project, snapshot = {}, editBlocked, copy, actions,
}) {
	const workflowRuntime = actions.soundscaperWorkflow || null;
	const workflows = createSoundscaperWorkflowApplicationMenuItems({
		productId,
		capabilities: workflowRuntime ? capabilities : {},
		project,
		selectedTrackId: snapshot.selectedTrackId ?? null,
		freezeStatus: workflowRuntime?.freezeStatus,
		freezeActionsAvailable: workflowRuntime?.freezeActionsAvailable === true,
		editingBlocked: editBlocked,
		readOnly: snapshot.readOnly === true,
		copy,
	}, {
		openMasteringSequences: () => workflowRuntime?.openMasteringSequences?.(),
		freeze: (operation, trackId) => workflowRuntime?.freeze(operation, trackId),
	});
	const nativeRuntime = actions.soundscaperNativeServices || null;
	const nativeServices = createSoundscaperNativeServicesMenuItems({
		productId,
		runtimeAvailable: nativeRuntime !== null,
		snapshot: nativeRuntime?.snapshot ?? null,
		editingBlocked: editBlocked,
		readOnly: snapshot.readOnly === true,
		copy,
	}, { open: (surface) => nativeRuntime?.open(surface) });
	const araItems = createAraApplicationMenuItems({ productId, project, available: Boolean(actions.araClipEditing),
		selectedClipId: snapshot.selectedClipId, editingBlocked: editBlocked, readOnly: snapshot.readOnly === true, copy },
		() => actions.araClipEditing?.open());
	return Object.freeze({
		...workflows,
		tracks: workflows.tracks,
		generate: EMPTY_ITEMS,
		effect: Object.freeze([...workflows.effect, ...nativeServices.effect, ...araItems]),
		analyze: workflows.analyze,
		mixer: workflows.mixer,
		tools: Object.freeze([...workflows.tools, ...appendParallelStackProcessingMenu(nativeServices.tools,
			actions.parallelStackProcessing ? { ...actions.parallelStackProcessing, productId, copy } : null,
			(patch) => actions.parallelStackProcessing?.change(patch))]),
		fileImport: EMPTY_ITEMS,
		fileExport: EMPTY_ITEMS,
		view: EMPTY_ITEMS,
	});
}

export function extendApplicationMenuProductPanelItems(panelId, item, productItems) {
	if (panelId !== 'mixer' || !productItems.mixer.length) return [item];
	return [item, ...productItems.mixer];
}
