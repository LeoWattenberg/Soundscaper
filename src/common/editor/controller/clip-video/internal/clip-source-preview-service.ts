/* SPDX-License-Identifier: AGPL-3.0-only */

import { clipSourceTrimFields, type ClipSourceTrim } from '../../../clip-source-trim.ts';
import type { AudioEditorCommand } from '../../../commands/protocol.ts';
import type { EngineChunkSourceInput, EngineLoadProjectOptions, EngineSourceBufferInput } from '../../../engine/public-api.ts';
import type { EngineProject, EngineSourceResolver } from '../../../engine/types.ts';
import { EDITOR_PROJECT_TASK_SCOPE, type EditorControllerLifetime, type EditorProjectToken, type EditorTaskScope } from '../../shared/lifecycle.ts';
import { createClipSourcePreviewProject, sourcePreviewTarget, type ClipSourcePreviewProject } from './clip-source-preview-project.ts';

type PreviewState = 'stopped' | 'paused' | 'playing' | 'loading';
export interface ClipSourcePreviewRange { readonly startFrame: number; readonly endFrame: number }
export interface ClipSourcePreviewSnapshot {
	readonly clipId: string | null;
	readonly focused: boolean;
	readonly state: PreviewState;
	readonly positionFrame: number;
	readonly durationFrames: number;
	readonly loop: boolean;
	readonly selection: ClipSourcePreviewRange | null;
	readonly loopRange: ClipSourcePreviewRange | null;
}
export interface ClipSourcePreviewEngine {
	loadProject(project: EngineProject, buffers: EngineSourceBufferInput, options: EngineLoadProjectOptions): unknown;
	play(): Promise<unknown>;
	pause(): void;
	stop(): void;
	seek(frame: number): number;
	setLoop(enabled: boolean, startFrame: number, endFrame: number): unknown;
	setPlayRange(range: ClipSourcePreviewRange | null): unknown;
	setSourceResolver?(resolver?: EngineSourceResolver | null): unknown;
	subscribePosition(listener: (frame: number) => void): () => unknown;
	dispose(): Promise<void> | void;
}
export interface ClipSourcePreviewResources {
	readonly sourceBuffers: EngineSourceBufferInput;
	readonly sourceChunkProviders: EngineChunkSourceInput;
	readonly sourceResolver?: EngineSourceResolver;
	createEngine(options: Readonly<{ onState(state: string): void }>): ClipSourcePreviewEngine;
	prepare(project: unknown, signal: AbortSignal): Promise<unknown>;
	retirePlayback(): unknown;
	subscribeTimelineState(listener: (state: string) => void): () => unknown;
}
export interface ClipSourcePreviewDependencies {
	readonly lifetime: Pick<EditorControllerLifetime, 'assertActive' | 'signal'> & Partial<Pick<EditorControllerLifetime, 'startTask'>>;
	readonly resources?: ClipSourcePreviewResources;
	getProject(): ClipSourcePreviewProject;
	captureProject(): EditorProjectToken;
	assertProject(token: EditorProjectToken): void;
	handleError(error: unknown): void;
	editingBlocked?(): boolean;
	commit?(command: AudioEditorCommand): unknown;
}

/** Private transport authority; all async work is retired when its panel yields focus. */
export function createClipSourcePreviewService(dependencies: ClipSourcePreviewDependencies) {
	let snapshot: Readonly<ClipSourcePreviewSnapshot> = Object.freeze({ clipId: null, focused: false, state: 'stopped', positionFrame: 0, durationFrames: 0, loop: false, selection: null, loopRange: null });
	const listeners = new Set<() => void>();
	let engine: ClipSourcePreviewEngine | null = null;
	let unsubscribePosition: (() => unknown) | null = null;
	let preparation: AbortController | null = null;
	let loadedFingerprint: string | null = null;
	let disposed = false;
	let disposal: Promise<void> | null = null;
	let focusedToken: EditorProjectToken | null = null;
	let focusTask: EditorTaskScope | null = null;
	let unsubscribeTimeline: (() => unknown) | null = null;
	const onAbort = () => { void dispose().catch(dependencies.handleError); };
	dependencies.lifetime.signal.addEventListener('abort', onAbort, { once: true });
	return Object.freeze({ focus, blur, playPause, stop, seek, setLoop, setLoopRange, setSelection, snapshot: () => snapshot, subscribe, trim, dispose });

	function update(changes: Partial<ClipSourcePreviewSnapshot>): void {
		snapshot = Object.freeze({ ...snapshot, ...changes });
		for (const listener of listeners) listener();
	}

	function subscribe(listener: () => void): () => void {
		listeners.add(listener);
		return () => { listeners.delete(listener); };
	}

	function assertActive(): void {
		dependencies.lifetime.assertActive();
		if (disposed) throw new Error('The clip source preview is disposed.');
	}

	function focus(clipId: string): Readonly<ClipSourcePreviewSnapshot> {
		assertActive();
		const { range } = sourcePreviewTarget(dependencies.getProject(), clipId);
		const token = dependencies.captureProject();
		const projectChanged = focusedToken !== null && (focusedToken.projectId !== token.projectId || focusedToken.generation !== token.generation);
		if (snapshot.clipId !== clipId || projectChanged) {
			stop();
			loadedFingerprint = null;
			update({ clipId, positionFrame: range.startFrame, selection: null, loopRange: null, durationFrames: range.totalFrames });
		}
		if (snapshot.durationFrames !== range.totalFrames) {
			update({ durationFrames: range.totalFrames, positionFrame: Math.min(snapshot.positionFrame, range.totalFrames), selection: snapshot.selection && snapshot.selection.endFrame <= range.totalFrames ? snapshot.selection : null, loopRange: snapshot.loopRange && snapshot.loopRange.endFrame <= range.totalFrames ? snapshot.loopRange : null });
		}
		if (!snapshot.focused || projectChanged) {
			releaseFocusTask();
			focusedToken = token;
			focusTask = dependencies.lifetime.startTask?.('clip-source-preview-focus', { scope: EDITOR_PROJECT_TASK_SCOPE }) ?? null;
			focusTask?.signal.addEventListener('abort', blur, { once: true });
			unsubscribeTimeline ??= dependencies.resources?.subscribeTimelineState((state) => { if (state === 'playing') blur(); }) ?? null;
			dependencies.resources?.retirePlayback();
			update({ focused: true });
		}
		return snapshot;
	}

	function pause(): void {
		preparation?.abort();
		preparation = null;
		engine?.pause();
		if (snapshot.state !== 'stopped') update({ state: 'paused' });
	}

	function blur(): void {
		if (disposed) return;
		pause();
		releaseFocusTask();
		if (snapshot.focused) update({ focused: false });
	}

	async function playPause(clipId: string): Promise<void> {
		focus(clipId);
		if (snapshot.state === 'playing' || snapshot.state === 'loading') { pause(); return; }
		const resources = dependencies.resources;
		if (!resources) throw new Error('Clip source preview audio is unavailable.');
		const project = dependencies.getProject();
		const token = dependencies.captureProject();
		const preview = createClipSourcePreviewProject(project, clipId);
		const fingerprint = JSON.stringify(preview);
		const abort = new AbortController();
		preparation = abort;
		update({ state: 'loading', durationFrames: sourcePreviewTarget(project, clipId).range.totalFrames });
		try {
			resources.retirePlayback();
			await resources.prepare(project, abort.signal);
			if (!isCurrent()) return;
			dependencies.assertProject(token);
			if (!engine) {
				engine = resources.createEngine({ onState: (state) => {
					if (disposed || !snapshot.focused || snapshot.state === 'loading') return;
					update({ state: state === 'playing' ? 'playing' : state === 'paused' ? 'paused' : 'stopped' });
				} });
				unsubscribePosition = engine.subscribePosition((positionFrame) => {
					if (disposed) return;
					try { if (focusedToken) dependencies.assertProject(focusedToken); } catch { blur(); return; }
					update({ positionFrame });
				});
				engine.setSourceResolver?.(resources.sourceResolver);
			}
			const savedPosition = snapshot.positionFrame;
			if (loadedFingerprint !== fingerprint) {
				engine.loadProject(preview, resources.sourceBuffers, { chunkSources: resources.sourceChunkProviders });
				loadedFingerprint = fingerprint;
			}
			configureRange();
			const playRange = snapshot.loop ? snapshot.loopRange ?? snapshot.selection : snapshot.selection;
			const start = playRange?.startFrame ?? 0;
			const end = playRange?.endFrame ?? snapshot.durationFrames;
			engine.seek(savedPosition < start || savedPosition >= end ? start : savedPosition);
			update({ state: 'playing' });
			await engine.play();
			if (isCurrent()) dependencies.assertProject(token);
		} catch (error) {
			if (!isCurrent()) return;
			engine?.pause();
			update({ state: 'paused' });
			throw error;
		} finally {
			if (preparation === abort) preparation = null;
		}
		function isCurrent(): boolean { return !disposed && !abort.signal.aborted && preparation === abort && snapshot.clipId === clipId && snapshot.focused; }
	}

	function stop(): void {
		preparation?.abort();
		preparation = null;
		engine?.stop();
		update({ state: 'stopped', positionFrame: 0 });
	}

	function seek(frame: number): number {
		assertActive();
		const positionFrame = Math.max(0, Math.min(snapshot.durationFrames, Math.round(frame)));
		if (!Number.isFinite(positionFrame)) throw new RangeError('Source preview position must be finite.');
		engine?.seek(positionFrame);
		update({ positionFrame });
		return positionFrame;
	}

	function setLoop(enabled: boolean): void {
		assertActive();
		update({ loop: Boolean(enabled) });
		configureRange();
	}

	function validateRange(range: ClipSourcePreviewRange | null): void {
		assertActive();
		if (range && (!Number.isSafeInteger(range.startFrame) || !Number.isSafeInteger(range.endFrame) || range.startFrame < 0 || range.endFrame <= range.startFrame || range.endFrame > snapshot.durationFrames)) throw new RangeError('Source preview selection must remain within the source timeline.');
	}

	function setSelection(range: ClipSourcePreviewRange | null): void {
		validateRange(range);
		update({ selection: range && Object.freeze({ ...range }) });
		configureRange();
	}

	function setLoopRange(range: ClipSourcePreviewRange | null): void {
		validateRange(range);
		update({ loopRange: range && Object.freeze({ ...range }) });
		configureRange();
	}

	function configureRange(): void {
		const range = snapshot.loopRange ?? snapshot.selection;
		engine?.setLoop(snapshot.loop, range?.startFrame ?? 0, range?.endFrame ?? snapshot.durationFrames);
		engine?.setPlayRange(snapshot.loop ? null : snapshot.selection);
	}

	function trim(clipId: string, changes: ClipSourceTrim): unknown {
		assertActive();
		if (dependencies.editingBlocked?.()) throw new Error('Editing is blocked.');
		if (!dependencies.commit) throw new Error('Source trimming is unavailable.');
		const project = dependencies.getProject();
		const { clip, source } = sourcePreviewTarget(project, clipId);
		clipSourceTrimFields(project, clip, source, changes);
		stop();
		return dependencies.commit({ type: 'clip/trim', clipId, sourceRange: true, ...changes });
	}

	function releaseFocusTask(): void {
		focusTask?.signal.removeEventListener('abort', blur);
		focusTask?.finish();
		focusTask = null;
	}

	function dispose(): Promise<void> {
		if (disposal) return disposal;
		stop();
		disposed = true;
		releaseFocusTask();
		dependencies.lifetime.signal.removeEventListener('abort', onAbort);
		unsubscribeTimeline?.();
		unsubscribePosition?.();
		listeners.clear();
		const owned = engine;
		engine = null;
		disposal = Promise.resolve().then(() => owned?.dispose());
		return disposal;
	}
}
