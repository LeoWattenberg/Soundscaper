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
 * Two details make cancelling stick and stay useful. The placeholder closes the
 * surface it stood in for, through the `onClose` the caller already passes every
 * lazy dialog, so the surface is not left open and empty - which would otherwise
 * make its menu entry inert for the rest of the session, because `React.lazy`
 * has cached this resolution and the surface state never changes again. And its
 * first mount stays silent: the load that produced it has already reported, and
 * a module resolves measurably later than the probe answers, so reporting there
 * too would pop the prompt back up seconds after the user dismissed it. Every
 * later mount does report, which is what lets a user who cancelled, kept
 * working, and reached for that surface again see the explanation a second time.
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
	let mounted = false;
	return function RetiredModule(props: Props) {
		const close = (props as { onClose?: () => void }).onClose;
		useEffect(() => {
			if (mounted) reportStaleBuildCandidate(error);
			mounted = true;
			close?.();
			// The failure is reported once by the load and once per re-attempt after
			// it; `close` is read at mount and never changes for a given surface.
			// eslint-disable-next-line react-hooks/exhaustive-deps
		}, []);
		return null;
	};
}
