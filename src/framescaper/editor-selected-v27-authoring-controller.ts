/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorProjectStore } from '../common/editor/storage.js';
import {
	bindFramescaperCandidateAuthoringActionRuntime,
	createFramescaperCandidateAuthoringActionSubsetRuntime,
	type FramescaperCandidateAuthoringSurface,
} from '../common/editor/ui/framescaper-candidate-authoring-actions.ts';
import type {
	FramescaperSelectedVisualAuthoringRequestV27,
} from './editor-selected-v27-visual-authoring-commands.ts';
import type {
	FramescaperSelectedVisualAuthoringSurfaceV27,
} from './editor-selected-v27-visual-authoring-model.ts';
import { framescaperProjectV27FoundationShapeV28 } from './editor-project-v28-foundation.ts';

type Awaitable<Value> = Value | PromiseLike<Value>;

export const FRAMESCAPER_SELECTED_V27_AUTHORING_SURFACES = Object.freeze([
	'video-transition', 'video-transition-dissolve',
	'video-still', 'video-title', 'video-text', 'video-shape', 'video-solid',
	'video-adjustment-layer', 'video-visual-preset', 'video-mask-matte', 'video-freeze',
] as const satisfies readonly FramescaperCandidateAuthoringSurface[]);

export interface FramescaperSelectedAuthoringControllerV27 {
	readonly project: unknown;
	readonly getSnapshot: () => Readonly<{ readonly selectedClipId?: unknown }>;
	readonly getTelemetrySnapshot: () => Readonly<{ readonly positionFrame?: unknown }>;
	readonly actions: Readonly<{
		readonly edit: Readonly<{ commit(command: unknown): Awaitable<unknown> }>;
	}>;
}

export type FramescaperSelectedAuthoringControllerV28 = FramescaperSelectedAuthoringControllerV27;

export interface FramescaperSelectedVisualAuthoringRuntimeV27 {
	readonly run: (
		surface: FramescaperSelectedVisualAuthoringSurfaceV27,
		request: FramescaperSelectedVisualAuthoringRequestV27,
	) => Promise<void>;
}

const VISUAL_RUNTIMES = new WeakMap<object, FramescaperSelectedVisualAuthoringRuntimeV27>();
const DIALOG_SURFACES = new Set<string>([
	'video-transition', 'video-transition-dissolve', 'video-adjustment-layer',
	'video-visual-preset', 'video-mask-matte', 'video-freeze',
]);

export function framescaperSelectedVisualAuthoringRuntimeV27For(
	owner: object,
): FramescaperSelectedVisualAuthoringRuntimeV27 | null {
	return VISUAL_RUNTIMES.get(owner) ?? null;
}

/** Rebind one inherited runtime after a product-version foundation projection. */
export function adoptFramescaperSelectedVisualAuthoringRuntimeV27(
	from: object,
	to: object,
): void {
	const runtime = VISUAL_RUNTIMES.get(from);
	if (!runtime || !to || typeof to !== 'object') {
		throw new TypeError('Selected visual authoring adoption requires exact owners.');
	}
	VISUAL_RUNTIMES.set(to, runtime);
}

/** Bind only maintained web-core V27 authoring; native/M5 surfaces are absent. */
export function bindFramescaperSelectedAuthoringControllerV27(options: Readonly<{
	readonly controller: FramescaperSelectedAuthoringControllerV27;
	readonly store: AudioEditorProjectStore;
}>): void {
	bindSelectedAuthoringController(options, 27, (project) => project);
}

/** Bind inherited V27 authoring to selected V28 through its detached foundation view. */
export function bindFramescaperSelectedAuthoringControllerV28(options: Readonly<{
	readonly controller: FramescaperSelectedAuthoringControllerV28;
	readonly store: AudioEditorProjectStore;
}>): void {
	bindSelectedAuthoringController(options, 28, framescaperProjectV27FoundationShapeV28);
}

function bindSelectedAuthoringController(
	options: Readonly<{
		readonly controller: FramescaperSelectedAuthoringControllerV27;
		readonly store: AudioEditorProjectStore;
	}>,
	schema: 27 | 28,
	projectForAuthoring: (project: unknown) => unknown,
): void {
	const { controller, store } = options;
	let tail = Promise.resolve();
	const enqueue = (operation: () => Promise<void>): Promise<void> => {
		const result = tail.then(operation, operation);
		tail = result.then(() => undefined, () => undefined);
		return result;
	};
	const serialized = (surface: FramescaperCandidateAuthoringSurface): Promise<void> => {
		return enqueue(async (): Promise<void> => {
			if (DIALOG_SURFACES.has(surface)) {
				throw new Error('Selected V27 visual authoring requires its menu-opened dialog.');
			}
			const canonicalProject = structuredClone(controller.project);
			if (schemaVersion(canonicalProject) !== schema) {
				throw new Error(`Selected visual authoring requires a writable Framescaper V${String(schema)} project.`);
			}
			const project = projectForAuthoring(canonicalProject);
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
						[error, cleanupError], `V${String(schema)} authoring commit and media rollback both failed.`,
						{ cause: error },
					);
				}
				throw error;
			}
		});
	};
	const visualRuntime = Object.freeze({
		run(surface: FramescaperSelectedVisualAuthoringSurfaceV27,
			request: FramescaperSelectedVisualAuthoringRequestV27): Promise<void> {
			return enqueue(async () => {
				const model = await import('./editor-selected-v27-visual-authoring-model.ts');
				const state = runtimeState(controller, schema, projectForAuthoring);
				model.assertFramescaperSelectedVisualAuthoringRuntimeFenceV27({
					project: state.project, fence: request.fence,
					selectedClipId: state.selectedClipId, playheadSample: state.playheadSample,
				});
				const commands = await import('./editor-selected-v27-visual-authoring-commands.ts');
				const captureRuntime = await import('./editor-selected-v27-freeze-capture.ts');
				const prepared = await commands.prepareFramescaperSelectedVisualAuthoringV27({
					surface, project: state.project, store, request,
					capture: captureRuntime.framescaperSelectedFreezeCaptureV27For(controller),
				});
				try {
					const current = runtimeState(controller, schema, projectForAuthoring);
					model.assertFramescaperSelectedVisualAuthoringRuntimeFenceV27({
						project: current.project, fence: request.fence,
						selectedClipId: current.selectedClipId,
						playheadSample: current.playheadSample,
					});
					await controller.actions.edit.commit(prepared.command);
				} catch (error) {
					if (!prepared.rollback) throw error;
					try { await prepared.rollback(); }
					catch (cleanupError) {
						throw new AggregateError(
							[error, cleanupError],
							`V${String(schema)} selected authoring and media rollback both failed.`,
							{ cause: error },
						);
					}
					throw error;
				}
			});
		},
	});
	VISUAL_RUNTIMES.set(controller as object, visualRuntime);
	const actions = Object.fromEntries(FRAMESCAPER_SELECTED_V27_AUTHORING_SURFACES.map((surface) => (
		[surface, () => serialized(surface)]
	)));
	bindFramescaperCandidateAuthoringActionRuntime(controller as object,
		createFramescaperCandidateAuthoringActionSubsetRuntime(
			FRAMESCAPER_SELECTED_V27_AUTHORING_SURFACES, actions,
		));
}

function runtimeState(
	controller: FramescaperSelectedAuthoringControllerV27,
	schema: 27 | 28,
	projectForAuthoring: (project: unknown) => unknown,
) {
	const canonicalProject = structuredClone(controller.project);
	if (schemaVersion(canonicalProject) !== schema) {
		throw new Error(`Selected visual authoring requires a writable Framescaper V${String(schema)} project.`);
	}
	const project = projectForAuthoring(canonicalProject);
	const selectedClipId = controller.getSnapshot().selectedClipId;
	const playhead = controller.getTelemetrySnapshot().positionFrame;
	if (selectedClipId !== null && typeof selectedClipId !== 'string') {
		throw new TypeError('Selected visual authoring requires one exact clip selection.');
	}
	if (!Number.isSafeInteger(playhead) || Number(playhead) < 0) {
		throw new RangeError('Selected visual authoring requires an exact playhead sample.');
	}
	return Object.freeze({ project, selectedClipId: selectedClipId ?? null,
		playheadSample: Number(playhead) });
}

function schemaVersion(value: unknown): number | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const descriptor = Object.getOwnPropertyDescriptor(value, 'schemaVersion');
	return descriptor?.enumerable && Object.hasOwn(descriptor, 'value')
		&& Number.isSafeInteger(descriptor.value) ? Number(descriptor.value) : null;
}
