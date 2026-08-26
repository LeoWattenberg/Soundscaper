/* SPDX-License-Identifier: AGPL-3.0-only */

import { workspacePanelAvailable } from './framescaper-capture-ui-model.ts';

export function filterProductMenus(menus, capabilities, productId) {
	const hiddenTopLevel = new Set();
	const candidateVideoGeneration = productId === 'framescaper'
		&& (capabilities.videoGenerators || capabilities.videoStills);
	const candidateVideoAnalysis = productId === 'framescaper'
		&& capabilities.videoMotionTracking;
	const candidateLocalAssistance = capabilities.assistanceAssets === true
		&& menus.some((menu) => menu.id === 'analyze'
			&& menu.items.some((item) => item.id === 'local-assistance'));
	if (!capabilities.audioGenerators && !candidateVideoGeneration) hiddenTopLevel.add('generate');
	if (!capabilities.audioEffects && productId !== 'framescaper') hiddenTopLevel.add('effect');
	if (!capabilities.audioAnalysis && !candidateVideoAnalysis && !candidateLocalAssistance) hiddenTopLevel.add('analyze');
	return menus
		.filter((menu) => !hiddenTopLevel.has(menu.id))
		.map((menu) => {
			if (menu.id === 'generate' && !capabilities.audioGenerators) {
				const framescaperVideoGeneratorIds = new Set([
					'framescaper-add-video-still', 'framescaper-video-generators',
				]);
				return {
					...menu,
					items: menu.items.filter((item) => framescaperVideoGeneratorIds.has(item.id)),
				};
			}
			if (menu.id === 'effect' && !capabilities.audioEffects) {
				const framescaperVideoEffectIds = new Set([
					'framescaper-video-effects', 'framescaper-video-transitions',
					'framescaper-edit-video-mask-matte', 'framescaper-freeze-video',
					'framescaper-v27-video-finishing',
				]);
				return {
					...menu,
					items: menu.items.filter((item) => framescaperVideoEffectIds.has(item.id)),
				};
			}
			if (menu.id === 'tracks' && !capabilities.audioEffects) {
				const hiddenTrackItems = new Set(['track-rate', 'track-format', 'track-channels', 'mix', 'resample']);
				return { ...menu, items: menu.items.filter((item) => !hiddenTrackItems.has(item.id)) };
			}
			if (menu.id === 'analyze' && !capabilities.audioAnalysis) {
				const retainedAnalyzeItems = new Set([
					'framescaper-v27-motion-tracking', 'local-assistance',
				]);
				return {
					...menu,
					items: menu.items.filter((item) => retainedAnalyzeItems.has(item.id)),
				};
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
		})
		.filter((menu) => menu.id !== 'effect' || capabilities.audioEffects || menu.items.length > 0);
}
