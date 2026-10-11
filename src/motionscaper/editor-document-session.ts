/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MotionLayerDraft } from './editor-layer-authoring.ts';
import type { MotionAsset } from '../common/editor/motion-asset.ts';
import type { Rational } from '../common/editor/timeline-time.ts';
import { createMotionscaperProject } from './editor-project.ts';
import { applyMotionscaperCommands, createMotionscaperHistory, type MotionscaperHistory, type MotionscaperProjectCommand } from './editor-project-commands.ts';
import type { MotionscaperProject } from './editor-project-types.ts';
import type { MotionscaperProjectStore } from './editor-project-store.ts';

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
	#adopt(project: MotionscaperProject, savedDigest: string | null, dirty: boolean): void {
		this.#history = createMotionscaperHistory(project);
		this.#update({ savedDigest, dirty });
	}
	async #recover(): Promise<void> {
		this.#update({ dirty: true });
		await this.#store.saveRecovery(this.#requireProject(), this.#snapshot.savedDigest);
	}
	create(settings: MotionProjectSettings): Promise<void> {
		return this.#run(async () => {
			const project = createMotionscaperProject({ ...settings, id: this.#randomId(), compositionId: this.#randomId() });
			const saved = await this.#store.save(project, null);
			this.#adopt(saved.project, saved.digest, false);
		});
	}
	open(id: string, recover = false): Promise<void> {
		return this.#run(async () => {
			const saved = await this.#store.load(id);
			const project = recover ? await this.#store.loadRecovery(id) : saved?.project;
			if (!project) throw new Error('The requested motion project is unavailable.');
			this.#adopt(project, saved?.digest ?? null, recover);
		});
	}
	changeSettings(settings: MotionProjectSettings): Promise<void> {
		return this.#run(async () => {
			const project = this.#requireProject();
			const composition = project.compositions.find((entry) => entry.id === project.primaryCompositionId);
			if (!composition) throw new Error('The primary composition is unavailable.');
			this.#history!.commit([
				{ type: 'project/rename', title: settings.title },
				{ type: 'composition/replace', composition: { ...composition, name: settings.title,
					width: settings.width, height: settings.height, frameRate: settings.frameRate, durationFrames: settings.durationFrames } },
			]);
			await this.#recover();
		});
	}
	async #edit(commands: readonly MotionscaperProjectCommand[], assets: readonly Readonly<{ asset: MotionAsset; body: Blob }>[]): Promise<void> {
		applyMotionscaperCommands(this.#requireProject(), commands);
		for (const { asset, body } of assets) await this.#store.putAsset(asset, body);
		this.#history!.commit(commands);
		await this.#recover();
	}
	edit(commands: readonly MotionscaperProjectCommand[], assets: readonly Readonly<{ asset: MotionAsset; body: Blob }>[] = []): Promise<void> {
		return this.#run(() => this.#edit(commands, assets));
	}
	addLayer(draft: MotionLayerDraft): Promise<void> {
		return this.#run(async () => {
			const project = this.#requireProject();
			const composition = project.compositions.find((entry) => entry.id === project.primaryCompositionId)!;
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
	save(): Promise<void> {
		return this.#run(async () => {
			const saved = await this.#store.save(this.#requireProject(), this.#snapshot.savedDigest);
			this.#update({ savedDigest: saved.digest, dirty: false });
		});
	}
	undo(): Promise<void> {
		return this.#run(async () => { if (this.#history?.undo()) await this.#recover(); });
	}
	redo(): Promise<void> {
		return this.#run(async () => { if (this.#history?.redo()) await this.#recover(); });
	}
	saveCopy(): Promise<Readonly<{ blob: Blob; fileName: string }>> {
		return this.#run(async () => {
			const project = this.#requireProject();
			const { exportMotionscaperArchive } = await import('./editor-scape.ts');
			const blob = await exportMotionscaperArchive(project, (asset) => this.#store.readAsset(asset));
			if (!blob) throw new Error('The motion archive did not produce a file.');
			const safeTitle = Array.from(project.title, (character) => character.charCodeAt(0) < 32
				|| /[\\/:*?"<>|]/u.test(character) ? '_' : character).join('').slice(0, 160);
			const fileName = `${safeTitle || 'Motionscaper'}.mscape`;
			return Object.freeze({ blob, fileName });
		});
	}
	importArchive(file: Blob): Promise<void> {
		return this.#run(async () => {
			const { importMotionscaperArchive } = await import('./editor-scape.ts');
			const opened = await importMotionscaperArchive(file, (project) => this.#store.beginImport(project));
			if (opened.kind !== 'current') throw new UnsupportedMotionArchiveError();
			const saved = await this.#store.load(opened.project.id);
			if (!saved) throw new Error('The imported motion project was not published.');
			this.#adopt(saved.project, saved.digest, false);
		});
	}
}
