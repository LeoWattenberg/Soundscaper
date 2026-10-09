/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoDevelopExecutionContextV1, ExecutePhotoDevelopV1 } from './photo-library-develop-workflow-v1.ts';
import type { PhotoLibraryDevelopPortV1 } from '../../photo-library-develop-port-v1.ts';
import type { PhotoLibraryDevelopBatchReceiptV1, PhotoLibraryDevelopBatchTargetV1, PhotoLibraryDevelopBatchRequestV1 } from '../../photo-library-develop-settings-port-v1.ts';
import type { PhotoLibraryDevelopPresetSnapshotV1, PhotoLibraryDevelopPresetAcknowledgementV1, PhotoLibraryDevelopPresetsPortV1 } from '../../photo-library-develop-presets-port-v1.ts';
import type { ImageDevelopSelectionV1, ImageDevelopSettingsPacketV1 } from '../../imaging/image-develop-settings-contract-v1.ts';
import { normalizeImageDevelopSelectionV1, normalizeImageDevelopRelativeActionV1 } from '../../imaging/image-develop-settings-v1.ts';
import { normalizeImageDevelopPresetV1 } from '../../imaging/image-develop-preset-v1.ts';
import { detachPhotoDevelopSettingsSourceV1 as source, developSettingsId as id, developSettingsIds as ids,
	developSettingsName as name, developSettingsRevision as revision, type PhotoDevelopSettingsSourceV1 } from './photo-library-develop-settings-intent.ts';

export type { PhotoDevelopSettingsSourceV1 } from './photo-library-develop-settings-intent.ts';
export interface PhotoDevelopSettingsWorkflowSnapshotV1 {
	readonly busy: boolean;
	readonly clipboard: ImageDevelopSettingsPacketV1 | null;
	readonly presets: PhotoLibraryDevelopPresetSnapshotV1 | null;
	readonly batch: PhotoLibraryDevelopBatchReceiptV1 | null;
	readonly presetReceipt: PhotoLibraryDevelopPresetAcknowledgementV1 | null;
	readonly autoSync: boolean;
	readonly autoSyncTargetCount: number;
	readonly notice: 'refresh-failed' | null;
	readonly error: string | null;
}
interface AutoSync {
	readonly catalogId: string; readonly photoId: string; readonly versionId: string;
	readonly selection: ImageDevelopSelectionV1; readonly targets: readonly PhotoLibraryDevelopBatchTargetV1[];
}
interface SelectedPreset { readonly revision: number; readonly info: PhotoLibraryDevelopPresetSnapshotV1['presets'][number]; }
const CHECK = AbortSignal.prototype.throwIfAborted;
const ABORTED = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const REASON = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
function check(signal: AbortSignal): void { Reflect.apply(CHECK, signal, []); }

/** One menu demand borrows the existing Session; recipes never become resource owners. */
export class PhotoLibraryDevelopSettingsWorkflowV1 {
	readonly #execute: ExecutePhotoDevelopV1;
	readonly #now: () => string;
	readonly #createId: () => string;
	#view: PhotoDevelopSettingsWorkflowSnapshotV1 = Object.freeze({ busy: false, clipboard: null, presets: null, batch: null,
		presetReceipt: null, autoSync: false, autoSyncTargetCount: 0, notice: null, error: null });
	#listener: ((view: PhotoDevelopSettingsWorkflowSnapshotV1) => void) | null = null;
	#auto: AutoSync | null = null;
	#pending: Promise<unknown> | null = null;
	#active: AbortController | null = null;
	#closed = false;
	#retired = false;
	#epoch = 0;

	constructor(options: Readonly<{ execute: ExecutePhotoDevelopV1; now?: () => string; createId?: () => string }>) {
		this.#execute = options.execute; this.#now = options.now ?? (() => new Date().toISOString());
		this.#createId = options.createId ?? (() => crypto.randomUUID());
	}
	snapshot(): PhotoDevelopSettingsWorkflowSnapshotV1 { return this.#view; }
	subscribe(listener: (view: PhotoDevelopSettingsWorkflowSnapshotV1) => void): () => void {
		this.#listener = listener; listener(this.#view); return () => { if (this.#listener === listener) this.#listener = null; };
	}
	copy(value: PhotoDevelopSettingsSourceV1, selection: ImageDevelopSelectionV1): Promise<null> {
		return this.#run(() => ({ source: source(value), selection: normalizeImageDevelopSelectionV1(selection) }), async (context, input) => {
			const port = await this.#acquire(context); if (!port) return null;
			const clipboard = settings(port).copy({ schemaVersion: 1, develop: input.source.develop, selection: input.selection });
			if (this.#current(context)) this.#publish({ clipboard }); return null;
		});
	}
	paste(value: PhotoDevelopSettingsSourceV1, label: string): Promise<PhotoLibraryDevelopBatchReceiptV1 | null> {
		return this.#run(() => {
			if (!this.#view.clipboard) throw new Error('No copied settings are available.');
			return { source: source(value), packet: this.#view.clipboard, label: name(label) };
		}, async (context, input) => {
			const port = await this.#acquire(context); if (!port) return null;
			return this.#batch(context, port, input.source.catalogId, [target(input.source)], { kind: 'paste', settings: input.packet }, input.label);
		});
	}
	sync(value: PhotoDevelopSettingsSourceV1, selected: readonly string[], selection: ImageDevelopSelectionV1, label: string): Promise<PhotoLibraryDevelopBatchReceiptV1 | null> {
		return this.#run(() => ({ source: source(value), ids: ids(selected), selection: normalizeImageDevelopSelectionV1(selection), label: name(label) }), async (context, input) => {
			const port = await this.#acquire(context); if (!port) return null;
			const targets = await this.#targets(context, port, input.ids.filter(photoId => photoId !== input.source.photoId));
			if (!targets.length) throw new RangeError('Sync requires another selected photo.');
			const packet = settings(port).copy({ schemaVersion: 1, develop: input.source.develop, selection: input.selection });
			return this.#batch(context, port, input.source.catalogId, targets, { kind: 'paste', settings: packet }, input.label);
		});
	}
	armAutoSync(value: PhotoDevelopSettingsSourceV1, selected: readonly string[], selection: ImageDevelopSelectionV1): Promise<null> {
		return this.#run(() => ({ source: source(value), ids: ids(selected), selection: normalizeImageDevelopSelectionV1(selection) }), async (context, input) => {
			const port = await this.#acquire(context); if (!port) return null;
			settings(port);
			const targets = await this.#targets(context, port, input.ids.filter(photoId => photoId !== input.source.photoId));
			if (!targets.length) throw new RangeError('Auto-sync requires another selected photo.');
			if (this.#current(context)) {
				this.#auto = Object.freeze({ catalogId: input.source.catalogId, photoId: input.source.photoId, versionId: input.source.versionId, selection: input.selection, targets });
				this.#publish({ autoSync: true, autoSyncTargetCount: targets.length });
			} return null;
		});
	}
	clearAutoSync(): void { this.#auto = null; this.#publish({ autoSync: false, autoSyncTargetCount: 0 }); }
	syncAcknowledged(value: PhotoDevelopSettingsSourceV1, label: string): Promise<PhotoLibraryDevelopBatchReceiptV1 | null> {
		if (!this.#auto) return Promise.resolve(null);
		return this.#run(() => ({ source: source(value), auto: this.#auto!, label: name(label) }), async (context, input) => {
			if (input.source.catalogId !== input.auto.catalogId || input.source.photoId !== input.auto.photoId || input.source.versionId !== input.auto.versionId) throw new Error('Auto-sync belongs to another photo version.');
			const port = await this.#acquire(context); if (!port) return null;
			const packet = settings(port).copy({ schemaVersion: 1, develop: input.source.develop, selection: input.auto.selection });
			const receipt = await this.#batch(context, port, input.auto.catalogId, input.auto.targets, { kind: 'paste', settings: packet }, input.label);
			if (this.#current(context) && this.#auto === input.auto) {
				if (receipt.completion !== 'finished' || receipt.outcomes.some(outcome => outcome.status !== 'applied' && outcome.status !== 'unchanged')) this.clearAutoSync();
				else this.#auto = Object.freeze({ ...input.auto, targets: Object.freeze(input.auto.targets.map((before, index) => Object.freeze({ ...before, expectedRevision: receipt.outcomes[index]!.revision! }))) });
			} return receipt;
		});
	}
	relative(catalogId: string, selected: readonly string[], effectType: 'white-balance-v1' | 'tone-ladder-v1', changes: Readonly<Record<string, number>>, label: string): Promise<PhotoLibraryDevelopBatchReceiptV1 | null> {
		return this.#run(() => ({ catalogId: id(catalogId), ids: ids(selected), action: normalizeImageDevelopRelativeActionV1({ effectType, changes }), label: name(label) }), async (context, input) => {
			const port = await this.#acquire(context); if (!port) return null;
			const targets = await this.#targets(context, port, input.ids);
			return this.#batch(context, port, input.catalogId, targets, { kind: 'relative', ...input.action }, input.label);
		});
	}
	listPresets(catalogId: string): Promise<PhotoLibraryDevelopPresetSnapshotV1 | null> {
		return this.#run(() => id(catalogId), async (context, catalog) => {
			const port = await this.#acquire(context); if (!port) return null;
			const snapshot = await presets(port).list({ schemaVersion: 1, catalogId: catalog }, { signal: context.signal }); check(context.signal);
			if (snapshot.catalogId !== catalog || snapshot.presets.length > 16) throw new Error('Preset menu changed catalog or exceeded its bound.');
			if (this.#current(context)) this.#publish({ presets: snapshot }); return snapshot;
		});
	}
	savePreset(value: PhotoDevelopSettingsSourceV1, selection: ImageDevelopSelectionV1, presetName: string): Promise<PhotoLibraryDevelopPresetAcknowledgementV1 | null> {
		return this.#run(() => { const captured = source(value); return { source: captured, selection: normalizeImageDevelopSelectionV1(selection), name: name(presetName), expectedRevision: this.#menu(captured.catalogId).revision, id: id(this.#createId()) }; }, async (context, input) => {
			const port = await this.#acquire(context); if (!port) return null;
			const packet = settings(port).copy({ schemaVersion: 1, develop: input.source.develop, selection: input.selection });
			const capability = presets(port), preset = capability.create({ schemaVersion: 1, id: input.id, name: input.name, settings: packet });
			return this.#writePreset(context, capability, input.source.catalogId, { type: 'save', expectedRevision: input.expectedRevision, preset });
		});
	}
	applyPreset(value: PhotoDevelopSettingsSourceV1, presetId: string, listRevision: number, label: string): Promise<PhotoLibraryDevelopBatchReceiptV1 | null> {
		return this.#run(() => { const captured = source(value); return { source: captured, selected: this.#selected(captured.catalogId, presetId, listRevision), label: name(label) }; }, async (context, input) => {
			const port = await this.#acquire(context); if (!port) return null;
			const preset = await this.#readPreset(context, presets(port), input.source.catalogId, input.selected);
			return this.#batch(context, port, input.source.catalogId, [target(input.source)], { kind: 'paste', settings: preset.settings }, input.label);
		});
	}
	renamePreset(catalogId: string, presetId: string, listRevision: number, presetName: string): Promise<PhotoLibraryDevelopPresetAcknowledgementV1 | null> {
		return this.#run(() => ({ catalogId: id(catalogId), selected: this.#selected(catalogId, presetId, listRevision), name: name(presetName) }), async (context, input) => {
			const port = await this.#acquire(context); if (!port) return null;
			const capability = presets(port), body = await this.#readPreset(context, capability, input.catalogId, input.selected);
			const preset = capability.create({ schemaVersion: 1, id: body.identity.id, name: input.name, settings: body.settings });
			return this.#writePreset(context, capability, input.catalogId, { type: 'save', expectedRevision: input.selected.revision, preset });
		});
	}
	deletePreset(catalogId: string, presetId: string, listRevision: number): Promise<PhotoLibraryDevelopPresetAcknowledgementV1 | null> {
		return this.#run(() => ({ catalogId: id(catalogId), selected: this.#selected(catalogId, presetId, listRevision) }), async (context, input) => {
			const port = await this.#acquire(context); if (!port) return null;
			return this.#writePreset(context, presets(port), input.catalogId, { type: 'delete', expectedRevision: input.selected.revision, presetId: input.selected.info.id });
		});
	}
	cancel(): Promise<void> { this.#active?.abort(); return this.#pending ? this.#pending.then(() => undefined, () => undefined) : Promise.resolve(); }
	dismiss(): Promise<void> { this.#epoch++; this.clearAutoSync(); return this.cancel(); }
	resume(): void { if (!this.#closed) this.#retired = false; }
	retire(): Promise<void> { this.#retired = true; this.#epoch++; this.clearAutoSync(); return this.cancel(); }
	close(): Promise<void> { const joined = this.retire(); this.#closed = true; this.#listener = null; return joined; }
	#menu(catalogId: string): PhotoLibraryDevelopPresetSnapshotV1 {
		const snapshot = this.#view.presets;
		if (!snapshot || snapshot.catalogId !== id(catalogId)) throw new Error('Load the preset menu first.'); return snapshot;
	}
	#selected(catalogId: string, presetId: string, listRevision: number): SelectedPreset {
		const snapshot = this.#menu(catalogId), expected = revision(listRevision), selected = id(presetId);
		const info = snapshot.presets.find(preset => preset.id === selected);
		if (snapshot.revision !== expected || !info) throw new Error('Reload the changed preset menu.'); return Object.freeze({ revision: expected, info });
	}
	async #readPreset(context: PhotoDevelopExecutionContextV1, capability: PhotoLibraryDevelopPresetsPortV1, catalogId: string, selected: SelectedPreset) {
		const body = await capability.read({ schemaVersion: 1, catalogId, presetId: selected.info.id, expectedRevision: selected.revision }, { signal: context.signal });
		check(context.signal); if (!this.#current(context)) throw new Error('The preset view retired.');
		const preset = normalizeImageDevelopPresetV1(body.preset);
		if (body.catalogId !== catalogId || body.revision !== selected.revision || preset.identity.id !== selected.info.id || preset.identity.authoredStateSha256 !== selected.info.authoredStateSha256) throw new Error('The selected preset changed.'); return preset;
	}
	async #writePreset(context: PhotoDevelopExecutionContextV1, capability: PhotoLibraryDevelopPresetsPortV1, catalogId: string, command: Parameters<PhotoLibraryDevelopPresetsPortV1['write']>[0]['command']) {
		check(context.signal);
		if (!this.#current(context)) throw new Error('The settings view retired.');
		const receipt = await capability.write({ schemaVersion: 1, catalogId, command }, { signal: context.signal });
		if (this.#current(context)) this.#publish({ presets: receipt.snapshot, presetReceipt: receipt }); return receipt;
	}
	async #targets(context: PhotoDevelopExecutionContextV1, port: PhotoLibraryDevelopPortV1, selected: readonly string[]) {
		const targets: PhotoLibraryDevelopBatchTargetV1[] = [];
		for (const photoId of selected) {
			check(context.signal); if (!this.#current(context)) throw new Error('The settings view retired.');
			const document = await port.read({ schemaVersion: 1, photoId }, { signal: context.signal }); check(context.signal);
			if (document.photoId !== photoId || document.versionId !== document.activeVersionId) throw new Error('The selected active version changed.');
			targets.push(Object.freeze({ photoId, versionId: id(document.versionId), expectedRevision: revision(document.revision) }));
		} return Object.freeze(targets);
	}
	async #batch(context: PhotoDevelopExecutionContextV1, port: PhotoLibraryDevelopPortV1, catalogId: string, targets: readonly PhotoLibraryDevelopBatchTargetV1[], action: PhotoLibraryDevelopBatchRequestV1['action'], label: string) {
		check(context.signal); if (!this.#current(context)) throw new Error('The settings view retired.');
		const receipt = await settings(port).applyBatch({ schemaVersion: 1, catalogId, targets, action, label, createdAt: this.#now() }, { signal: context.signal });
		if (this.#current(context)) {
			this.#publish({ batch: receipt, notice: null });
			try { check(context.signal); await context.refresh(); check(context.signal); }
			catch { if (this.#current(context)) this.#publish({ notice: 'refresh-failed' }); }
		} return receipt;
	}
	async #acquire(context: PhotoDevelopExecutionContextV1) {
		const port = await context.acquire(); check(context.signal); return this.#current(context) ? port : null;
	}
	#current(context: PhotoDevelopExecutionContextV1): boolean { return !this.#closed && !this.#retired && context.isCurrent(); }
	#publish(update: Partial<PhotoDevelopSettingsWorkflowSnapshotV1>): void {
		if (this.#closed) return; this.#view = Object.freeze({ ...this.#view, ...update });
		try { this.#listener?.(this.#view); } catch { /* Scalar observers cannot erase ACK or strand a demand. */ }
	}
	#run<Input, Result>(admit: () => Input, action: (context: PhotoDevelopExecutionContextV1, input: Input) => Promise<Result>): Promise<Result | null> {
		if (this.#closed || this.#retired || this.#pending) return Promise.resolve(null);
		const epoch = this.#epoch, stop = new AbortController(); this.#active = stop;
		let resolve!: (result: Result | null) => void;
		const pending = new Promise<Result | null>(accept => { resolve = accept; }); this.#pending = pending; this.#publish({ busy: true, error: null });
		const run = async (): Promise<Result | null> => {
			let result: Result | null = null;
			try { const input = admit(); check(stop.signal);
				await this.#execute(async context => { result = await action({ ...context, isCurrent: () => epoch === this.#epoch && context.isCurrent() }, input); }, stop.signal);
			} catch (error) {
				if (epoch === this.#epoch && !this.#retired && !(Reflect.apply(ABORTED, stop.signal, []) && Reflect.apply(REASON, stop.signal, []) === error)) this.#publish({ error: 'The settings action failed. Reload before retrying.' });
			} finally { this.#pending = null; this.#active = null; this.#publish({ busy: false }); } return result;
		};
		void run().then(resolve); return pending;
	}
}
function target(value: PhotoDevelopSettingsSourceV1): PhotoLibraryDevelopBatchTargetV1 {
	return Object.freeze({ photoId: value.photoId, versionId: value.versionId, expectedRevision: value.revision });
}
function settings(port: PhotoLibraryDevelopPortV1) { if (!port.settings) throw new Error('Develop settings are unavailable.'); return port.settings; }
function presets(port: PhotoLibraryDevelopPortV1) { if (!port.presets) throw new Error('Develop presets are unavailable.'); return port.presets; }
