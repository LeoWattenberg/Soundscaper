/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	CrossProductHandoffActionDependencies,
	CrossProductHandoffActionResult,
	CrossProductHandoffActionScope,
} from './internal/cross-product-handoff-action.ts';
import { setLocalizedStatus, type LocalizedPresentationMessage } from '../../../i18n/presentation-message.ts';
import { CROSS_PRODUCT_HANDOFF_COPY_BY_LOCALE } from '../../../i18n/editor-project-media-copy.ts';

interface CrossProductHandoffActionFacadeScope extends CrossProductHandoffActionScope {
	readonly copy: Readonly<{
		readonly projectSaved?: unknown;
		readonly projectSaving?: unknown;
		readonly [key: string]: unknown;
	}>;
	readonly setStatus?: (message: string, kind: 'success', localization?: import('../../../i18n/presentation-message.ts').LocalizedPresentationMessage) => unknown;
	readonly taskProgress?: Readonly<{
		run<Result>(
			kind: 'project-io', label: string,
			operation: () => PromiseLike<Result> | Result,
			value?: number | null, localization?: LocalizedPresentationMessage,
		): PromiseLike<Result> | Result;
	}>;
}

type SaveCrossProductEditableCopy = (
	scope: CrossProductHandoffActionScope,
	intent: unknown,
	dependencies: CrossProductHandoffActionDependencies,
) => PromiseLike<Readonly<CrossProductHandoffActionResult>>;

interface CrossProductHandoffActionFacadeDependencies {
	readonly loadAction?: () => PromiseLike<SaveCrossProductEditableCopy> | SaveCrossProductEditableCopy;
}

/** Owns the one cancellable desktop editable-copy operation exposed by the File menu. */
export function createCrossProductHandoffActionFacade(
	scope: CrossProductHandoffActionFacadeScope,
	dependencies: CrossProductHandoffActionFacadeDependencies = {},
) {
	let cancellation: AbortController | null = null;

	const saveCrossProductCopy = async (intent: unknown): Promise<unknown> => {
		if (cancellation !== null) {
			throw new RangeError('An editable cross-product copy is already in progress.');
		}
		const operationCancellation = new AbortController();
		cancellation = operationCancellation;
		try {
			const operation = async (): Promise<Readonly<CrossProductHandoffActionResult>> => {
				const saveCrossProductEditableCopy = dependencies.loadAction
					? await dependencies.loadAction()
					: (await import('./internal/cross-product-handoff-action.ts')).saveCrossProductEditableCopy;
				return saveCrossProductEditableCopy(scope, intent, {
					signal: operationCancellation.signal,
					loadRuntime: async () => (
						await import('../../../transfer/transfer-archive-runtime.ts')
					).loadTransferRuntime(),
				});
			};
			const label = String(scope.copy.projectSaving ?? 'Saving project');
			const result = scope.taskProgress?.run
				? await scope.taskProgress.run('project-io', label, operation, undefined, { key: 'projectSaving', fallback: label })
				: await operation();
			if (result.reportFileName !== null) publishSuccess(scope, result);
			return result;
		} finally {
			if (cancellation === operationCancellation) cancellation = null;
		}
	};

	return Object.freeze({
		saveCrossProductCopy,
		cancelCrossProductCopy: (): boolean => {
			if (cancellation === null) return false;
			cancellation.abort(new DOMException('Editable-copy export cancelled.', 'AbortError'));
			return true;
		},
		crossProductCopyActive: (): boolean => cancellation !== null,
	});
}

function publishSuccess(
	scope: CrossProductHandoffActionFacadeScope,
	result: Readonly<CrossProductHandoffActionResult>,
): void {
	if (typeof scope.setStatus !== 'function') return;
	const roots = result.report && typeof result.report === 'object'
		&& Array.isArray((result.report as { readonly roots?: unknown }).roots)
		? (result.report as { readonly roots: readonly Readonly<{ readonly disposition?: unknown }>[] }).roots
		: [];
	const omitted = roots.filter(({ disposition }) => disposition === 'omit-with-report').length;
	const accepted = roots.length - omitted;
	setLocalizedStatus(scope.setStatus, scope.copy, 'ui.crossProductHandoff.savedReport', {
		saved: { key: 'projectSaved', fallback: String(scope.copy.projectSaved ?? 'Project saved') },
		fileName: result.fileName, accepted, omitted, reportFileName: result.reportFileName ?? '',
	}, 'success', { fallback: CROSS_PRODUCT_HANDOFF_COPY_BY_LOCALE.en.savedReport });
}
