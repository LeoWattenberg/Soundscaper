/* SPDX-License-Identifier: AGPL-3.0-only */

import { Suspense, useCallback, useEffect, useState } from 'react';

import { lazyEditorModule } from '../../../offline/lazy-module.tsx';

const AudioEditorEffectsOverlay = lazyEditorModule(
	() => import('../inspector/AudioEditorEffectsOverlay.jsx'),
);

export interface WorkspaceEffectWindow {
	readonly trackId: string | null;
	readonly scope: string;
	readonly selectedEffect: Readonly<{ readonly scope: string; readonly id: string }>;
}

interface EffectWindowSession {
	readonly projectId: string | null;
	readonly windows: readonly WorkspaceEffectWindow[];
}

const EMPTY_EFFECT_WINDOWS: readonly WorkspaceEffectWindow[] = Object.freeze([]);

export function workspaceEffectWindowKey(window: WorkspaceEffectWindow): string {
	return JSON.stringify([
		window.selectedEffect.scope,
		window.trackId,
		window.selectedEffect.id,
	]);
}

export function useWorkspaceEffectWindows(projectId: string | null) {
	const [session, setSession] = useState<EffectWindowSession>(() => ({
		projectId,
		windows: EMPTY_EFFECT_WINDOWS,
	}));
	useEffect(() => {
		setSession((current) => current.projectId === projectId
			? current
			: { projectId, windows: EMPTY_EFFECT_WINDOWS });
	}, [projectId]);
	const open = useCallback((window: WorkspaceEffectWindow) => {
		setSession((current) => {
			const windows = current.projectId === projectId
				? current.windows
				: EMPTY_EFFECT_WINDOWS;
			const key = workspaceEffectWindowKey(window);
			if (windows.some((candidate) => workspaceEffectWindowKey(candidate) === key)) {
				return current.projectId === projectId ? current : { projectId, windows };
			}
			return { projectId, windows: [...windows, window] };
		});
	}, [projectId]);
	const close = useCallback((key: string) => {
		setSession((current) => {
			if (current.projectId !== projectId) return { projectId, windows: EMPTY_EFFECT_WINDOWS };
			const windows = current.windows.filter(
				(window) => workspaceEffectWindowKey(window) !== key,
			);
			return windows.length === current.windows.length ? current : { projectId, windows };
		});
	}, [projectId]);
	return {
		windows: session.projectId === projectId ? session.windows : EMPTY_EFFECT_WINDOWS,
		open,
		close,
	};
}

interface WorkspaceEffectWindowsProps {
	readonly windows: readonly WorkspaceEffectWindow[];
	readonly close: (key: string) => void;
	readonly controller: unknown;
	readonly snapshot: unknown;
	readonly copy: unknown;
	readonly fileService: unknown;
	readonly locale: string;
}

export default function WorkspaceEffectWindows({
	windows,
	close,
	controller,
	snapshot,
	copy,
	fileService,
	locale,
}: WorkspaceEffectWindowsProps) {
	return windows.map((window) => {
		const key = workspaceEffectWindowKey(window);
		return <div data-effects-window-host data-effect-window={window.selectedEffect.id} key={key}>
			<Suspense fallback={null}>
				<AudioEditorEffectsOverlay
					isOpen
					controller={controller}
					snapshot={snapshot}
					copy={copy}
					fileService={fileService}
					locale={locale}
					trackId={window.trackId}
					scope={window.scope}
					selectedEffect={window.selectedEffect}
					onClose={() => close(key)}
					onSelectedEffectChange={(selectedEffect: unknown) => {
						if (!selectedEffect) close(key);
					}}
					renderRack={false}
				/>
			</Suspense>
		</div>;
	});
}
