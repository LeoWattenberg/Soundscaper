/* SPDX-License-Identifier: AGPL-3.0-only */
import { useMemo, useRef } from 'react';
import type { LocalModelManagerModel, LocalModelInstallProgress } from '../local-model-manager-bridge.ts';
import type { LocalAssistanceModel } from '../../assistance/local-assistance-bridge.ts';
import type { AssistanceOperation } from '../../assistance/operation.ts';
import type { LocalAssistanceShotDetectionMode } from '../../assistance/shot-detection-mode.ts';
import { localAssistanceModelTaskSlots, localAssistanceModelCompatible } from '../../assistance/local-assistance-preparation.ts';
import { localModelDisplayName } from './local-model-display-name.ts';
type Copy = Readonly<Record<string, string | undefined>>;
type Purpose = (copy: Copy, value: string) => string;

export function useLocalModelCatalog(models: readonly LocalModelManagerModel[], copy: Copy, locale: string, purpose: Purpose, query: string, task: string, status: string, relatedOnly: boolean, modelFilter?: (model: LocalModelManagerModel) => boolean) {
	const prepared = useMemo(() => models.filter(model => !relatedOnly || !modelFilter || modelFilter(model)).map(model => ({
		model, text: `${model.modelId} ${localModelDisplayName(model.modelId, copy)} ${purpose(copy, model.task)}`.toLocaleLowerCase(locale),
	})), [models, copy, locale, purpose, relatedOnly, modelFilter]);
	return useMemo(() => {
		const normalized = query.toLocaleLowerCase(locale);
		return prepared.filter(({ model, text }) => (task === 'all' || model.task === task)
			&& (status === 'all' || (status === 'installed' ? model.installedBytes !== null : model.installedBytes === null))
			&& text.includes(normalized)).map(({ model }) => model);
	}, [prepared, locale, query, task, status]);
}

export function useLocalModelActivity(progress: readonly LocalModelInstallProgress[], busyIds: readonly string[], installingIds: readonly string[], cancellingIds: readonly string[]) {
	const progressById = useMemo(() => new Map(progress.map(entry => [entry.modelId, entry])), [progress]);
	const busy = useModelMembership(busyIds), installing = useModelMembership(installingIds), cancelling = useModelMembership(cancellingIds);
	const membership = useMemo(() => ({ busy, installing, cancelling }), [busy, installing, cancelling]);
	return useMemo(() => ({ progress: progressById, ...membership }), [progressById, membership]);
}

// Progress publications carry fresh sorted arrays even when no operation starts or ends.
function useModelMembership(ids: readonly string[]): ReadonlySet<string> {
	const retained = useRef<{ ids: readonly string[]; members: ReadonlySet<string> } | null>(null);
	return useMemo(() => {
		const previous = retained.current;
		if (previous && ids.length === previous.ids.length && ids.every((id, index) => id === previous.ids[index])) return previous.members;
		const members = new Set(ids);
		retained.current = { ids: [...ids], members };
		return members;
	}, [ids]);
}

export function useLocalModelTaskOptions(models: readonly LocalModelManagerModel[], copy: Copy, purpose: Purpose) {
	return useMemo(() => [...new Set(models.map(model => model.task))].map(value => ({ value, label: purpose(copy, value) })), [models, copy, purpose]);
}

export function useOfflineModelChoices(models: readonly LocalModelManagerModel[], copy: Copy) {
	return useMemo(() => {
		const offlineModels = models.filter(model => model.installedBytes === null && model.availability === 'installable');
		return { offlineModels, options: offlineModels.map(model => ({ value: model.modelId, label: localModelDisplayName(model.modelId, copy) })) };
	}, [models, copy]);
}

export function useAssistanceModelChoices(models: readonly LocalAssistanceModel[], operation: AssistanceOperation | null, mode?: LocalAssistanceShotDetectionMode) {
	return useMemo(() => (operation ? localAssistanceModelTaskSlots(operation, mode) : [[]]).map(slot => ({ slot,
		compatibleModels: models.filter(model => slot.includes(model.task) && localAssistanceModelCompatible(operation!, model, mode)),
	})), [models, operation, mode]);
}
