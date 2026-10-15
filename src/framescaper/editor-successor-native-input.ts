/* SPDX-License-Identifier: AGPL-3.0-only */
import { canonicalJsonSha256 } from '../common/canonical-json-sha256.ts';
import { EditorProjectChangedError } from '../common/editor/controller/shared/lifecycle.ts';
import type { createAudioEditorController } from '../common/editor/app.js';
import type { ProductNativeRenderInputOperation } from '../common/editor/controller/composition/product-native-render-input-authority.ts';
import type { FramescaperCompositionLinkOwnerReceipt } from './editor-composition-link-owner-repository.ts';
import type { FramescaperSuccessorEnvironment } from './editor-project-successor-environment.ts';
import { normalizeFramescaperSuccessorProject, type FramescaperSuccessorProject } from './editor-project-successor.ts';
import type { createFramescaperSuccessorNativeAudioLease } from './editor-successor-native-audio-lease.ts';

type Controller = ReturnType<typeof createAudioEditorController>;
export interface FramescaperSuccessorNativeInputOperation extends Omit<ProductNativeRenderInputOperation, 'finish'> {
	prepare(): Promise<void>;
	releaseMedia(): Promise<void>;
	finish(): Promise<void>;
}
interface Active {
	readonly abort: (reason: unknown) => void;
	readonly permit: (before: FramescaperSuccessorProject, after: FramescaperSuccessorProject) => (success: boolean) => void;
}
/** Only the durable compatible-receive publisher can renew a captured delivery's live document authority. */
export function createFramescaperSuccessorNativeInput(controller: Controller, environment: FramescaperSuccessorEnvironment) {
	let active: Active | null = null;
	const nativeInput = Object.freeze({ begin(options: Readonly<{ signal?: AbortSignal }> = {}): FramescaperSuccessorNativeInputOperation {
		if (active) { active.abort(new DOMException('The native export was superseded.', 'AbortError')); throw new Error('Finish native export cleanup before starting another export.'); }
		const project = normalizeFramescaperSuccessorProject(controller.project), abort = new AbortController();
		const pcmDigest = canonicalJsonSha256(environment.playback.projectForPlayback(project).project);
		let token = controller.captureProjectGeneration(project.id), expected = canonicalJsonSha256(project), reference = controller.project;
		let adopting: { before: object; after: string; adopted: object | null } | null = null, finished = false;
		const cancel = (reason: unknown) => { abort.abort(reason); };
		const cancelFromCaller = () => cancel(options.signal?.reason);
		if (options.signal?.aborted) cancelFromCaller(); else options.signal?.addEventListener('abort', cancelFromCaller, { once: true });
		const assertCurrent = () => {
			abort.signal.throwIfAborted();
			const snapshot = controller.getSnapshot();
			if (finished || snapshot.disposed || snapshot.phase === 'disposing' || snapshot.phase === 'disposed') throw new EditorProjectChangedError();
			const value = controller.project;
			if (!value || value.id !== project.id) throw new EditorProjectChangedError();
			if (adopting) {
				if (value === adopting.before || value === adopting.adopted) return;
				if (adopting.adopted || canonicalJsonSha256(normalizeFramescaperSuccessorProject(value)) !== adopting.after) throw new EditorProjectChangedError();
				adopting.adopted = value;
			} else { controller.assertProjectGeneration(token); if (value !== reference) throw new EditorProjectChangedError(); }
		};
		const unsubscribe = controller.subscribe(() => { try { assertCurrent(); } catch (error) { cancel(error); } });
		let audio: ReturnType<typeof createFramescaperSuccessorNativeAudioLease> | null = null, preparing: Promise<void> | null = null;
		const prepare = async () => {
			assertCurrent(); preparing ??= (async () => {
				const { createFramescaperSuccessorNativeAudioLease } = await import('./editor-successor-native-audio-lease.ts'); assertCurrent();
				audio = createFramescaperSuccessorNativeAudioLease(environment, project, abort.signal, assertCurrent, () => { if (finished && active === owner) active = null; });
				await audio.prepare();
			})(); await preparing;
		};
		const releaseMedia = async () => { if (preparing) await preparing.catch(() => undefined); await audio?.release(); };
		const renderAudioToSink: NonNullable<ProductNativeRenderInputOperation['renderAudioToSink']> = async (project, range, sink) => {
			if (canonicalJsonSha256(project) !== pcmDigest) throw new Error('The native PCM request differs from its captured project.');
			await prepare(); if (!audio) throw new Error('Pinned native PCM inputs are absent.'); return audio.renderAudioToSink(project, range, sink);
		};
		const owner: Active = { abort: cancel, permit(before, after) {
			assertCurrent(); if (adopting || canonicalJsonSha256(before) !== expected) throw new EditorProjectChangedError();
			if (!reference) throw new EditorProjectChangedError();
			const permit = { before: reference, after: canonicalJsonSha256(after), adopted: null as object | null }; adopting = permit;
			return success => {
				if (adopting !== permit) throw new EditorProjectChangedError(); adopting = null;
				if (!success) { cancel(new EditorProjectChangedError()); return; }
				try {
					const value = controller.project;
					if (!value || (permit.adopted ? value !== permit.adopted : canonicalJsonSha256(normalizeFramescaperSuccessorProject(value)) !== permit.after)) throw new EditorProjectChangedError();
					token = controller.captureProjectGeneration(project.id); expected = permit.after; reference = value; assertCurrent();
				} catch (error) { cancel(error); throw error; }
			};
		} };
		active = owner;
		return Object.freeze({ project, signal: abort.signal, assertCurrent, prepare, releaseMedia,
			renderAudio: async () => { throw new Error('Captured Frame export requires bounded PCM streaming.'); }, renderAudioToSink,
			async finish() {
				finished = true; unsubscribe(); cancel(new DOMException('The native export input finished.', 'AbortError')); options.signal?.removeEventListener('abort', cancelFromCaller);
				await releaseMedia(); if (active === owner) active = null;
			},
		});
	} });
	async function adoptSavedRevision(before: FramescaperSuccessorProject, receipt: FramescaperCompositionLinkOwnerReceipt, adopt: () => Promise<unknown>): Promise<void> {
		const after = receipt.project, current = normalizeFramescaperSuccessorProject(controller.project);
		const durable = await environment.owners.loadOwner(before.id);
		if (before.id !== after.id || canonicalJsonSha256(current) !== canonicalJsonSha256(before)
			|| !durable || durable.ownerDigest !== receipt.ownerDigest || canonicalJsonSha256(durable.project) !== canonicalJsonSha256(after)
			|| !compatible(before, after)) throw new Error('Native export adoption requires the exact durable compatible saved receipt.');
		const complete = active?.permit(before, after); let success = false;
		try { await adopt(); success = true; } finally { complete?.(success); }
	}
	return Object.freeze({ nativeInput, adoptSavedRevision });
}
function compatible(before: FramescaperSuccessorProject, after: FramescaperSuccessorProject): boolean {
	if (before.compositionLinks.length !== after.compositionLinks.length || before.sampleRate !== after.sampleRate) return false;
	let changed = false;
	for (const link of before.compositionLinks) {
		const next = after.compositionLinks.find(value => value.sourceId === link.sourceId);
		if (!next || next.projectId !== link.projectId || next.compositionId !== link.compositionId || JSON.stringify(next.output) !== JSON.stringify(link.output)) return false;
		if (next.acceptedDigest !== link.acceptedDigest) { if (next.acceptedRevision <= link.acceptedRevision) return false; changed = true; }
	}
	return changed;
}
