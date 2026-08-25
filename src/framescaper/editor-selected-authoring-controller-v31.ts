/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorProjectStore } from '../common/editor/storage.js';
import {
	bindFramescaperCandidateAuthoringActionRuntime,
	framescaperCandidateAuthoringActionRuntimeFor,
} from '../common/editor/ui/framescaper-candidate-authoring-actions.ts';
import {
	createFramescaperControllerFoundationViewV31,
	type FramescaperControllerFoundationViewV31,
} from './editor-controller-v31-foundation-view.ts';
import {
	adoptFramescaperSelectedVisualAuthoringRuntimeV27,
	bindFramescaperSelectedAuthoringControllerV28,
	type FramescaperSelectedAuthoringControllerV28,
} from './editor-selected-v27-authoring-controller.ts';

/** Bind inherited authoring to the real F31 owner through one V28 project view. */
export function bindFramescaperSelectedAuthoringControllerV31(options: Readonly<{
	readonly controller: FramescaperSelectedAuthoringControllerV28;
	readonly store: AudioEditorProjectStore;
}>): void {
	const controller = options?.controller;
	if (!controller || typeof controller !== 'object') {
		throw new TypeError('Selected F31 authoring requires its controller owner.');
	}
	const view = createFramescaperControllerFoundationViewV31(controller) as unknown as
		FramescaperSelectedAuthoringControllerV28 & FramescaperControllerFoundationViewV31;
	bindFramescaperSelectedAuthoringControllerV28({ controller: view, store: options.store });
	const runtime = framescaperCandidateAuthoringActionRuntimeFor(view);
	if (!runtime) throw new Error('Selected F31 authoring lost its inherited action runtime.');
	bindFramescaperCandidateAuthoringActionRuntime(controller, runtime);
	adoptFramescaperSelectedVisualAuthoringRuntimeV27(view, controller);
}
