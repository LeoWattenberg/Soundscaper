/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorProjectStore } from '../common/editor/storage.js';
import {
	bindFramescaperCandidateAuthoringActionRuntime,
	createFramescaperCandidateAuthoringActionSubsetRuntime,
	type FramescaperCandidateAuthoringSurface,
} from '../common/editor/ui/framescaper-candidate-authoring-actions.ts';
import type {
	FramescaperSelectedVisualAuthoringRequestFinishing,
} from './editor-selected-finishing-visual-authoring-commands.ts';
import type {
	FramescaperSelectedVisualAuthoringSurface,
} from './editor-selected-finishing-visual-authoring-model.ts';
import { assertFramescaperProjectIdentity } from './editor-project-identity.ts';

type Awaitable<Value> = Value | PromiseLike<Value>;

export const FRAMESCAPER_SELECTED_AUTHORING_SURFACES = Object.freeze([
	'video-transition', 'video-transition-dissolve',
	'video-still', 'video-title', 'video-text', 'video-shape', 'video-solid',
	'video-adjustment-layer', 'video-visual-preset', 'video-mask-matte', 'video-freeze',
] as const satisfies readonly FramescaperCandidateAuthoringSurface[]);

export interface FramescaperSelectedAuthoringController {
	readonly project: unknown;
	readonly getSnapshot: () => Readonly<{ readonly selectedClipId?: unknown }>;
	readonly getTelemetrySnapshot: () => Readonly<{ readonly positionFrame?: unknown }>;
	readonly actions: Readonly<{
		readonly edit: Readonly<{ commit(command: unknown): Awaitable<unknown> }>;
	}>;
}

export interface FramescaperSelectedVisualAuthoringRuntime {
	readonly run: (
		surface: FramescaperSelectedVisualAuthoringSurface,
		request: FramescaperSelectedVisualAuthoringRequestFinishing,
	) => Promise<void>;
}

const VISUAL_RUNTIMES = new WeakMap<object, FramescaperSelectedVisualAuthoringRuntime>();
const VISUAL_CAPTURE_OWNERS = new WeakMap<object, object>();
const DIALOG_SURFACES = new Set<string>([
	'video-transition', 'video-transition-dissolve', 'video-adjustment-layer',
	'video-visual-preset', 'video-mask-matte', 'video-freeze',
]);

export function framescaperSelectedVisualAuthoringRuntimeFor(
	owner: object,
): FramescaperSelectedVisualAuthoringRuntime | null {
	return VISUAL_RUNTIMES.get(owner) ?? null;
}

export function adoptFramescaperSelectedVisualAuthoringRuntime(from: object, to: object): void {
	const runtime = VISUAL_RUNTIMES.get(from);
	if (!runtime || !to || typeof to !== 'object') {
		throw new TypeError('Selected visual authoring adoption requires exact owners.');
	}
	VISUAL_CAPTURE_OWNERS.set(from, to);
	VISUAL_RUNTIMES.set(to, runtime);
}

/** Bind every selected web-core authoring surface to the single v1 domain. */
export function bindFramescaperSelectedAuthoringController(options: Readonly<{
	readonly controller: FramescaperSelectedAuthoringController;
	readonly store: AudioEditorProjectStore;
}>): void {
	const { controller, store } = options;
	if (!controller || typeof controller !== 'object') {
		throw new TypeError('Selected visual authoring requires its controller owner.');
	}
	let tail = Promise.resolve();
	const enqueue = (operation: () => Promise<void>): Promise<void> => {
		const result = tail.then(operation, operation);
		tail = result.then(() => undefined, () => undefined);
		return result;
	};
	const serialized = (surface: FramescaperCandidateAuthoringSurface): Promise<void> => enqueue(async () => {
		if (DIALOG_SURFACES.has(surface)) {
			throw new Error('Selected visual authoring requires its menu-opened dialog.');
		}
		const project = currentProject(controller.project);
		const workflow = await import('./editor-selected-finishing-authoring-workflows.ts');
		const prepared = await workflow.prepareFramescaperSelectedAuthoringFinishing(surface, project, store);
		if (prepared === null) return;
		await commitWithRollback(controller, prepared);
	});
	const visualRuntime: FramescaperSelectedVisualAuthoringRuntime = Object.freeze({
		run(
			surface: FramescaperSelectedVisualAuthoringSurface,
			request: FramescaperSelectedVisualAuthoringRequestFinishing,
		): Promise<void> {
			return enqueue(async () => {
				const model = await import('./editor-selected-finishing-visual-authoring-model.ts');
				const state = runtimeState(controller);
				model.assertFramescaperSelectedVisualAuthoringRuntimeFenceFinishing({
					project: state.project,
					fence: request.fence,
					selectedClipId: state.selectedClipId,
					playheadSample: state.playheadSample,
				});
				const commands = await import('./editor-selected-finishing-visual-authoring-commands.ts');
				const captures = await import('./editor-selected-finishing-freeze-capture.ts');
				const prepared = await commands.prepareFramescaperSelectedVisualAuthoringFinishing({
					surface,
					project: state.project,
					store,
					request,
					capture: captures.framescaperSelectedFreezeCaptureFinishingFor(
						VISUAL_CAPTURE_OWNERS.get(controller as object) ?? controller,
					),
				});
				const current = runtimeState(controller);
				model.assertFramescaperSelectedVisualAuthoringRuntimeFenceFinishing({
					project: current.project,
					fence: request.fence,
					selectedClipId: current.selectedClipId,
					playheadSample: current.playheadSample,
				});
				await commitWithRollback(controller, prepared);
			});
		},
	});
	VISUAL_RUNTIMES.set(controller as object, visualRuntime);
	const actions = Object.fromEntries(FRAMESCAPER_SELECTED_AUTHORING_SURFACES.map((surface) => (
		[surface, () => serialized(surface)]
	)));
	bindFramescaperCandidateAuthoringActionRuntime(
		controller as object,
		createFramescaperCandidateAuthoringActionSubsetRuntime(
			FRAMESCAPER_SELECTED_AUTHORING_SURFACES,
			actions,
		),
	);
}

async function commitWithRollback(
	controller: FramescaperSelectedAuthoringController,
	prepared: Readonly<{ readonly command: unknown; readonly rollback?: () => Promise<void> }>,
): Promise<void> {
	try {
		await controller.actions.edit.commit(prepared.command);
	} catch (error) {
		if (!prepared.rollback) throw error;
		try { await prepared.rollback(); }
		catch (cleanupError) {
			throw new AggregateError(
				[error, cleanupError],
				'Selected authoring commit and media rollback both failed.',
				{ cause: error },
			);
		}
		throw error;
	}
}

function runtimeState(controller: FramescaperSelectedAuthoringController) {
	const project = currentProject(controller.project);
	const selectedClipId = controller.getSnapshot().selectedClipId;
	const playhead = controller.getTelemetrySnapshot().positionFrame;
	if (selectedClipId !== null && selectedClipId !== undefined && typeof selectedClipId !== 'string') {
		throw new TypeError('Selected visual authoring requires one exact clip selection.');
	}
	if (!Number.isSafeInteger(playhead) || Number(playhead) < 0) {
		throw new RangeError('Selected visual authoring requires an exact playhead sample.');
	}
	return Object.freeze({
		project,
		selectedClipId: selectedClipId ?? null,
		playheadSample: Number(playhead),
	});
}

function currentProject(value: unknown): Readonly<Record<string, unknown>> {
	assertFramescaperProjectIdentity(value);
	return structuredClone(value) as Readonly<Record<string, unknown>>;
}
