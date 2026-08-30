/* SPDX-License-Identifier: AGPL-3.0-only */

import { createSoundscaperNativeServicesMenuItems } from '../common/editor/ui/soundscaper-native-services-menu.ts';
import { createSoundscaperProductionApplicationMenuItems } from '../common/editor/ui/soundscaper-production-application-menu.ts';

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
	const nativeRuntime = actions.soundscaperNativeServices || null;
	const nativeServices = createSoundscaperNativeServicesMenuItems({
		productId,
		runtimeAvailable: nativeRuntime !== null,
		snapshot: nativeRuntime?.snapshot ?? null,
		editingBlocked: editBlocked,
		readOnly: snapshot.readOnly === true,
		copy,
	}, { open: (surface) => nativeRuntime?.open(surface) });
	return Object.freeze({
		...production,
		tracks: production.tracks,
		generate: EMPTY_ITEMS,
		effect: Object.freeze([...production.effect, ...nativeServices.effect]),
		analyze: production.analyze,
		mixer: production.mixer,
		tools: Object.freeze([...production.tools, ...nativeServices.tools]),
		fileImport: EMPTY_ITEMS,
		fileExport: EMPTY_ITEMS,
		view: EMPTY_ITEMS,
	});
}

export function extendApplicationMenuProductPanelItems(panelId, item, productItems) {
	if (panelId !== 'mixer' || !productItems.mixer.length) return [item];
	return [item, ...productItems.mixer];
}
