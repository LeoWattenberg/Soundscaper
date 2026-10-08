/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AraClipEditingRuntime } from '../../../ara-clip-editing-runtime.ts';
import type { AraClipEditingDependencies } from './ara-clip-editing.ts';

/** Keep native clip publication out of both browser startup graphs. */
export function createDeferredAraClipEditingRuntime(
	dependencies: AraClipEditingDependencies,
): Readonly<AraClipEditingRuntime> {
	let runtime: Promise<AraClipEditingRuntime> | null = null;
	return Object.freeze({
		prepare: async (options = {}) => {
			const project = dependencies.getProject();
			const clipId = dependencies.getSelectedClipId();
			const token = dependencies.projectGeneration.capture();
			runtime ??= import('./ara-clip-editing.ts').then(({ createAraClipEditingRuntime }) => createAraClipEditingRuntime(dependencies));
			const loaded = await runtime;
			dependencies.projectGeneration.assertCurrent(token);
			if (dependencies.getProject() !== project || dependencies.getSelectedClipId() !== clipId) {
				throw new Error('The selected clip or project changed while loading ARA editing.');
			}
			return loaded.prepare(options);
		},
	});
}
