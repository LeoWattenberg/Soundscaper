/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	CrossProductHandoffActionDependencies,
	CrossProductHandoffActionResult,
	CrossProductHandoffActionScope,
} from './cross-product-handoff-action.ts';

interface CrossProductHandoffActionFacadeScope extends CrossProductHandoffActionScope {
	readonly copy: Readonly<{
		readonly projectSaved?: unknown;
		readonly projectSaving?: unknown;
	}>;
	readonly setStatus?: (message: string, kind: 'success') => unknown;
	readonly taskProgress?: Readonly<{
		run<Result>(
			kind: 'project-io', label: string,
			operation: () => PromiseLike<Result> | Result,
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
					: (await import('./cross-product-handoff-action.ts')).saveCrossProductEditableCopy;
				return saveCrossProductEditableCopy(scope, intent, {
					signal: operationCancellation.signal,
					loadRuntime: async () => (
						await import('../../transfer/transfer-archive-runtime.ts')
					).loadTransferRuntime(),
				});
			};
			const label = String(scope.copy.projectSaving ?? 'Saving project');
			const result = scope.taskProgress?.run
				? await scope.taskProgress.run('project-io', label, operation)
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
	scope.setStatus(
		`${String(scope.copy.projectSaved ?? 'Project saved')}: ${result.fileName}; `
		+ `${String(accepted)} accepted, ${String(omitted)} omitted; ${result.reportFileName}.`,
		'success',
	);
}
