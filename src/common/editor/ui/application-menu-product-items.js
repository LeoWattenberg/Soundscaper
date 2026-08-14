/* SPDX-License-Identifier: AGPL-3.0-only */

import { createFramescaperNestedSequenceMenuItems } from './framescaper-nested-sequence-menu.ts';
import { createFramescaperMulticameraMenuItems } from './framescaper-multicamera-menu.ts';
import { createSoundscaperProductionApplicationMenuItems } from './soundscaper-production-application-menu.ts';

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
	const productionRuntime = actions.soundscaperProduction || null;
	const production = createSoundscaperProductionApplicationMenuItems({
		productId,
		capabilities: productionRuntime ? {
			...capabilities,
			reviewedEffectPackages: productionRuntime.reviewedPackagesAvailable === true,
		} : {},
		project,
		selectedTrackId: snapshot.selectedTrackId ?? null,
		automationMode: productionRuntime?.automationMode,
		freezeStatus: productionRuntime?.freezeStatus,
		freezeActionsAvailable: productionRuntime?.freezeActionsAvailable === true,
		editingBlocked: editBlocked,
		readOnly: snapshot.readOnly === true,
		copy,
	}, {
		open: (surface) => productionRuntime?.open(surface),
		setAutomationMode: (mode) => productionRuntime?.setAutomationMode(mode),
		freeze: (operation, trackId) => productionRuntime?.freeze(operation, trackId),
	});
	return Object.freeze({
		...production,
		tracks: Object.freeze([nestedSequences, multicamera, ...production.tracks].filter(Boolean)),
	});
}

export function extendApplicationMenuProductPanelItems(panelId, item, productItems) {
	if (panelId !== 'mixer' || !productItems.mixer.length) return [item];
	// Keep the panel toggle and its product commands as peers. Wrapping them in
	// a second "Mixer" submenu made the first submenu row a duplicate of its parent.
	return [item, ...productItems.mixer];
}
