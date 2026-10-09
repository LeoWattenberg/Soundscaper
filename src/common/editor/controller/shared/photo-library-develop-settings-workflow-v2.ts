/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoDevelopExecutionContextV2, ExecutePhotoDevelopV2 } from './photo-library-develop-workflow-v2.ts';
import { capturePhotoLibraryDevelopPortV2, capturePhotoDevelopExecutionContextV2 } from './photo-library-develop-command-v2.ts';
import type { PhotoLibraryDevelopPortV2 } from '../../photo-library-develop-port-v2.ts';
import type { PhotoLibraryDevelopBatchReceiptV2, PhotoLibraryDevelopBatchTargetV2, PhotoLibraryDevelopBatchRequestV2 } from '../../photo-library-develop-settings-port-v2.ts';
import type { PhotoLibraryDevelopPresetSnapshotV2, PhotoLibraryDevelopPresetAcknowledgementV2, PhotoLibraryDevelopPresetsPortV2 } from '../../photo-library-develop-presets-port-v2.ts';
import type { ImageDevelopSelectionV1 as ImageDevelopSelectionV2 } from '../../imaging/image-develop-settings-contract-v1.ts';
import type { ImageDevelopSettingsPacketV2 } from '../../imaging/image-develop-settings-contract-v2.ts';
import { normalizeImageDevelopSelectionV2 } from '../../imaging/image-develop-settings-v2.ts';
import { normalizeImageDevelopRelativeActionV1 as normalizeImageDevelopRelativeActionV2 } from '../../imaging/image-develop-settings-v1.ts';
import { normalizeImageDevelopPresetV1OrV2 } from '../../imaging/image-develop-preset-v2.ts';
import { detachPhotoDevelopSettingsSourceV2 as source, developSettingsId as id, developSettingsIds as ids,
	developSettingsName as name, developSettingsRevision as revision, type PhotoDevelopSettingsSourceV2 } from './photo-library-develop-settings-intent-v2.ts';

export type { PhotoDevelopSettingsSourceV2 } from './photo-library-develop-settings-intent-v2.ts';
export interface PhotoDevelopSettingsWorkflowSnapshotV2 {
	readonly busy: boolean;
	readonly clipboard: ImageDevelopSettingsPacketV2 | null;
	readonly presets: PhotoLibraryDevelopPresetSnapshotV2 | null;
	readonly batch: PhotoLibraryDevelopBatchReceiptV2 | null;
	readonly presetReceipt: PhotoLibraryDevelopPresetAcknowledgementV2 | null;
	readonly autoSync: boolean;
	readonly autoSyncTargetCount: number;
	readonly notice: 'refresh-failed' | null;
	readonly error: string | null;
}
interface AutoSync {
	readonly catalogId: string; readonly photoId: string; readonly versionId: string;
	readonly selection: ImageDevelopSelectionV2; readonly targets: readonly PhotoLibraryDevelopBatchTargetV2[];
}
interface SelectedPreset { readonly revision: number; readonly info: PhotoLibraryDevelopPresetSnapshotV2['presets'][number]; }
const CHECK = AbortSignal.prototype.throwIfAborted;
const ABORTED = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const REASON = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
function check(signal: AbortSignal): void { Reflect.apply(CHECK, signal, []); }

/** One menu demand borrows the existing Session; recipes never become resource owners. */
export class PhotoLibraryDevelopSettingsWorkflowV2 {
	readonly #execute: ExecutePhotoDevelopV2;
	readonly #now: () => string;
	readonly #createId: () => string;
	#view: PhotoDevelopSettingsWorkflowSnapshotV2 = Object.freeze({ busy: false, clipboard: null, presets: null, batch: null,
		presetReceipt: null, autoSync: false, autoSyncTargetCount: 0, notice: null, error: null });
	#listener: ((view: PhotoDevelopSettingsWorkflowSnapshotV2) => void) | null = null;
	#auto: AutoSync | null = null;
	#pending: Promise<unknown> | null = null;
	#active: AbortController | null = null;
	#closed = false;
	#retired = false;
	#epoch = 0;
	#closing: Promise<void> | null = null;

	constructor(options: Readonly<{ execute: ExecutePhotoDevelopV2; now?: () => string; createId?: () => string }>) {
		const execute = options.execute, now = options.now ?? (() => new Date().toISOString()), createId = options.createId ?? (() => crypto.randomUUID());
		this.#execute = (...args) => Reflect.apply(execute, options, args); this.#now = () => Reflect.apply(now, options, []);
		this.#createId = () => Reflect.apply(createId, options, []);
	}
	snapshot(): PhotoDevelopSettingsWorkflowSnapshotV2 { return this.#view; }
	subscribe(listener: (view: PhotoDevelopSettingsWorkflowSnapshotV2) => void): () => void {
		this.#listener = listener; listener(this.#view); return () => { if (this.#listener === listener) this.#listener = null; };
	}
	copy(value: PhotoDevelopSettingsSourceV2, selection: ImageDevelopSelectionV2): Promise<null> {
		return this.#run(() => ({ source: source(value), selection: normalizeImageDevelopSelectionV2(selection) }), async (context, input) => {
			const port = await this.#acquire(context); if (!port) return null;
			const clipboard = settings(port).copy({ schemaVersion: 2, develop: input.source.develop, selection: input.selection });
			if (this.#admittedCurrent(context)) this.#publish({ clipboard }); return null;
		});
	}
	paste(value: PhotoDevelopSettingsSourceV2, label: string): Promise<PhotoLibraryDevelopBatchReceiptV2 | null> {
		return this.#run(() => {
			if (!this.#view.clipboard) throw new Error('No copied settings are available.');
			return { source: source(value), packet: this.#view.clipboard, label: name(label) };
		}, async (context, input) => {
			const port = await this.#acquire(context); if (!port) return null;
			return this.#batch(context, port, input.source.catalogId, [target(input.source)], { kind: 'paste', settings: input.packet }, input.label);
		});
	}
	sync(value: PhotoDevelopSettingsSourceV2, selected: readonly string[], selection: ImageDevelopSelectionV2, label: string): Promise<PhotoLibraryDevelopBatchReceiptV2 | null> {
		return this.#run(() => ({ source: source(value), ids: ids(selected), selection: normalizeImageDevelopSelectionV2(selection), label: name(label) }), async (context, input) => {
			const port = await this.#acquire(context); if (!port) return null;
			const targets = await this.#targets(context, port, input.ids.filter(photoId => photoId !== input.source.photoId));
			if (!targets.length) throw new RangeError('Sync requires another selected photo.');
			const packet = settings(port).copy({ schemaVersion: 2, develop: input.source.develop, selection: input.selection });
			return this.#batch(context, port, input.source.catalogId, targets, { kind: 'paste', settings: packet }, input.label);
		});
	}
	armAutoSync(value: PhotoDevelopSettingsSourceV2, selected: readonly string[], selection: ImageDevelopSelectionV2): Promise<null> {
		return this.#run(() => ({ source: source(value), ids: ids(selected), selection: normalizeImageDevelopSelectionV2(selection) }), async (context, input) => {
			const port = await this.#acquire(context); if (!port) return null;
			settings(port);
			const targets = await this.#targets(context, port, input.ids.filter(photoId => photoId !== input.source.photoId));
			if (!targets.length) throw new RangeError('Auto-sync requires another selected photo.');
			if (this.#admittedCurrent(context)) {
				this.#auto = Object.freeze({ catalogId: input.source.catalogId, photoId: input.source.photoId, versionId: input.source.versionId, selection: input.selection, targets });
				this.#publish({ autoSync: true, autoSyncTargetCount: targets.length });
			} return null;
		});
	}
	clearAutoSync(): void { this.#auto = null; this.#publish({ autoSync: false, autoSyncTargetCount: 0 }); }
	syncAcknowledged(value: PhotoDevelopSettingsSourceV2, label: string): Promise<PhotoLibraryDevelopBatchReceiptV2 | null> {
		if (!this.#auto) return Promise.resolve(null);
		return this.#run(() => ({ source: source(value), auto: this.#auto!, label: name(label) }), async (context, input) => {
			if (input.source.catalogId !== input.auto.catalogId || input.source.photoId !== input.auto.photoId || input.source.versionId !== input.auto.versionId) throw new Error('Auto-sync belongs to another photo version.');
			const port = await this.#acquire(context); if (!port) return null;
			const packet = settings(port).copy({ schemaVersion: 2, develop: input.source.develop, selection: input.auto.selection });
			const receipt = await this.#batch(context, port, input.auto.catalogId, input.auto.targets, { kind: 'paste', settings: packet }, input.label);
			if (this.#acknowledgedCurrent(context) && this.#auto === input.auto) {
				if (receipt.completion !== 'finished' || receipt.outcomes.some(outcome => outcome.status !== 'applied' && outcome.status !== 'unchanged')) this.clearAutoSync();
				else this.#auto = Object.freeze({ ...input.auto, targets: Object.freeze(input.auto.targets.map((before, index) => Object.freeze({ ...before, expectedRevision: receipt.outcomes[index]!.revision! }))) });
			} return receipt;
		});
	}
	relative(catalogId: string, selected: readonly string[], effectType: 'white-balance-v1' | 'tone-ladder-v1', changes: Readonly<Record<string, number>>, label: string): Promise<PhotoLibraryDevelopBatchReceiptV2 | null> {
		return this.#run(() => ({ catalogId: id(catalogId), ids: ids(selected), action: normalizeImageDevelopRelativeActionV2({ effectType, changes }), label: name(label) }), async (context, input) => {
			const port = await this.#acquire(context); if (!port) return null;
			const targets = await this.#targets(context, port, input.ids);
			return this.#batch(context, port, input.catalogId, targets, { kind: 'relative', ...input.action }, input.label);
		});
	}
	listPresets(catalogId: string): Promise<PhotoLibraryDevelopPresetSnapshotV2 | null> {
		return this.#run(() => id(catalogId), async (context, catalog) => {
			const port = await this.#acquire(context); if (!port) return null;
			const snapshot = await presets(port).list({ schemaVersion: 2, catalogId: catalog }, { signal: context.signal }); check(context.signal);
			if (snapshot.schemaVersion !== 2 || snapshot.catalogId !== catalog || snapshot.presets.length > 16) throw new Error('Preset menu changed catalog or exceeded its bound.');
			if (this.#admittedCurrent(context)) this.#publish({ presets: snapshot }); return snapshot;
		});
	}
	savePreset(value: PhotoDevelopSettingsSourceV2, selection: ImageDevelopSelectionV2, presetName: string): Promise<PhotoLibraryDevelopPresetAcknowledgementV2 | null> {
		return this.#run(() => { const captured = source(value); return { source: captured, selection: normalizeImageDevelopSelectionV2(selection), name: name(presetName), expectedRevision: this.#menu(captured.catalogId).revision, id: id(this.#createId()) }; }, async (context, input) => {
			const port = await this.#acquire(context); if (!port) return null;
			const packet = settings(port).copy({ schemaVersion: 2, develop: input.source.develop, selection: input.selection });
			const capability = presets(port), preset = capability.create({ schemaVersion: 2, id: input.id, name: input.name, settings: packet });
			return this.#writePreset(context, capability, input.source.catalogId, { type: 'save', expectedRevision: input.expectedRevision, preset });
		});
	}
	applyPreset(value: PhotoDevelopSettingsSourceV2, presetId: string, listRevision: number, label: string): Promise<PhotoLibraryDevelopBatchReceiptV2 | null> {
		return this.#run(() => { const captured = source(value); return { source: captured, selected: this.#selected(captured.catalogId, presetId, listRevision), label: name(label) }; }, async (context, input) => {
			const port = await this.#acquire(context); if (!port) return null;
			const preset = await this.#readPreset(context, presets(port), input.source.catalogId, input.selected);
			return this.#batch(context, port, input.source.catalogId, [target(input.source)], { kind: 'paste', settings: preset.settings }, input.label);
		});
	}
	renamePreset(catalogId: string, presetId: string, listRevision: number, presetName: string): Promise<PhotoLibraryDevelopPresetAcknowledgementV2 | null> {
		return this.#run(() => ({ catalogId: id(catalogId), selected: this.#selected(catalogId, presetId, listRevision), name: name(presetName) }), async (context, input) => {
			const port = await this.#acquire(context); if (!port) return null;
			const capability = presets(port), body = await this.#readPreset(context, capability, input.catalogId, input.selected);
			const preset = normalizeImageDevelopPresetV1OrV2({ ...body, identity: { ...body.identity, name: input.name } });
			return this.#writePreset(context, capability, input.catalogId, { type: 'save', expectedRevision: input.selected.revision, preset });
		});
	}
	deletePreset(catalogId: string, presetId: string, listRevision: number): Promise<PhotoLibraryDevelopPresetAcknowledgementV2 | null> {
		return this.#run(() => ({ catalogId: id(catalogId), selected: this.#selected(catalogId, presetId, listRevision) }), async (context, input) => {
			const port = await this.#acquire(context); if (!port) return null;
			return this.#writePreset(context, presets(port), input.catalogId, { type: 'delete', expectedRevision: input.selected.revision, presetId: input.selected.info.id });
		});
	}
	cancel(): Promise<void> { this.#active?.abort(); return this.#pending ? this.#pending.then(() => undefined, () => undefined) : Promise.resolve(); }
	dismiss(): Promise<void> { this.#epoch++; this.clearAutoSync(); return this.cancel(); }
	resume(): void { if (!this.#closed) this.#retired = false; }
	retire(): Promise<void> { this.#retired = true; this.#epoch++; this.clearAutoSync(); return this.cancel(); }
	close(): Promise<void> {
		if (this.#closing) return this.#closing;
		this.#closed = true; this.#retired = true; this.#epoch++; this.#auto = null; this.#listener = null;
		this.#view = Object.freeze({ ...this.#view, autoSync: false, autoSyncTargetCount: 0 });
		this.#closing = Promise.resolve().then(() => this.cancel()); return this.#closing;
	}
	#menu(catalogId: string): PhotoLibraryDevelopPresetSnapshotV2 {
		const snapshot = this.#view.presets;
		if (!snapshot || snapshot.catalogId !== id(catalogId)) throw new Error('Load the preset menu first.'); return snapshot;
	}
	#selected(catalogId: string, presetId: string, listRevision: number): SelectedPreset {
		const snapshot = this.#menu(catalogId), expected = revision(listRevision), selected = id(presetId);
		const info = snapshot.presets.find(preset => preset.id === selected);
		if (snapshot.revision !== expected || !info) throw new Error('Reload the changed preset menu.'); return Object.freeze({ revision: expected, info });
	}
	async #readPreset(context: PhotoDevelopExecutionContextV2, capability: PhotoLibraryDevelopPresetsPortV2, catalogId: string, selected: SelectedPreset) {
		const body = await capability.read({ schemaVersion: 2, catalogId, presetId: selected.info.id, expectedRevision: selected.revision }, { signal: context.signal });
		if (!this.#admittedCurrent(context)) throw new Error('The preset view retired.');
		const preset = normalizeImageDevelopPresetV1OrV2(body.preset);
		if (body.schemaVersion !== 2 || body.catalogId !== catalogId || body.revision !== selected.revision || preset.identity.id !== selected.info.id || preset.identity.authoredStateSha256 !== selected.info.authoredStateSha256) throw new Error('The selected preset changed.'); return preset;
	}
	async #writePreset(context: PhotoDevelopExecutionContextV2, capability: PhotoLibraryDevelopPresetsPortV2, catalogId: string, command: Parameters<PhotoLibraryDevelopPresetsPortV2['write']>[0]['command']) {
		if (!this.#admittedCurrent(context)) throw new Error('The settings view retired.');
		const receipt = await capability.write({ schemaVersion: 2, catalogId, command }, { signal: context.signal });
		if (this.#acknowledgedCurrent(context)) this.#publish({ presets: receipt.snapshot, presetReceipt: receipt }); return receipt;
	}
	async #targets(context: PhotoDevelopExecutionContextV2, port: PhotoLibraryDevelopPortV2, selected: readonly string[]) {
		const targets: PhotoLibraryDevelopBatchTargetV2[] = [];
		for (const photoId of selected) {
			if (!this.#admittedCurrent(context)) throw new Error('The settings view retired.');
			const document = await port.read({ schemaVersion: 2, photoId }, { signal: context.signal }); check(context.signal);
			if (document.schemaVersion !== 2 || document.photoId !== photoId || document.versionId !== document.activeVersionId) throw new Error('The selected active version changed.');
			targets.push(Object.freeze({ photoId, versionId: id(document.versionId), expectedRevision: revision(document.revision) }));
		} return Object.freeze(targets);
	}
	async #batch(context: PhotoDevelopExecutionContextV2, port: PhotoLibraryDevelopPortV2, catalogId: string, targets: readonly PhotoLibraryDevelopBatchTargetV2[], action: PhotoLibraryDevelopBatchRequestV2['action'], label: string) {
		if (!this.#admittedCurrent(context)) throw new Error('The settings view retired.');
		const createdAt = this.#now(); if (!this.#admittedCurrent(context)) throw new Error('The settings view retired.');
		const receipt = await settings(port).applyBatch({ schemaVersion: 2, catalogId, targets, action, label, createdAt }, { signal: context.signal });
		if (this.#acknowledgedCurrent(context)) {
			this.#publish({ batch: receipt, notice: null });
			try { check(context.signal); await context.refresh(); check(context.signal); }
			catch { if (this.#acknowledgedCurrent(context)) this.#publish({ notice: 'refresh-failed' }); }
		} return receipt;
	}
	async #acquire(context: PhotoDevelopExecutionContextV2) {
		if (!this.#admittedCurrent(context)) return null;
		const value = await context.acquire(); if (!this.#admittedCurrent(context)) return null;
		try { const port = capturePhotoLibraryDevelopPortV2(value); return this.#admittedCurrent(context) ? port : null; }
		catch (error) { check(context.signal); throw error; }
	}
	#current(context: PhotoDevelopExecutionContextV2): boolean {
		const current = context.isCurrent(); return !this.#closed && !this.#retired && current;
	}
	#admittedCurrent(context: PhotoDevelopExecutionContextV2): boolean {
		check(context.signal);
		try { const current = this.#current(context); check(context.signal); return current; }
		catch (error) { check(context.signal); throw error; }
	}
	#acknowledgedCurrent(context: PhotoDevelopExecutionContextV2): boolean {
		try { return this.#current(context); } catch { return false; }
	}
	#admit<Value>(admit: () => Value, signal: AbortSignal): Value {
		check(signal);
		try { const value = admit(); check(signal); return value; }
		catch (error) { check(signal); throw error; }
	}
	#isCurrent(context: PhotoDevelopExecutionContextV2, epoch: number): boolean {
		const current = context.isCurrent(); return epoch === this.#epoch && !this.#closed && !this.#retired && current;
	}
	#publish(update: Partial<PhotoDevelopSettingsWorkflowSnapshotV2>): void {
		if (this.#closed) return; this.#view = Object.freeze({ ...this.#view, ...update });
		try { this.#listener?.(this.#view); } catch { /* Scalar observers cannot erase ACK or strand a demand. */ }
	}
	#run<Input, Result>(admit: () => Input, action: (context: PhotoDevelopExecutionContextV2, input: Input) => Promise<Result>): Promise<Result | null> {
		if (this.#closed || this.#retired || this.#pending) return Promise.resolve(null);
		const epoch = this.#epoch, stop = new AbortController(); this.#active = stop;
		let resolve!: (result: Result | null) => void;
		const pending = new Promise<Result | null>(accept => { resolve = accept; }); this.#pending = pending; this.#publish({ busy: true, error: null });
		const run = async (): Promise<Result | null> => {
			let result: Result | null = null;
			try {
				if (this.#closed || this.#retired || epoch !== this.#epoch) return null;
				const input = this.#admit(admit, stop.signal);
				if (this.#closed || this.#retired || epoch !== this.#epoch) return null;
				await this.#execute(async context => {
					if (this.#closed || this.#retired || epoch !== this.#epoch) return;
					const signal = context.signal;
					try {
						const borrowed = this.#admit(() => capturePhotoDevelopExecutionContextV2(context, signal), stop.signal);
						if (this.#closed || this.#retired || epoch !== this.#epoch) return;
						result = await action({ ...borrowed, isCurrent: () => this.#isCurrent(borrowed, epoch) }, input);
					} catch (error) { if (!(Reflect.apply(ABORTED, signal, []) && Object.is(Reflect.apply(REASON, signal, []), error))) throw error; }
				}, stop.signal);
			} catch (error) {
				if (epoch === this.#epoch && !this.#retired && !(Reflect.apply(ABORTED, stop.signal, []) && Object.is(Reflect.apply(REASON, stop.signal, []), error))) this.#publish({ error: 'The settings action failed. Reload before retrying.' });
			} finally { this.#pending = null; this.#active = null; this.#publish({ busy: false }); } return result;
		};
		void run().then(resolve); return pending;
	}
}
function target(value: PhotoDevelopSettingsSourceV2): PhotoLibraryDevelopBatchTargetV2 {
	return Object.freeze({ photoId: value.photoId, versionId: value.versionId, expectedRevision: value.revision });
}
function settings(port: PhotoLibraryDevelopPortV2) { if (!port.settings) throw new Error('Develop settings are unavailable.'); return port.settings; }
function presets(port: PhotoLibraryDevelopPortV2) { if (!port.presets) throw new Error('Develop presets are unavailable.'); return port.presets; }
