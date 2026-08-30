import { useCallback, useEffect, useMemo, useRef } from 'react';

import { createAudioEditorSearchEntries } from '../../search.js';
import { handleProjectZoomShortcut } from '../workspace-shortcuts.ts';
import { runAwaitedAudioEditorOperation } from './audio-editor-workspace-runner.ts';

export function useWorkspaceSearchRuntime({
	applicationMenus,
	controller,
	openWorkspacePanel,
	parityRuntime,
	project,
	run,
	setProjectBinSearchReveal,
	setTimelineSearchReveal,
}) {
	const searchRevealRevisionRef = useRef(0);
	useEffect(() => {
		const handleBrowserZoomShortcut = (event) => {
			handleProjectZoomShortcut(event, run, {
				actionRuntime: parityRuntime.actions,
				menus: applicationMenus,
			});
		};
		document.addEventListener('keydown', handleBrowserZoomShortcut, true);
		return () => document.removeEventListener('keydown', handleBrowserZoomShortcut, true);
	}, [applicationMenus, parityRuntime.actions, run]);
	const searchEntries = useMemo(() => createAudioEditorSearchEntries({
		menus: applicationMenus,
		project,
	}), [applicationMenus, project]);
	const activateSearchEntry = useCallback((entry) => {
		if (!entry || entry.disabled) return;
		if (entry.kind === 'command') {
			if (typeof entry.handler === 'function') run(entry.handler);
			return;
		}
		if (entry.kind === 'assistance') {
			const timelineFrame = entry.target?.timelineFrame;
			if (!Number.isSafeInteger(timelineFrame) || timelineFrame < 0) return;
			run(() => controller.actions.transport.seek(timelineFrame));
			return;
		}
		const revision = searchRevealRevisionRef.current + 1;
		searchRevealRevisionRef.current = revision;
		if (entry.kind === 'timeline') {
			const clipId = entry.target?.clipId;
			if (!clipId) return;
			void runAwaitedAudioEditorOperation(
				run,
				() => controller.actions.timeline.selectClip(clipId),
			).then(() => {
				if (searchRevealRevisionRef.current === revision) {
					setTimelineSearchReveal({ clipId, revision });
				}
			}).catch(() => undefined);
			return;
		}
		if (entry.kind === 'project-bin') {
			const binItemId = entry.target?.binItemId;
			if (!binItemId) return;
			openWorkspacePanel('project-bin');
			setProjectBinSearchReveal({ binItemId, revision });
		}
	}, [controller, openWorkspacePanel, run, setProjectBinSearchReveal, setTimelineSearchReveal]);

	return { activateSearchEntry, searchEntries };
}
