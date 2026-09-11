/* SPDX-License-Identifier: AGPL-3.0-only */

import { assistanceOnlyMenuEntry } from './assistance-task-catalog.ts';
import { workspacePanelAvailable } from './workspace/workspace-product-panel-runtime.ts';

export function filterProductMenus(menus, capabilities, productId) {
	const hiddenTopLevel = new Set();
	const candidateVideoGeneration = productId === 'framescaper'
		&& (capabilities.videoGenerators || capabilities.videoStills);
	const candidateVideoAnalysis = productId === 'framescaper'
		&& capabilities.videoMotionTracking;
	const hasAssistance = (id) => capabilities.assistanceAssets === true
		&& menus.some((menu) => menu.id === id && menu.items.some(assistanceOnlyMenuEntry));
	if (!capabilities.audioGenerators && !candidateVideoGeneration && !hasAssistance('generate')) hiddenTopLevel.add('generate');
	if (!capabilities.audioEffects && productId !== 'framescaper' && !hasAssistance('effect')) hiddenTopLevel.add('effect');
	if (!capabilities.audioAnalysis && !candidateVideoAnalysis && !hasAssistance('analyze')) hiddenTopLevel.add('analyze');
	return menus
		.filter((menu) => !hiddenTopLevel.has(menu.id))
		.map((menu) => {
			if (menu.id === 'generate' && !capabilities.audioGenerators) {
				const framescaperVideoGeneratorIds = new Set([
					'framescaper-add-video-still', 'framescaper-video-generators',
				]);
				return {
					...menu,
					items: menu.items.map((item) => framescaperVideoGeneratorIds.has(item.id) ? item : assistanceOnlyMenuEntry(item)).filter(Boolean),
				};
			}
			if (menu.id === 'effect' && !capabilities.audioEffects) {
				const framescaperVideoEffectIds = new Set([
					'framescaper-ofx-manage', 'framescaper-video-effects', 'framescaper-video-transitions',
					'framescaper-edit-video-mask-matte', 'framescaper-freeze-video',
					'framescaper-video-finishing',
				]);
				return {
					...menu,
					items: menu.items.map((item) => framescaperVideoEffectIds.has(item.id) ? item : assistanceOnlyMenuEntry(item)).filter(Boolean),
				};
			}
			if (menu.id === 'tracks' && !capabilities.audioEffects) {
				const hiddenTrackItems = new Set(['track-channels', 'mix-render', 'resample']);
				return { ...menu, items: menu.items.filter((item) => !hiddenTrackItems.has(item.id)) };
			}
			if (menu.id === 'analyze' && !capabilities.audioAnalysis) {
				const retainedAnalyzeItems = new Set([
					'framescaper-motion-tracking', 'local-assistance',
					'local-assistance-indexed-search',
				]);
				return {
					...menu,
					items: menu.items.map((item) => retainedAnalyzeItems.has(item.id) ? item : assistanceOnlyMenuEntry(item)).filter(Boolean),
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
							? !['workspace-modern', 'workspace-audacity', 'workspace-music', 'workspace-classic', 'workspace-onboarding'].includes(workspace.id)
							: workspace.id !== 'workspace-video-editor'),
					};
				}).filter((item) => capabilities.audioRecording || item.id !== 'show-arm-controls'),
			};
		})
		.filter((menu) => menu.items.length > 0);
}
