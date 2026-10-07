/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { projectForRuntimeConsumers } from '../../project-current-runtime.ts';
import type { RuntimeClipProject } from '../../runtime-clip-projection.ts';
import type { ClipPropertiesFocusRequest } from '../../controller/composition/clip-properties-panel-opening.ts';
import ClipPropertiesBody from './ClipPropertiesBody.jsx';
import ImageClipPropertiesBody from './ImageClipPropertiesBody.tsx';
import ClipSourceEditor from './ClipSourceEditor.tsx';
import { selectAudioEditorEditBlock } from '../edit-blocking.ts';
import { feedbackFailure, usePresentationFeedback } from '../presentation-feedback.ts';
import type { ClipSourceController, ClipSourceProject } from './clip-source-editor-types.ts';
import {
	clipPropertiesSelection,
	reconcileClipPropertiesTarget,
	type ClipPropertiesSelectionSnapshot,
	type ClipPropertiesTarget,
} from './clip-properties-selection.ts';

export type { ClipPropertiesFocusRequest } from '../../controller/composition/clip-properties-panel-opening.ts';

interface ClipPropertiesPanelProps {
	readonly controller: object;
	readonly snapshot: ClipPropertiesSelectionSnapshot & Readonly<Record<string, unknown>>;
	readonly copy: Readonly<Record<string, string>>;
	readonly focusRequest?: ClipPropertiesFocusRequest | null;
	readonly panelActive?: boolean;
	readonly runtimeProject?: RuntimeClipProject | null;
}

/** A live inspector whose local tabs never rewrite the timeline's selection. */
export default function ClipPropertiesPanel({ controller, snapshot, copy, focusRequest = null, panelActive = true, runtimeProject = null }: ClipPropertiesPanelProps) {
	const selection = clipPropertiesSelection(snapshot, copy.clip);
	const [error, setError] = usePresentationFeedback(copy);
	const [storedTarget, setStoredTarget] = useState<ClipPropertiesTarget>({ projectId: null, clipId: null });
	const handledFocus = useRef<ClipPropertiesFocusRequest | null>(null);
	const pendingFocus = focusRequest && handledFocus.current !== focusRequest
		&& (focusRequest.projectId === undefined || focusRequest.projectId === selection.projectId);
	const target = reconcileClipPropertiesTarget(storedTarget, selection);
	const activeClipId = pendingFocus && selection.clips.some(({ id }) => id === focusRequest.clipId)
		? focusRequest.clipId ?? target.clipId : target.clipId;
	const bodyRef = useRef<HTMLDivElement>(null);
	const tabRefs = useRef(new Map<string, HTMLButtonElement>());
	const baseId = useId();
	const bodyId = `${baseId}-properties`;
	const tabId = (clipId: string) => `${baseId}-clip-${encodeURIComponent(clipId)}`;
	const multiple = selection.clips.length > 1;

	useEffect(() => {
		setStoredTarget((previous) => previous.projectId === selection.projectId && previous.clipId === activeClipId
			? previous : { projectId: selection.projectId, clipId: activeClipId });
	}, [selection.projectId, activeClipId]);
	useEffect(() => {
		if (!panelActive || !focusRequest || handledFocus.current === focusRequest) return;
		const acknowledge = () => { handledFocus.current = focusRequest; focusRequest.onHandled?.(); };
		const wrongProject = focusRequest.projectId !== undefined && focusRequest.projectId !== selection.projectId;
		const removedClip = focusRequest.clipId !== null && !selection.clips.some(({ id }) => id === focusRequest.clipId);
		if (wrongProject || removedClip || !activeClipId) { acknowledge(); return; }
		const field = focusRequest.field;
		const input = field ? bodyRef.current?.querySelector(`[data-clip-field="${field}"]`)?.querySelector<HTMLInputElement>('input') : null;
		const drawer = input?.closest('details');
		if (input && !input.disabled && drawer) drawer.open = true;
		const focusTarget = input && !input.disabled ? input : bodyRef.current;
		if (!focusTarget) return;
		focusTarget.focus();
		acknowledge();
	}, [focusRequest, panelActive, activeClipId, selection.projectId, selection.clips]);

	const activateTab = (clipId: string) => setStoredTarget({ projectId: selection.projectId, clipId });
	const handleTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
		let nextIndex: number;
		if (event.key === 'ArrowRight') nextIndex = (index + 1) % selection.clips.length;
		else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + selection.clips.length) % selection.clips.length;
		else if (event.key === 'Home') nextIndex = 0;
		else if (event.key === 'End') nextIndex = selection.clips.length - 1;
		else return;
		event.preventDefault();
		const nextClip = selection.clips[nextIndex];
		if (!nextClip) return;
		activateTab(nextClip.id);
		tabRefs.current.get(nextClip.id)?.focus();
	};

	const sourceController = controller as ClipSourceController;
	const persistedProject = snapshot.project;
	const sourceProject = useMemo(() => {
		const project = runtimeProject ?? persistedProject;
		return project ? projectForRuntimeConsumers(project as ClipSourceProject & RuntimeClipProject) : null;
	}, [persistedProject, runtimeProject]);
	const runtimeSnapshot = sourceProject ? { ...snapshot, project: sourceProject } : snapshot;
	const sourceClip = sourceProject?.clips.find(clip => clip.id === activeClipId);
	const hasSourceEditor = panelActive && sourceClip?.kind === 'audio' && sourceController.actions?.clipSourcePreview
		&& sourceProject?.sources.some(source => source.id === sourceClip.sourceId);
	const handlePlaybackKey = (event: KeyboardEvent<HTMLDivElement>) => {
		if (!hasSourceEditor || !activeClipId || event.defaultPrevented || event.code !== 'Space' || event.altKey || event.ctrlKey || event.metaKey) return;
		event.stopPropagation();
		if (event.target instanceof Element && event.target.closest('input, textarea, select, button, a, summary, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="slider"], [role="spinbutton"]')) return;
		event.preventDefault();
		setError('');
		try { void Promise.resolve(sourceController.actions.clipSourcePreview.playPause(activeClipId)).catch(cause => setError(feedbackFailure(cause))); }
		catch (cause) { setError(feedbackFailure(cause)); }
	};

	return <div className="audio-editor-clip-properties-panel" data-clip-properties-panel>
		{multiple && <div className="audio-editor-clip-properties-panel__tabs" role="tablist" aria-label={copy.clipPropertiesSelectedClips}>
			{selection.clips.map((clip, index) => <button key={clip.id} type="button" role="tab"
				id={tabId(clip.id)} aria-controls={bodyId} aria-selected={clip.id === activeClipId}
				tabIndex={clip.id === activeClipId ? 0 : -1} data-clip-properties-tab={clip.id} title={clip.label}
				ref={(node) => { if (node) tabRefs.current.set(clip.id, node); else tabRefs.current.delete(clip.id); }}
				onClick={() => activateTab(clip.id)} onKeyDown={(event) => handleTabKey(event, index)}>{clip.label}</button>)}
		</div>}
		{activeClipId ? <div ref={bodyRef} id={bodyId} role={multiple ? 'tabpanel' : undefined}
			aria-labelledby={multiple ? tabId(activeClipId) : undefined} tabIndex={-1} data-clip-properties-active-clip={activeClipId}
			onKeyDown={handlePlaybackKey}
			onFocusCapture={() => { if (hasSourceEditor && activeClipId) sourceController.actions.clipSourcePreview.focus(activeClipId); }}>
			{hasSourceEditor && sourceProject && activeClipId && <ClipSourceEditor key={`source:${sourceProject.id}:${activeClipId}`} controller={sourceController}
				project={sourceProject} clipId={activeClipId} copy={copy} blocked={selectAudioEditorEditBlock(snapshot as Parameters<typeof selectAudioEditorEditBlock>[0]).blocked} />}
			{sourceClip?.kind === 'image' ? <ImageClipPropertiesBody key={JSON.stringify([selection.projectId, activeClipId])}
				controller={controller} project={persistedProject} clipId={activeClipId} copy={copy}
				disabled={selectAudioEditorEditBlock(snapshot as Parameters<typeof selectAudioEditorEditBlock>[0]).blocked} />
				: <ClipPropertiesBody key={JSON.stringify([selection.projectId, activeClipId])} controller={controller}
					snapshot={runtimeSnapshot} copy={copy} clipId={activeClipId} />}
		</div> : <p className="audio-editor-panel-hint" data-no-clip>{copy.noClipSelected}</p>}
		{error && <p role="alert">{error}</p>}
	</div>;
}
