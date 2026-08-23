/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorProjectStore } from '../common/editor/storage.js';
import {
	bindFramescaperCandidateAuthoringActionRuntime,
	createFramescaperCandidateAuthoringActionSubsetRuntime,
	type FramescaperCandidateAuthoringSurface,
} from '../common/editor/ui/framescaper-candidate-authoring-actions.ts';

type Awaitable<Value> = Value | PromiseLike<Value>;

export const FRAMESCAPER_SELECTED_V27_AUTHORING_SURFACES = Object.freeze([
	'video-transition', 'video-transition-dissolve',
	'video-still', 'video-title', 'video-text', 'video-shape', 'video-solid',
	'video-adjustment-layer', 'video-visual-preset', 'video-mask-matte', 'video-freeze',
] as const satisfies readonly FramescaperCandidateAuthoringSurface[]);

export interface FramescaperSelectedAuthoringControllerV27 {
	readonly project: unknown;
	readonly actions: Readonly<{
		readonly edit: Readonly<{ commit(command: unknown): Awaitable<unknown> }>;
	}>;
}

/** Bind only maintained web-core V27 authoring; native/M5 surfaces are absent. */
export function bindFramescaperSelectedAuthoringControllerV27(options: Readonly<{
	readonly controller: FramescaperSelectedAuthoringControllerV27;
	readonly store: AudioEditorProjectStore;
}>): void {
	const { controller, store } = options;
	let tail = Promise.resolve();
	const serialized = (surface: FramescaperCandidateAuthoringSurface): Promise<void> => {
		const operation = async (): Promise<void> => {
			const project = structuredClone(controller.project);
			if (schemaVersion(project) !== 27) {
				throw new Error('Selected visual authoring requires a writable Framescaper V27 project.');
			}
			const workflow = await import('./editor-selected-v27-authoring-workflows.ts');
			const prepared = await workflow.prepareFramescaperSelectedAuthoringV27(
				surface, project, store,
			);
			if (prepared === null) return;
			try {
				await controller.actions.edit.commit(prepared.command);
			} catch (error) {
				if (!prepared.rollback) throw error;
				try { await prepared.rollback(); }
				catch (cleanupError) {
					throw new AggregateError(
						[error, cleanupError], 'V27 authoring commit and media rollback both failed.',
						{ cause: error },
					);
				}
				throw error;
			}
		};
		const result = tail.then(operation, operation);
		tail = result.then(() => undefined, () => undefined);
		return result;
	};
	const actions = Object.fromEntries(FRAMESCAPER_SELECTED_V27_AUTHORING_SURFACES.map((surface) => (
		[surface, () => serialized(surface)]
	)));
	bindFramescaperCandidateAuthoringActionRuntime(controller as object,
		createFramescaperCandidateAuthoringActionSubsetRuntime(
			FRAMESCAPER_SELECTED_V27_AUTHORING_SURFACES, actions,
		));
}

function schemaVersion(value: unknown): number | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const descriptor = Object.getOwnPropertyDescriptor(value, 'schemaVersion');
	return descriptor?.enumerable && Object.hasOwn(descriptor, 'value')
		&& Number.isSafeInteger(descriptor.value) ? Number(descriptor.value) : null;
}
