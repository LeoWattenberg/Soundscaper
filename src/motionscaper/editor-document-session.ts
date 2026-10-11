/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ScapeProjectInput } from '../common/editor/scape-project-input.ts';
import { motionDocumentFileName } from './editor-document-file-name.ts';
import type { MotionLayerDraft } from './editor-layer-authoring.ts';
import type { MotionAsset } from '../common/editor/motion-asset.ts';
import type { Rational } from '../common/editor/timeline-time.ts';
import { createMotionscaperProject } from './editor-project.ts';
import { applyMotionscaperCommands, createMotionscaperHistory, type MotionscaperHistory, type MotionscaperProjectCommand } from './editor-project-commands.ts';
import type { MotionscaperProject } from './editor-project-types.ts';
import type { MotionscaperProjectStore } from './editor-project-store.ts';
import { createMotionscaperRevision } from './editor-project-revision.ts';
import type { MotionArchiveReview, MotionArchiveOpenAction, MotionArchiveOpenReceipt } from './editor-document-import.ts';
import { MotionProjectConflictError, MotionProjectLeaseError, type MotionProjectWriteLease } from './editor-project-write-lease.ts';

export interface MotionProjectSettings {
	readonly title: string; readonly width: number; readonly height: number;
	readonly frameRate: Rational; readonly durationFrames: number;
}
export interface MotionscaperDocumentSnapshot {
	readonly project: MotionscaperProject | null; readonly savedDigest: string | null;
	readonly dirty: boolean; readonly busy: boolean; readonly canUndo: boolean; readonly canRedo: boolean;
}
export const EMPTY_MOTION_DOCUMENT: MotionscaperDocumentSnapshot = Object.freeze({
	project: null, savedDigest: null, dirty: false, busy: false, canUndo: false, canRedo: false,
});
export class UnsupportedMotionArchiveError extends Error {
	constructor() { super('This archive belongs to a different product or a newer Motionscaper version.'); this.name = 'UnsupportedMotionArchiveError'; }
}

/** A command session publishes only complete saved snapshots; edits retain a separate recovery draft. */
export class MotionscaperDocumentSession {
	readonly #store: MotionscaperProjectStore;
	readonly #randomId: () => string;
	readonly #listeners = new Set<() => void>();
	#history: MotionscaperHistory | null = null;
	#snapshot = EMPTY_MOTION_DOCUMENT;
	#lease: MotionProjectWriteLease | null = null;
	#disposed = false;
	readonly #archiveReviews = new WeakMap<MotionArchiveReview, { input: ScapeProjectInput; project: MotionscaperProject | null; savedDigest: string | null }>();

	constructor(store: MotionscaperProjectStore, randomId: () => string = () => crypto.randomUUID()) {
		this.#store = store; this.#randomId = randomId;
	}
	getSnapshot = (): MotionscaperDocumentSnapshot => this.#snapshot;
	subscribe = (listener: () => void): (() => void) => {
		this.#listeners.add(listener);
		return () => { this.#listeners.delete(listener); };
	};
	#update(values: Partial<MotionscaperDocumentSnapshot> = {}): void {
		this.#snapshot = Object.freeze({ ...this.#snapshot, ...this.#history?.snapshot(), ...values });
		for (const listener of this.#listeners) listener();
	}
	async #run<T>(operation: () => Promise<T>): Promise<T> {
		if (this.#disposed) throw new MotionProjectLeaseError();
		if (this.#snapshot.busy) throw new Error('Another motion document operation is still running.');
		this.#update({ busy: true });
		try { return await operation(); }
		finally { this.#update({ busy: false }); }
	}
	#requireProject(): MotionscaperProject {
		const project = this.#history?.snapshot().project;
		if (!project) throw new Error('Open a motion composition first.');
		return project;
	}
	async #adopt(project: MotionscaperProject, savedDigest: string | null, dirty: boolean, lease: MotionProjectWriteLease): Promise<void> {
		if (this.#disposed) throw new MotionProjectLeaseError();
		const prior = this.#lease; this.#lease = lease;
		this.#history = createMotionscaperHistory(project);
		this.#update({ savedDigest, dirty });
		if (prior && prior !== lease) await this.#store.releaseWriteAccess(prior);
	}
	#requireLease(): MotionProjectWriteLease { if (this.#disposed || !this.#lease) throw new MotionProjectLeaseError(); return this.#lease; }
	async #withLease<T>(id: string, operation: (lease: MotionProjectWriteLease) => Promise<T>): Promise<T> {
		if (this.#lease?.projectId === id) {
			try { await this.#store.assertWriteAccess(this.#lease); }
			catch (error) {
				if (!(error instanceof MotionProjectLeaseError)) throw error;
				const previous = this.#lease; this.#lease = null; await this.#store.releaseWriteAccess(previous);
			}
		}
		const lease = this.#lease?.projectId === id ? this.#lease : await this.#store.acquireWriteAccess(id);
		try { await this.#store.assertWriteAccess(lease); return await operation(lease); }
		catch (error) { if (lease !== this.#lease) await this.#store.releaseWriteAccess(lease); throw error; }
	}
	async dispose(): Promise<void> {
		if (this.#disposed) return; this.#disposed = true; this.#listeners.clear();
		const lease = this.#lease; this.#lease = null;
		if (lease) await this.#store.releaseWriteAccess(lease);
	}
	create(settings: MotionProjectSettings): Promise<void> {
		return this.#run(async () => {
			const project = createMotionscaperProject({ ...settings, id: this.#randomId(), compositionId: this.#randomId() });
			await this.#withLease(project.id, async lease => {
				const saved = await this.#store.save(project, null, lease);
				await this.#adopt(saved.project, saved.digest, false, lease);
			});
		});
	}
	open(id: string, recover = false): Promise<void> {
		return this.#run(async () => {
			await this.#withLease(id, async lease => {
				const saved = await this.#store.load(id);
				const project = recover ? await this.#store.loadRecovery(id) : saved?.project;
				if (!project) throw new Error('The requested motion project is unavailable.');
				await this.#adopt(project, saved?.digest ?? null, recover, lease);
			});
		});
	}
	changeSettings(settings: MotionProjectSettings): Promise<void> {
		return this.#run(async () => {
			const project = this.#requireProject();
			const composition = project.compositions.find((entry) => entry.id === project.primaryCompositionId);
			if (!composition) throw new Error('The primary composition is unavailable.');
			await this.#edit([
				{ type: 'project/rename', title: settings.title },
				{ type: 'composition/replace', composition: { ...composition, name: settings.title,
					width: settings.width, height: settings.height, frameRate: settings.frameRate, durationFrames: settings.durationFrames } },
			], []);
		});
	}
	async #edit(commands: readonly MotionscaperProjectCommand[], assets: readonly Readonly<{ asset: MotionAsset; body: Blob }>[]): Promise<void> {
		const lease = this.#requireLease(); await this.#store.assertWriteAccess(lease);
		const candidate = applyMotionscaperCommands(this.#requireProject(), commands);
		for (const { asset, body } of assets) await this.#store.putAsset(asset, body);
		// Retain the complete descriptor closure before any observer can see the edit.
		await this.#store.saveRecovery(candidate, this.#snapshot.savedDigest, lease);
		this.#history!.commit(commands);
		this.#update({ dirty: true });
	}
	edit(commands: readonly MotionscaperProjectCommand[], assets: readonly Readonly<{ asset: MotionAsset; body: Blob }>[] = []): Promise<void> {
		return this.#run(() => this.#edit(commands, assets));
	}
	addLayer(draft: MotionLayerDraft, compositionId?: string): Promise<void> {
		return this.#run(async () => {
			const project = this.#requireProject();
			const composition = project.compositions.find((entry) => entry.id === (compositionId ?? project.primaryCompositionId));
			if (!composition) throw new Error('The target composition is unavailable.');
			const { createAuthoredMotionLayer } = await import('./editor-layer-authoring.ts');
			const assets: { asset: MotionAsset; body: Blob }[] = [];
			const commands: MotionscaperProjectCommand[] = [];
			let fontId: string | undefined;
			if (draft.kind === 'text') {
				const { motionDefaultFontAsset } = await import('../common/editor/motion-canvaskit-browser.ts');
				const { loadMotionRasterRuntime } = await import('../common/editor/controller/composition/motion-raster-runtime.ts');
				const { asset, bytes } = motionDefaultFontAsset(await loadMotionRasterRuntime());
				const existing = project.assets.find((entry) => entry.kind === 'font' && entry.sha256 === asset.sha256);
				const retained = project.assets.some((entry) => entry.id === asset.id) ? { ...asset, id: this.#randomId() } : asset;
				fontId = existing?.id ?? retained.id;
				if (!existing) {
					assets.push({ asset: retained, body: new Blob([new Uint8Array(bytes)]) }); commands.push({ type: 'asset/add', asset: retained });
				}
			}
			const layer = createAuthoredMotionLayer(this.#randomId(), composition, draft, fontId);
			commands.push({ type: 'layer/add', compositionId: composition.id, layer, index: 0 });
			await this.#edit(commands, assets);
		});
	}
	importMedia(file: Blob, name: string, compositionId?: string): Promise<void> {
		return this.#run(async () => {
			const project = this.#requireProject(); const targetId = compositionId ?? project.primaryCompositionId;
			if (!project.compositions.some(({ id }) => id === targetId)) throw new Error('The target composition is unavailable.');
			const { prepareMotionMedia } = await import('../common/editor/motion-media-import.ts');
			const { createMotionscaperMediaCommands } = await import('./editor-media-authoring.ts');
			const imported = await prepareMotionMedia(file, { id: this.#randomId(), name });
			const commands = createMotionscaperMediaCommands(project, imported.asset, this.#randomId(), targetId);
			await this.#edit(commands, [imported]);
		});
	}
	save(writeSnapshot?: (project: MotionscaperProject, assertCurrent: () => Promise<void>) => Promise<boolean>): Promise<void> {
		return this.#run(async () => {
			const project = this.#requireProject();
			const lease = this.#requireLease(); await this.#store.assertWriteAccess(lease);
			if (writeSnapshot && !await writeSnapshot(project, () => this.#store.assertWriteAccess(lease))) return;
			const saved = await this.#store.save(project, this.#snapshot.savedDigest, lease);
			this.#update({ savedDigest: saved.digest, dirty: false });
		});
	}
	#navigateHistory(direction: 'undo' | 'redo'): Promise<void> {
		return this.#run(async () => {
			const transition = direction === 'undo' ? this.#history?.prepareUndo() : this.#history?.prepareRedo();
			if (!transition) return;
			await this.#store.saveRecovery(transition.project, this.#snapshot.savedDigest, this.#requireLease());
			transition.accept(); this.#update({ dirty: true });
		});
	}
	undo(): Promise<void> { return this.#navigateHistory('undo'); }
	redo(): Promise<void> { return this.#navigateHistory('redo'); }

	exportSnapshot(writeSnapshot: (project: MotionscaperProject) => Promise<void>): Promise<void> {
		return this.#run(() => writeSnapshot(this.#requireProject()));
	}
	saveCopy(): Promise<Readonly<{ blob: Blob; fileName: string }>> {
		return this.#run(async () => {
			const project = this.#requireProject();
			const { exportMotionscaperArchive } = await import('./editor-scape.ts');
			const blob = await exportMotionscaperArchive(project, (asset) => this.#store.readAsset(asset));
			if (!blob) throw new Error('The motion archive did not produce a file.');
			const fileName = motionDocumentFileName(project.title);
			return Object.freeze({ blob, fileName });
		});
	}
	inspectArchive(input: ScapeProjectInput): Promise<MotionArchiveReview> {
		return this.#run(async () => {
			const { inspectMotionArchive } = await import('./editor-document-import.ts');
			const incoming = await inspectMotionArchive(input); if (!incoming) throw new UnsupportedMotionArchiveError();
			const existing = await this.#store.inspectImport(incoming.id);
			const review: MotionArchiveReview = Object.freeze({ incoming, incomingDigest: createMotionscaperRevision(incoming).digest,
				existing: existing ? Object.freeze({ ...existing, active: this.#snapshot.project?.id === incoming.id }) : null });
			this.#archiveReviews.set(review, { input, project: this.#snapshot.project, savedDigest: this.#snapshot.savedDigest }); return review;
		});
	}
	openArchive(review: MotionArchiveReview, action: MotionArchiveOpenAction): Promise<MotionArchiveOpenReceipt> {
		return this.#run(async () => {
			const held = this.#archiveReviews.get(review);
			if (!held || held.project !== this.#snapshot.project || held.savedDigest !== this.#snapshot.savedDigest) throw new MotionProjectConflictError('The archive review is stale or closed; inspect the file again.');
			if (!['import', 'copy', 'replace', 'keep', 'saved', 'recover'].includes(action)) throw new TypeError('Unknown archive review action.');
			const { incoming, existing } = review;
			if (action === 'import' && existing || action !== 'import' && action !== 'copy' && !existing) throw new MotionProjectConflictError('Choose an explicit action for this archive collision.');
			if (action === 'keep') {
				if (!existing?.active) throw new MotionProjectConflictError('This project is not the active document.');
				await this.#store.assertWriteAccess(this.#requireLease()); this.#archiveReviews.delete(review);
				return Object.freeze({ projectId: incoming.id, action, bindOriginal: false });
			}
			if ((action === 'saved' || action === 'recover') && existing?.active) throw new MotionProjectConflictError('Keep the active document to preserve its history.');
			const { copyMotionArchiveProject } = await import('./editor-document-import.ts');
			const target = action === 'copy' ? copyMotionArchiveProject(incoming, this.#randomId()) : incoming;
			return this.#withLease(target.id, async lease => {
				if (action !== 'copy') {
					const current = await this.#store.inspectImport(target.id);
					if (Boolean(current) !== Boolean(existing) || current?.savedDigest !== existing?.savedDigest || current?.recoveryDigest !== existing?.recoveryDigest) throw new MotionProjectConflictError('The local saved project or recovery changed after review.');
				}
				if (action === 'saved' || action === 'recover') {
					const selected = action === 'saved' ? existing?.saved?.project : existing?.recovery;
					if (!selected) throw new Error('The reviewed local revision is unavailable.');
					await this.#adopt(selected, existing!.savedDigest, action === 'recover', lease); this.#archiveReviews.delete(review);
					return Object.freeze({ projectId: target.id, action, bindOriginal: action === 'saved' && review.incomingDigest === existing!.savedDigest });
				}
				const history = action === 'replace' ? existing?.active ? this.#history! : createMotionscaperHistory(existing!.recovery ?? existing!.saved!.project) : null;
				const transition = history?.prepareReplacement(target), candidate = transition?.project ?? target;
				const { importMotionscaperArchive } = await import('./editor-scape.ts');
				const imported = await importMotionscaperArchive(held.input, async project => {
					if (createMotionscaperRevision(project).digest !== review.incomingDigest) throw new MotionProjectConflictError('The selected archive changed after review.');
					const staging = await this.#store.beginImport(candidate, lease, action === 'replace' ? { recovery: true, expected: existing! } : undefined);
					return { ...staging, commit: () => staging.commit(candidate) };
				});
				if (imported.kind !== 'current') throw new UnsupportedMotionArchiveError();
				this.#archiveReviews.delete(review);
				if (transition && history) {
					transition.accept(); const prior = this.#lease; this.#lease = lease; this.#history = history;
					this.#update({ savedDigest: existing!.savedDigest, dirty: true }); if (prior && prior !== lease) await this.#store.releaseWriteAccess(prior);
				} else await this.#adopt(candidate, createMotionscaperRevision(candidate).digest, false, lease);
				return Object.freeze({ projectId: candidate.id, action, bindOriginal: action === 'import' });
			});
		});
	}
	closeArchiveReview(review: MotionArchiveReview): void { this.#archiveReviews.delete(review); }

	importArchive(file: ScapeProjectInput): Promise<void> {
		return this.#run(async () => {
			const { importMotionscaperArchive } = await import('./editor-scape.ts');
			let lease: MotionProjectWriteLease | null = null;
			try {
				const opened = await importMotionscaperArchive(file, async project => {
					lease = this.#lease?.projectId === project.id ? this.#lease : await this.#store.acquireWriteAccess(project.id);
					return this.#store.beginImport(project, lease);
				});
				if (opened.kind !== 'current') throw new UnsupportedMotionArchiveError();
				const saved = await this.#store.load(opened.project.id);
				if (!saved || !lease) throw new Error('The imported motion project was not published.');
				await this.#adopt(saved.project, saved.digest, false, lease);
			} catch (error) { if (lease && lease !== this.#lease) await this.#store.releaseWriteAccess(lease); throw error; }
		});
	}
}
