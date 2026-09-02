/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * `React.lazy` for chunks that a retired deploy can take away.
 *
 * A lazily loaded surface that cannot be fetched used to throw through the
 * editor's top-level error boundary, replacing the whole application with an
 * error message - so a user whose tab had merely gone stale lost the editor, not
 * just the dialog they asked for. Resolving to a component that renders nothing
 * keeps the failure the size of the feature: the surface does not open, the
 * editor is untouched, and the stale-build prompt says why.
 *
 * Only a chunk that did not arrive is absorbed. A fault inside a chunk that
 * loaded is a real defect and is rethrown to the boundary, where it belongs.
 *
 * The placeholder reports again whenever it mounts. That is what lets a user who
 * cancelled the prompt, kept working, and later reached for the same surface see
 * the explanation a second time, even though `React.lazy` has cached the
 * resolution and will never retry the import.
 */

import { lazy, useEffect, type ComponentType, type LazyExoticComponent } from 'react';

import { isModuleLoadFailure } from './stale-build.ts';
import { reportStaleBuildCandidate } from './stale-build-runtime.ts';

type ModuleLoader<Props> = () => Promise<{ default: ComponentType<Props> }>;

export function lazyEditorModule<Props extends object>(
	load: ModuleLoader<Props>,
): LazyExoticComponent<ComponentType<Props>> {
	return lazy(resilientModuleLoader(load));
}

/** The absorbing half of `lazyEditorModule`, separated so it can be exercised without React. */
export function resilientModuleLoader<Props extends object>(load: ModuleLoader<Props>): ModuleLoader<Props> {
	return async () => {
		try {
			return await load();
		} catch (error) {
			if (!isModuleLoadFailure(error)) throw error;
			reportStaleBuildCandidate(error);
			return { default: retiredModulePlaceholder<Props>(error) };
		}
	};
}

function retiredModulePlaceholder<Props extends object>(error: unknown): ComponentType<Props> {
	return function RetiredModule() {
		useEffect(() => { reportStaleBuildCandidate(error); }, []);
		return null;
	};
}
