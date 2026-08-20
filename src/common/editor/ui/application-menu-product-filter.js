/* SPDX-License-Identifier: AGPL-3.0-only */

import { workspacePanelAvailable } from './framescaper-capture-ui-model.ts';

export function filterProductMenus(menus, capabilities, productId) {
	const hiddenTopLevel = new Set();
	if (!capabilities.audioGenerators) hiddenTopLevel.add('generate');
	if (!capabilities.audioEffects) hiddenTopLevel.add('effect');
	if (!capabilities.audioAnalysis) hiddenTopLevel.add('analyze');
	return menus
		.filter((menu) => !hiddenTopLevel.has(menu.id))
		.map((menu) => {
			if (menu.id === 'tracks' && !capabilities.audioEffects) {
				const hiddenTrackItems = new Set(['track-rate', 'track-format', 'track-channels', 'mix', 'resample']);
				return { ...menu, items: menu.items.filter((item) => !hiddenTrackItems.has(item.id)) };
			}
			if (menu.id === 'tools' && !capabilities.audioMacros) {
				return { ...menu, items: menu.items.filter((item) => !['manage-macros', 'nyquist-prompt'].includes(item.id)) };
			}
			if (menu.id !== 'view') return menu;
			return {
				...menu,
				items: menu.items.map((item) => {
					if (item.id === 'panels') {
						return {
							...item,
							items: item.items.filter((panel) => !panel.id?.startsWith('panel-')
								|| workspacePanelAvailable(productId, panel.id.slice('panel-'.length))),
						};
					}
					if (item.id !== 'workspace-preset') return item;
					return {
						...item,
						items: item.items.filter((workspace) => productId === 'framescaper'
							? !['workspace-modern', 'workspace-music', 'workspace-classic'].includes(workspace.id)
							: workspace.id !== 'workspace-video-editor'),
					};
				}).filter((item) => capabilities.audioRecording || item.id !== 'show-arm-controls'),
			};
		});
}
