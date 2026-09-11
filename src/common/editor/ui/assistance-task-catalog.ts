/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AssistanceGuidedWorkflowId } from '../assistance/workflow-recipes.ts';

export type AssistanceDialogRequest = Readonly<
	{ mode: 'task'; workflowId: AssistanceGuidedWorkflowId } | { mode: 'advanced' }
>;
type Copy = Readonly<Record<string, string | undefined>>;
interface Task {
	readonly workflowId: AssistanceGuidedWorkflowId;
	readonly label: string;
	readonly menu: string;
	readonly group?: string;
	readonly groupLabel?: string;
	readonly video?: boolean;
}
export const ASSISTANCE_TASKS: readonly Task[] = Object.freeze([
	{ workflowId: 'enhance-dialogue', label: 'Enhance Dialogue', menu: 'effect', group: 'noiseRepair', groupLabel: 'Noise Removal & Repair' },
	{ workflowId: 'reduce-reverb', label: 'Reduce Reverb', menu: 'effect', group: 'noiseRepair', groupLabel: 'Noise Removal & Repair' },
	{ workflowId: 'clean-filler-silence', label: 'Clean Filler & Silence', menu: 'effect', group: 'noiseRepair', groupLabel: 'Noise Removal & Repair' },
	{ workflowId: 'separate-dialogue-music-effects', label: 'Separate Dialogue / Music / Effects', menu: 'effect', group: 'assistance-source-separation', groupLabel: 'Source Separation' },
	{ workflowId: 'transcribe-captions', label: 'Transcribe & Captions', menu: 'analyze', group: 'assistance-speech', groupLabel: 'Speech' },
	{ workflowId: 'identify-speakers', label: 'Identify Speakers', menu: 'analyze', group: 'assistance-speech', groupLabel: 'Speech' },
	{ workflowId: 'mark-reactions', label: 'Mark Reactions', menu: 'analyze', group: 'assistance-speech', groupLabel: 'Speech' },
	{ workflowId: 'detect-beats-tempo', label: 'Detect Beats & Tempo', menu: 'analyze', group: 'assistance-music', groupLabel: 'Music' },
	{ workflowId: 'mark-cuts', label: 'Mark Cuts', menu: 'analyze', group: 'assistance-video', groupLabel: 'Video', video: true },
	{ workflowId: 'reframe', label: 'Reframe', menu: 'effect', group: 'framescaper-video-effects', groupLabel: 'Video effects', video: true },
	{ workflowId: 'make-highlights', label: 'Make Highlights', menu: 'edit', video: true },
	{ workflowId: 'generate-editorial-text', label: 'Generate Editorial Text', menu: 'generate' },
	{ workflowId: 'index-transcript', label: 'Index Transcript', menu: 'tools', group: 'assistance-search', groupLabel: 'Search' },
	{ workflowId: 'index-video', label: 'Index Video', menu: 'tools', group: 'assistance-search', groupLabel: 'Search', video: true },
]);

export function assistanceTaskLabel(id: AssistanceGuidedWorkflowId, copy: Copy): string {
	return copy[`assistanceTask.${id}`] || ASSISTANCE_TASKS.find((task) => task.workflowId === id)!.label;
}
export function assistanceDialogSurface(request: AssistanceDialogRequest): string {
	return request.mode === 'advanced' ? 'local-assistance' : `local-assistance:${request.workflowId}`;
}
export function assistanceDialogRequest(surface: unknown): AssistanceDialogRequest | null {
	if (surface === 'local-assistance') return { mode: 'advanced' };
	const task = ASSISTANCE_TASKS.find(({ workflowId }) => surface === `local-assistance:${workflowId}`);
	return task ? { mode: 'task', workflowId: task.workflowId } : null;
}

export interface AssistanceMenuEntry {
	readonly id?: string;
	readonly label?: string;
	readonly items?: readonly AssistanceMenuEntry[];
	readonly assistanceTask?: boolean;
	readonly onClick?: () => unknown;
	readonly [key: string]: unknown;
}
interface MenuOptions {
	readonly productId: string;
	readonly available: boolean;
	readonly copy: Copy;
	readonly organization?: string;
	readonly locale?: string;
	readonly open: (request: AssistanceDialogRequest) => unknown;
}

/** Merge by category identity so existing effect organization remains authoritative. */
export function mergeAssistanceTaskMenus(
	menus: readonly AssistanceMenuEntry[], options: MenuOptions,
): AssistanceMenuEntry[] {
	if (!options.available) return [...menus];
	return menus.map((menu) => {
		let items = [...(menu.items ?? [])];
		for (const task of ASSISTANCE_TASKS) {
			if (task.menu !== menu.id || (task.video && options.productId !== 'framescaper')) continue;
			const entry: AssistanceMenuEntry = {
				id: `assistance-task-${task.workflowId}`, label: `${assistanceTaskLabel(task.workflowId, options.copy)}…`,
				assistanceTask: true,
				onClick: () => options.open({ mode: 'task', workflowId: task.workflowId }),
			};
			if (!task.group || (menu.id === 'effect' && options.organization === 'sortby:name')) {
				items.push(entry);
				continue;
			}
			const index = items.findIndex(({ id }) => id === task.group);
			if (index >= 0) items[index] = { ...items[index], disabled: false, disabledReason: '', items: [...(items[index].items ?? []), entry] };
			else items.push({ id: task.group, label: options.copy[task.group] || task.groupLabel, items: [entry] });
		}
		if (menu.id === 'effect' && options.organization === 'sortby:name') {
			// Sort only the effect block; management and repeat commands retain their positions.
			const effects = items.filter((item) => item.assistanceTask || item.onClick && !item.items
				&& !['realtime-effects', 'repeat-effect', 'native-effect-manage', 'native-effect-use', 'framescaper-ofx-manage'].includes(item.id ?? ''));
			const sorted = [...effects].sort((a, b) => (a.label ?? '').localeCompare(b.label ?? '', options.locale || 'en'));
			const effectSet = new Set(effects);
			let index = 0;
			items = items.map((item) => effectSet.has(item) ? sorted[index++] : item);
		}
		return { ...menu, items };
	});
}

/** Preserve only assistance leaves when a product cannot expose the surrounding audio category. */
export function assistanceOnlyMenuEntry(entry: AssistanceMenuEntry): AssistanceMenuEntry | null {
	if (entry.assistanceTask) return entry;
	const items = entry.items?.map(assistanceOnlyMenuEntry).filter((item) => item !== null);
	return items?.length ? { ...entry, items } : null;
}
