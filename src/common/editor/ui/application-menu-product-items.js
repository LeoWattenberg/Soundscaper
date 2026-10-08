/* SPDX-License-Identifier: AGPL-3.0-only */

import { createFramescaperNestedSequenceMenuItems } from './framescaper-nested-sequence-menu.ts';
import { createFramescaperMulticameraMenuItems } from './framescaper-multicamera-menu.ts';
import { createFramescaperCandidateAuthoringMenuItems } from './framescaper-candidate-authoring-menu.ts';
import { createFramescaperFinishingMenuItems } from './framescaper-finishing-menu.ts';
import { createFramescaperNativeServicesMenuItems } from './framescaper-native-services-menu.ts';
import { createSoundscaperNativeServicesMenuItems } from './soundscaper-native-services-menu.ts';
import { createSoundscaperWorkflowApplicationMenuItems } from './soundscaper-workflow-product-runtime.tsx';
import { resolveSelectionRange } from '../selection-range.ts';
import { appendParallelStackProcessingMenu } from './parallel-stack-menu.ts';
import { createAraApplicationMenuItems } from './ara-application-menu.ts';

export function createApplicationMenuProductTrackItems({ productId, project, editBlocked, copy, actions }) {
	return createApplicationMenuProductItems({ productId, project, editBlocked, copy, actions }).tracks;
}

export function createApplicationMenuProductItems({
	productId, capabilities = {}, project, snapshot = {}, editBlocked, copy, actions,
}) {
	const nestedSequences = createFramescaperNestedSequenceMenuItems({
		productId, project, editingBlocked: editBlocked, copy: {
			nestedSequences: copy.nestedSequences,
			createSequence: copy.createSequence,
			addNestedSequence: copy.addNestedSequence,
			updateNestedSequence: copy.updateNestedSequence,
			removeNestedSequence: copy.removeNestedSequence,
			deleteSequence: copy.deleteSequence,
		},
	}, { execute: actions.executeNestedSequenceCommand });
	const multicamera = createFramescaperMulticameraMenuItems({
		productId, project, editingBlocked: editBlocked, copy: {
			multicamera: copy.multicamera,
			createMulticamera: copy.createMulticamera,
			switchMulticamera: copy.switchMulticamera,
			nudgeMulticameraEarlier: copy.nudgeMulticameraEarlier,
			nudgeMulticameraLater: copy.nudgeMulticameraLater,
			removeMulticamera: copy.removeMulticamera,
		},
	}, { execute: actions.executeMulticameraCommand });
	const workflowRuntime = actions.soundscaperWorkflow || null;
	const soundscaperWorkflows = createSoundscaperWorkflowApplicationMenuItems({
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
	const nativeRuntime = actions.framescaperNativeServices || null;
	const authoringRuntime = actions.framescaperCandidateAuthoring || null;
	const candidateAuthoring = createFramescaperCandidateAuthoringMenuItems({
		productId, project, projectCapabilities: capabilities, editingBlocked: editBlocked,
		readOnly: snapshot.readOnly === true,
		actionSurfaces: authoringRuntime?.surfaces ?? [], copy,
	}, { open: (surface) => authoringRuntime?.open(surface) });
	const selectedFinishing = createFramescaperFinishingMenuItems({
		productId, project, capabilities, editingBlocked: editBlocked,
		readOnly: snapshot.readOnly === true, copy,
	}, { open: (surface) => actions.openFramescaperFinishing?.(surface) });
	const nativeServices = createFramescaperNativeServicesMenuItems({
		productId,
		runtimeAvailable: nativeRuntime !== null,
		snapshot: nativeRuntime?.capabilitySnapshot ?? null,
		project,
		projectCapabilities: capabilities,
		editingBlocked: editBlocked,
		readOnly: snapshot.readOnly === true,
		externalDisplays: nativeRuntime?.externalDisplays ?? [],
		activeExternalDisplayId: nativeRuntime?.activeExternalDisplayId ?? null,
		lifecycleMethods: nativeRuntime?.lifecycleMethods ?? [],
		projectActionSurfaces: nativeRuntime?.projectActionSurfaces ?? [],
		copy,
	}, {
		open: (surface) => nativeRuntime?.open(surface),
		openExternalDisplay: (displayId) => nativeRuntime?.openExternalDisplay(displayId),
	});
	const soundscaperNativeRuntime = actions.soundscaperNativeServices || null;
	const araItems = createAraApplicationMenuItems({ productId, project, available: Boolean(actions.araClipEditing),
		selectedClipId: snapshot.selectedClipId, editingBlocked: editBlocked, readOnly: snapshot.readOnly === true, copy },
		() => actions.araClipEditing?.open());
	const soundscaperNativeServices = createSoundscaperNativeServicesMenuItems({
		productId,
		runtimeAvailable: soundscaperNativeRuntime !== null,
		snapshot: soundscaperNativeRuntime?.snapshot ?? null,
		analyzerRuntimeAvailable: soundscaperNativeRuntime?.vampAnalyzerAvailable,
		analyzerSelectionAvailable: Boolean(resolveSelectionRange(project, {
			selectedClipId: snapshot.selectedClipId ?? null,
		})),
		editingBlocked: editBlocked,
		readOnly: snapshot.readOnly === true,
		copy,
	}, { open: (surface) => soundscaperNativeRuntime?.open(surface) });
	return Object.freeze({
		...soundscaperWorkflows,
		tracks: Object.freeze([nestedSequences, multicamera, ...candidateAuthoring.tracks,
			...selectedFinishing.tracks, ...soundscaperWorkflows.tracks].filter(Boolean)),
		generate: candidateAuthoring.generate,
		effect: Object.freeze([...candidateAuthoring.effect, ...selectedFinishing.effect,
			...soundscaperWorkflows.effect, ...nativeServices.effect, ...soundscaperNativeServices.effect, ...araItems]),
		analyze: Object.freeze([...selectedFinishing.analyze, ...soundscaperWorkflows.analyze,
			...soundscaperNativeServices.analyze]),
		mixer: Object.freeze([...selectedFinishing.mixer, ...soundscaperWorkflows.mixer]),
		tools: Object.freeze([...selectedFinishing.tools, ...soundscaperWorkflows.tools,
			...nativeServices.tools, ...appendParallelStackProcessingMenu(soundscaperNativeServices.tools,
				actions.parallelStackProcessing ? { ...actions.parallelStackProcessing, productId, copy } : null,
				(patch) => actions.parallelStackProcessing?.change(patch))]),
		fileImport: nativeServices.fileImport,
		fileExport: nativeServices.fileExport,
		view: nativeServices.view,
	});
}

export function extendApplicationMenuProductPanelItems(panelId, item, productItems) {
	if (panelId !== 'mixer' || !productItems.mixer.length) return [item];
	// Keep the panel toggle and its product commands as peers. Wrapping them in
	// a second "Mixer" submenu made the first submenu row a duplicate of its parent.
	return [item, ...productItems.mixer];
}
