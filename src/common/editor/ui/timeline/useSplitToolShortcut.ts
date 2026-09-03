/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, useState, type RefObject } from 'react';

interface SplitToolShortcutOptions {
	readonly bindings: readonly string[];
	readonly persistentEnabled: boolean;
	readonly projectId: string | null;
	readonly onTogglePersistent: () => void;
	readonly rootRef: RefObject<Element | null>;
}

export interface SplitToolShortcutState {
	readonly momentaryEnabled: boolean;
}

const INACTIVE_SPLIT_TOOL_SHORTCUT = Object.freeze({
	momentaryEnabled: false,
});

/** Own Split Tool's global tap/hold lifecycle even while the timeline is hidden. */
export function useSplitToolShortcut({
	bindings,
	persistentEnabled,
	projectId,
	onTogglePersistent,
	rootRef,
}: SplitToolShortcutOptions): SplitToolShortcutState {
	const [shortcutState, setShortcutState] = useState<SplitToolShortcutState>(INACTIVE_SPLIT_TOOL_SHORTCUT);
	const lifecycleRef = useRef<import('./split-tool-shortcut.ts').SplitToolShortcutLifecycle | null>(null);
	const runtimeRef = useRef<typeof import('./split-tool-shortcut.ts') | null>(null);
	const previousProjectIdRef = useRef(projectId);
	const persistentEnabledRef = useRef(persistentEnabled);
	const projectOpenRef = useRef(projectId !== null);
	persistentEnabledRef.current = persistentEnabled;
	projectOpenRef.current = projectId !== null;

	useEffect(() => {
		let subscribed = true;
		let dispose = (): void => undefined;
		const install = (runtime: typeof import('./split-tool-shortcut.ts')): void => {
			const installed = runtime.installSplitToolShortcutListeners({
				bindings,
				persistentEnabled: persistentEnabledRef.current,
				getPersistentEnabled: () => persistentEnabledRef.current,
				getProjectOpen: () => projectOpenRef.current,
				getRoot: () => rootRef.current,
				onMomentaryChange: (momentaryEnabled) => {
					setShortcutState(momentaryEnabled ? Object.freeze({ momentaryEnabled }) : INACTIVE_SPLIT_TOOL_SHORTCUT);
				},
				onTogglePersistent,
			});
			lifecycleRef.current = installed.lifecycle;
			dispose = () => {
				installed.dispose();
				if (lifecycleRef.current === installed.lifecycle) lifecycleRef.current = null;
			};
		};
		if (runtimeRef.current) install(runtimeRef.current);
		else {
			void import('./split-tool-shortcut.ts').then((runtime) => {
				runtimeRef.current = runtime;
				if (subscribed) install(runtime);
			});
		}
		return () => {
			subscribed = false;
			dispose();
		};
	}, [bindings, onTogglePersistent, rootRef]);

	useEffect(() => {
		if (previousProjectIdRef.current === projectId) return;
		previousProjectIdRef.current = projectId;
		const lifecycle = lifecycleRef.current;
		lifecycle?.setPersistentEnabled(persistentEnabledRef.current);
		lifecycle?.handleBlur();
	}, [projectId]);

	return shortcutState;
}
