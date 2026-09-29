/* SPDX-License-Identifier: AGPL-3.0-only */

import { PARALLEL_STACK_COPY_BY_LOCALE } from '../../i18n/editor-parallel-stack-copy.ts';
import { resolveEditorCopyScope } from '../../i18n/editor-copy-scope.ts';
import type { ParallelStackPreferences, ParallelStackStatus } from '../engine/parallel-stack-preferences.ts';

export interface ParallelStackMenuItem {
	readonly id: string;
	readonly documentationId?: string;
	readonly label: string;
	readonly disabled?: boolean;
	readonly disabledReason?: string;
	readonly checked?: boolean;
	readonly items?: readonly ParallelStackMenuItem[];
	resolve?(): { readonly disabled: boolean; readonly disabledReason?: string };
	onClick?(): unknown;
}

export interface ParallelStackMenuInput {
	readonly productId: string;
	readonly desktop: boolean;
	readonly blocked: boolean;
	readonly preferences: ParallelStackPreferences;
	readonly status: ParallelStackStatus;
	readonly copy?: Readonly<Record<string, string | undefined>>;
	readonly isBlocked?: () => boolean;
}

/** The existing Audio setup submenu owns this opt-in; no persistent chrome. */
export function appendParallelStackProcessingMenu(
	items: readonly ParallelStackMenuItem[],
	input: ParallelStackMenuInput | null,
	change: (patch: Partial<ParallelStackPreferences>) => unknown,
): readonly ParallelStackMenuItem[] {
	if (!input || input.productId !== 'soundscaper' || !input.desktop) return items;
	const copy = resolveEditorCopyScope('parallelStacks', PARALLEL_STACK_COPY_BY_LOCALE.en, input.copy);
	const { preferences, status, blocked } = input;
	const entry = (id: string, label: string, checked: boolean, patch: Partial<ParallelStackPreferences>): ParallelStackMenuItem => ({
		id, label, checked, disabled: blocked,
		...(blocked ? { disabledReason: copy.stopRequired } : {}),
		...(!blocked || input.isBlocked ? { onClick: () => change(patch) } : {}),
		...(input.isBlocked ? { resolve: () => input.isBlocked?.()
			? { disabled: true, disabledReason: copy.stopRequired } : { disabled: false } } : {}),
	});
	const sampleRate = status.sampleRate;
	const latency = sampleRate && Number.isFinite(sampleRate) && sampleRate > 0
		? copy.latency.replace('{milliseconds}', String(Number((preferences.pipelineFrames / sampleRate * 1000).toFixed(2))))
			.replace('{sampleRate}', String(sampleRate))
		: copy.latencyUnknown.replace('{frames}', String(preferences.pipelineFrames));
	const statusText = !preferences.enabled ? copy.off
		: status.state === 'active' ? copy.active.replace('{count}', String(status.workerCount ?? 1))
			: status.state === 'unsupported' || status.state === 'failed'
				? copy[status.state].replace('{reason}', status.reason ?? '') : copy.ready;
	const processing: ParallelStackMenuItem = { id: 'parallel-stack-processing', label: copy.processing, items: [
		entry('parallel-stack-enabled', copy.enabled, preferences.enabled, { enabled: !preferences.enabled }),
		{ id: 'parallel-stack-workers', label: copy.workers, items: (['auto', 1, 2, 4, 8] as const).map((workerLimit) => ({
			...entry(`parallel-stack-workers-${String(workerLimit)}`,
				workerLimit === 'auto' ? copy.auto : copy.workerCount.replace('{count}', String(workerLimit)),
				preferences.workerLimit === workerLimit, { workerLimit }),
			documentationId: 'parallel-stack-workers',
		})) },
		{ id: 'parallel-stack-buffering', label: copy.buffering, items: ([768, 1536] as const).map((pipelineFrames) => ({
			...entry(`parallel-stack-buffering-${String(pipelineFrames)}`,
				pipelineFrames === 768 ? copy.standard : copy.additional,
				preferences.pipelineFrames === pipelineFrames, { pipelineFrames }),
			documentationId: 'parallel-stack-buffering',
		})) },
		{ id: 'parallel-stack-latency', label: latency, disabled: true },
		{ id: 'parallel-stack-status', label: statusText, disabled: true },
	] };
	if (items.some((item) => item.id === 'native-audio')) {
		return items.map((item) => item.id === 'native-audio'
			? { ...item, label: copy.audioSetup, disabled: false, items: [...(item.items ?? []), processing] } : item);
	}
	return [...items, { id: 'native-audio', label: copy.audioSetup, items: [processing] }];
}
