/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoDevelopExecutionContextForProfileV1, ExecutePhotoDevelopForProfileV1 } from './photo-library-develop-workflow-kernel-v1.ts';
import { capturePhotoDevelopPortForProfileV1, capturePhotoDevelopContextForProfileV1, type PhotoDevelopProfileV1, type PhotoDevelopPortForProfileV1 } from './photo-library-develop-command-kernel-v1.ts';
import type { PhotoLibraryDevelopPortV2 } from '../../../photo-library-develop-port-v2.ts';
import type { PhotoLibraryDevelopBatchReceiptV2, PhotoLibraryDevelopBatchTargetV2, PhotoLibraryDevelopBatchRequestV2 } from '../../../photo-library-develop-settings-port-v2.ts';
import type { PhotoLibraryDevelopPresetSnapshotV2, PhotoLibraryDevelopPresetAcknowledgementV2, PhotoLibraryDevelopPresetsPortV2 } from '../../../photo-library-develop-presets-port-v2.ts';
import type { ImageDevelopSelectionV1 as ImageDevelopSelectionV2 } from '../../../imaging/image-develop-settings-contract-v1.ts';
import type { ImageDevelopSettingsPacketV2 } from '../../../imaging/image-develop-settings-contract-v2.ts';
import { normalizeImageDevelopSelectionV2 } from '../../../imaging/image-develop-settings-v2.ts';
import { normalizeImageDevelopRelativeActionV1 as normalizeImageDevelopRelativeActionV2 } from '../../../imaging/image-develop-settings-v1.ts';
import { normalizeImageDevelopPresetV1OrV2 } from '../../../imaging/image-develop-preset-v2.ts';
import { normalizeImageDevelopSelectedPresetCurrentV1 } from '../../../imaging/image-develop-preset-selected-v3.ts';
import type { PhotoLibraryDevelopPresetSnapshotCurrentV1, PhotoLibraryDevelopPresetAcknowledgementCurrentV1, PhotoLibraryDevelopPresetsPortCurrentV1,
	PhotoLibraryDevelopPresetCommandCurrentV1, PhotoLibraryDevelopPresetBodyCurrentV1 } from '../../../photo-library-develop-presets-port-current-v1.ts';
import { detachPhotoDevelopSettingsSourceV2 as source, developSettingsId as id, developSettingsIds as ids,
	developSettingsName as name, developSettingsRevision as revision, type PhotoDevelopSettingsSourceV2 } from '../photo-library-develop-settings-intent-v2.ts';

import type { PhotoLibraryDevelopPortCurrentV1 } from '../../../photo-library-develop-port-current-v1.ts';
import type { PhotoLibraryDevelopBatchReceiptCurrentV1, PhotoLibraryDevelopBatchRequestCurrentV1 } from '../../../photo-library-develop-settings-port-current-v1.ts';
import type { ImageDevelopSelectionV4, ImageDevelopSettingsPacketV4 } from '../../../imaging/image-develop-settings-contract-v4.ts';
import { normalizeImageDevelopSelectionV4 } from '../../../imaging/image-develop-settings-v4.ts';
import { detachPhotoDevelopSettingsSourceCurrentV1, type PhotoDevelopSettingsSourceCurrentV1 } from '../photo-library-develop-settings-intent-current-v1.ts';

export type SettingsSourceForProfileV1<Profile extends PhotoDevelopProfileV1> = Profile extends 'legacy2' ? PhotoDevelopSettingsSourceV2 : PhotoDevelopSettingsSourceCurrentV1;
export type SettingsSelectionForProfileV1<Profile extends PhotoDevelopProfileV1> = Profile extends 'legacy2' ? ImageDevelopSelectionV2 : ImageDevelopSelectionV4;
export type SettingsPacketForProfileV1<Profile extends PhotoDevelopProfileV1> = Profile extends 'legacy2' ? ImageDevelopSettingsPacketV2 : ImageDevelopSettingsPacketV4;
export type SettingsReceiptForProfileV1<Profile extends PhotoDevelopProfileV1> = Profile extends 'legacy2' ? PhotoLibraryDevelopBatchReceiptV2 : PhotoLibraryDevelopBatchReceiptCurrentV1;
type PresetSnapshotForProfileV1<Profile extends PhotoDevelopProfileV1> = Profile extends 'legacy2' ? PhotoLibraryDevelopPresetSnapshotV2 : PhotoLibraryDevelopPresetSnapshotCurrentV1;
type PresetAcknowledgementForProfileV1<Profile extends PhotoDevelopProfileV1> = Profile extends 'legacy2' ? PhotoLibraryDevelopPresetAcknowledgementV2 : PhotoLibraryDevelopPresetAcknowledgementCurrentV1;
type PresetCommand = Parameters<PhotoLibraryDevelopPresetsPortV2['write']>[0]['command'] | PhotoLibraryDevelopPresetCommandCurrentV1;
type PresetPort = PhotoLibraryDevelopPresetsPortV2 | PhotoLibraryDevelopPresetsPortCurrentV1;
type BatchAction = PhotoLibraryDevelopBatchRequestV2['action'] | PhotoLibraryDevelopBatchRequestCurrentV1['action'];
export interface PhotoDevelopSettingsWorkflowSnapshotForProfileV1<Profile extends PhotoDevelopProfileV1> {
	readonly busy: boolean;
	readonly clipboard: SettingsPacketForProfileV1<Profile> | null;
	readonly presets: PresetSnapshotForProfileV1<Profile> | null;
	readonly batch: SettingsReceiptForProfileV1<Profile> | null;
	readonly presetReceipt: PresetAcknowledgementForProfileV1<Profile> | null;
	readonly autoSync: boolean;
	readonly autoSyncTargetCount: number;
	readonly notice: 'refresh-failed' | null;
	readonly error: string | null;
}
interface AutoSync<Profile extends PhotoDevelopProfileV1> {
	readonly catalogId: string; readonly photoId: string; readonly versionId: string;
	readonly selection: SettingsSelectionForProfileV1<Profile>; readonly targets: readonly PhotoLibraryDevelopBatchTargetV2[];
}
interface SelectedPreset { readonly revision: number; readonly info: PhotoLibraryDevelopPresetSnapshotV2['presets'][number]; }
const CHECK = AbortSignal.prototype.throwIfAborted;
const ABORTED = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const REASON = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
function check(signal: AbortSignal): void { Reflect.apply(CHECK, signal, []); }

/** One menu demand borrows the existing Session; recipes never become resource owners. */
export class PhotoLibraryDevelopSettingsWorkflowKernelV1<Profile extends PhotoDevelopProfileV1> {
	readonly #profile: Profile;
	readonly #execute: ExecutePhotoDevelopForProfileV1<Profile>;
	readonly #now: () => string;
	readonly #createId: () => string;
	#view: PhotoDevelopSettingsWorkflowSnapshotForProfileV1<Profile> = Object.freeze({ busy: false, clipboard: null, presets: null, batch: null,
		presetReceipt: null, autoSync: false, autoSyncTargetCount: 0, notice: null, error: null });
	#listener: ((view: PhotoDevelopSettingsWorkflowSnapshotForProfileV1<Profile>) => void) | null = null;
	#auto: AutoSync<Profile> | null = null;
	#pending: Promise<unknown> | null = null;
	#active: AbortController | null = null;
	#closed = false;
	#retired = false;
	#epoch = 0;
	#closing: Promise<void> | null = null;

	constructor(profile: Profile, options: Readonly<{ execute: ExecutePhotoDevelopForProfileV1<Profile>; now?: () => string; createId?: () => string }>) {
		if (profile !== 'legacy2' && profile !== 'current4') throw new TypeError('Unknown fixed Develop settings workflow profile.');
		this.#profile = profile;
		const execute = options.execute, now = options.now ?? (() => new Date().toISOString()), createId = options.createId ?? (() => crypto.randomUUID());
		this.#execute = (...args) => Reflect.apply(execute, options, args); this.#now = () => Reflect.apply(now, options, []);
		this.#createId = () => Reflect.apply(createId, options, []);
	}
	snapshot(): PhotoDevelopSettingsWorkflowSnapshotForProfileV1<Profile> { return this.#view; }
	subscribe(listener: (view: PhotoDevelopSettingsWorkflowSnapshotForProfileV1<Profile>) => void): () => void {
		this.#listener = listener; listener(this.#view); return () => { if (this.#listener === listener) this.#listener = null; };
	}
	copy(value: SettingsSourceForProfileV1<Profile>, selection: SettingsSelectionForProfileV1<Profile>): Promise<null> {
		return this.#run(() => ({ source: this.#source(value), selection: this.#selection(selection) }), async (context, input) => {
			const port = await this.#acquire(context); if (!port) return null;
			const clipboard = await this.#copy(context, port, input.source, input.selection);
			if (this.#admittedCurrent(context)) this.#publish({ clipboard }); return null;
		});
	}
	paste(value: SettingsSourceForProfileV1<Profile>, label: string): Promise<SettingsReceiptForProfileV1<Profile> | null> {
		return this.#run(() => {
			if (!this.#view.clipboard) throw new Error('No copied settings are available.');
			return { source: this.#source(value), packet: this.#view.clipboard, label: name(label) };
		}, async (context, input) => {
			const port = await this.#acquire(context); if (!port) return null;
			return this.#batch(context, port, input.source.catalogId, [target(input.source)], { kind: 'paste', settings: input.packet }, input.label);
		});
	}
	sync(value: SettingsSourceForProfileV1<Profile>, selected: readonly string[], selection: SettingsSelectionForProfileV1<Profile>, label: string): Promise<SettingsReceiptForProfileV1<Profile> | null> {
		return this.#run(() => ({ source: this.#source(value), ids: ids(selected), selection: this.#selection(selection), label: name(label) }), async (context, input) => {
			const port = await this.#acquire(context); if (!port) return null;
			const targets = await this.#targets(context, port, input.ids.filter(photoId => photoId !== input.source.photoId));
			if (!targets.length) throw new RangeError('Sync requires another selected photo.');
			const packet = await this.#copy(context, port, input.source, input.selection);
			return this.#batch(context, port, input.source.catalogId, targets, { kind: 'paste', settings: packet }, input.label);
		});
	}
	armAutoSync(value: SettingsSourceForProfileV1<Profile>, selected: readonly string[], selection: SettingsSelectionForProfileV1<Profile>): Promise<null> {
		return this.#run(() => ({ source: this.#source(value), ids: ids(selected), selection: this.#selection(selection) }), async (context, input) => {
			const port = await this.#acquire(context); if (!port) return null;
			settings(this.#profile, port);
			const targets = await this.#targets(context, port, input.ids.filter(photoId => photoId !== input.source.photoId));
			if (!targets.length) throw new RangeError('Auto-sync requires another selected photo.');
			if (this.#admittedCurrent(context)) {
				this.#auto = Object.freeze({ catalogId: input.source.catalogId, photoId: input.source.photoId, versionId: input.source.versionId, selection: input.selection, targets });
				this.#publish({ autoSync: true, autoSyncTargetCount: targets.length });
			} return null;
		});
	}
	clearAutoSync(): void { this.#auto = null; this.#publish({ autoSync: false, autoSyncTargetCount: 0 }); }
	syncAcknowledged(value: SettingsSourceForProfileV1<Profile>, label: string): Promise<SettingsReceiptForProfileV1<Profile> | null> {
		if (!this.#auto) return Promise.resolve(null);
		return this.#run(() => ({ source: this.#source(value), auto: this.#auto!, label: name(label) }), async (context, input) => {
			if (input.source.catalogId !== input.auto.catalogId || input.source.photoId !== input.auto.photoId || input.source.versionId !== input.auto.versionId) throw new Error('Auto-sync belongs to another photo version.');
			const port = await this.#acquire(context); if (!port) return null;
			const packet = await this.#copy(context, port, input.source, input.auto.selection);
			const receipt = await this.#batch(context, port, input.auto.catalogId, input.auto.targets, { kind: 'paste', settings: packet }, input.label);
			if (this.#acknowledgedCurrent(context) && this.#auto === input.auto) {
				if (receipt.completion !== 'finished' || receipt.outcomes.some(outcome => outcome.status !== 'applied' && outcome.status !== 'unchanged')) this.clearAutoSync();
				else this.#auto = Object.freeze({ ...input.auto, targets: Object.freeze(input.auto.targets.map((before, index) => Object.freeze({ ...before, expectedRevision: receipt.outcomes[index]!.revision! }))) });
			} return receipt;
		});
	}
	relative(catalogId: string, selected: readonly string[], effectType: 'white-balance-v1' | 'tone-ladder-v1', changes: Readonly<Record<string, number>>, label: string): Promise<SettingsReceiptForProfileV1<Profile> | null> {
		return this.#run(() => ({ catalogId: id(catalogId), ids: ids(selected), action: normalizeImageDevelopRelativeActionV2({ effectType, changes }), label: name(label) }), async (context, input) => {
			const port = await this.#acquire(context); if (!port) return null;
			const targets = await this.#targets(context, port, input.ids);
			return this.#batch(context, port, input.catalogId, targets, { kind: 'relative', ...input.action }, input.label);
		});
	}
	protected listPresetsLegacy(catalogId: string): Promise<PhotoLibraryDevelopPresetSnapshotV2 | null> {
		this.#assertLegacy(); return this.#listPresets(catalogId) as Promise<PhotoLibraryDevelopPresetSnapshotV2 | null>;
	}
	protected listPresetsCurrent(catalogId: string): Promise<PhotoLibraryDevelopPresetSnapshotCurrentV1 | null> {
		this.#assertCurrent(); return this.#listPresets(catalogId) as Promise<PhotoLibraryDevelopPresetSnapshotCurrentV1 | null>;
	}
	protected savePresetLegacy(value: SettingsSourceForProfileV1<Profile>, selection: SettingsSelectionForProfileV1<Profile>, presetName: string): Promise<PhotoLibraryDevelopPresetAcknowledgementV2 | null> {
		this.#assertLegacy(); return this.#savePreset(value, selection, presetName) as Promise<PhotoLibraryDevelopPresetAcknowledgementV2 | null>;
	}
	protected savePresetCurrent(value: SettingsSourceForProfileV1<Profile>, selection: SettingsSelectionForProfileV1<Profile>, presetName: string): Promise<PhotoLibraryDevelopPresetAcknowledgementCurrentV1 | null> {
		this.#assertCurrent(); return this.#savePreset(value, selection, presetName) as Promise<PhotoLibraryDevelopPresetAcknowledgementCurrentV1 | null>;
	}
	protected applyPresetLegacy(value: SettingsSourceForProfileV1<Profile>, presetId: string, listRevision: number, label: string): Promise<SettingsReceiptForProfileV1<Profile> | null> {
		this.#assertLegacy(); return this.#applyPreset(value, presetId, listRevision, label);
	}
	protected applyPresetCurrent(value: SettingsSourceForProfileV1<Profile>, presetId: string, listRevision: number, label: string): Promise<SettingsReceiptForProfileV1<Profile> | null> {
		this.#assertCurrent(); return this.#applyPreset(value, presetId, listRevision, label);
	}
	protected renamePresetLegacy(catalogId: string, presetId: string, listRevision: number, presetName: string): Promise<PhotoLibraryDevelopPresetAcknowledgementV2 | null> {
		this.#assertLegacy(); return this.#renamePreset(catalogId, presetId, listRevision, presetName) as Promise<PhotoLibraryDevelopPresetAcknowledgementV2 | null>;
	}
	protected renamePresetCurrent(catalogId: string, presetId: string, listRevision: number, presetName: string): Promise<PhotoLibraryDevelopPresetAcknowledgementCurrentV1 | null> {
		this.#assertCurrent(); return this.#renamePreset(catalogId, presetId, listRevision, presetName) as Promise<PhotoLibraryDevelopPresetAcknowledgementCurrentV1 | null>;
	}
	protected deletePresetLegacy(catalogId: string, presetId: string, listRevision: number): Promise<PhotoLibraryDevelopPresetAcknowledgementV2 | null> {
		this.#assertLegacy(); return this.#deletePreset(catalogId, presetId, listRevision) as Promise<PhotoLibraryDevelopPresetAcknowledgementV2 | null>;
	}
	protected deletePresetCurrent(catalogId: string, presetId: string, listRevision: number): Promise<PhotoLibraryDevelopPresetAcknowledgementCurrentV1 | null> {
		this.#assertCurrent(); return this.#deletePreset(catalogId, presetId, listRevision) as Promise<PhotoLibraryDevelopPresetAcknowledgementCurrentV1 | null>;
	}
	#listPresets(catalogId: string): Promise<PresetSnapshotForProfileV1<Profile> | null> {
		return this.#run(() => id(catalogId), async (context, catalog) => {
			const port = await this.#acquire(context); if (!port) return null;
			const capability = presets(this.#profile, port);
			const snapshot = await (Reflect.apply(capability.list, capability, [{ schemaVersion: this.#schema, catalogId: catalog }, { signal: context.signal }]) as Promise<PresetSnapshotForProfileV1<Profile>>); check(context.signal);
			if (snapshot.schemaVersion !== this.#schema || snapshot.catalogId !== catalog || snapshot.presets.length > 16) throw new Error('Preset menu changed catalog or exceeded its bound.');
			if (this.#admittedCurrent(context)) this.#publish({ presets: snapshot }); return snapshot;
		});
	}
	#savePreset(value: SettingsSourceForProfileV1<Profile>, selection: SettingsSelectionForProfileV1<Profile>, presetName: string): Promise<PresetAcknowledgementForProfileV1<Profile> | null> {
		return this.#run(() => { const captured = this.#source(value); return { source: captured, selection: this.#selection(selection), name: name(presetName), expectedRevision: this.#menu(captured.catalogId).revision, id: id(this.#createId()) }; }, async (context, input) => {
			const port = await this.#acquire(context); if (!port) return null;
			const packet = await this.#copy(context, port, input.source, input.selection), capability = presets(this.#profile, port);
			const preset = Reflect.apply(capability.create, capability, [{ schemaVersion: this.#schema, id: input.id, name: input.name, settings: packet }]) as ReturnType<PhotoLibraryDevelopPresetsPortCurrentV1['create']> | ReturnType<PhotoLibraryDevelopPresetsPortV2['create']>;
			return this.#writePreset(context, capability, input.source.catalogId, { type: 'save', expectedRevision: input.expectedRevision, preset });
		});
	}
	#applyPreset(value: SettingsSourceForProfileV1<Profile>, presetId: string, listRevision: number, label: string): Promise<SettingsReceiptForProfileV1<Profile> | null> {
		return this.#run(() => { const captured = this.#source(value); return { source: captured, selected: this.#selected(captured.catalogId, presetId, listRevision), label: name(label) }; }, async (context, input) => {
			const port = await this.#acquire(context); if (!port) return null;
			if (this.#profile === 'current4') return this.#batch(context, port, input.source.catalogId, [target(input.source)],
				{ kind: 'preset', presetId: input.selected.info.id, expectedPresetRevision: input.selected.revision }, input.label);
			const preset = await this.#readPreset(context, presets(this.#profile, port), input.source.catalogId, input.selected);
			return this.#batch(context, port, input.source.catalogId, [target(input.source)], { kind: 'paste', settings: preset.settings }, input.label);
		});
	}
	#renamePreset(catalogId: string, presetId: string, listRevision: number, presetName: string): Promise<PresetAcknowledgementForProfileV1<Profile> | null> {
		return this.#run(() => ({ catalogId: id(catalogId), selected: this.#selected(catalogId, presetId, listRevision), name: name(presetName) }), async (context, input) => {
			const port = await this.#acquire(context); if (!port) return null;
			const capability = presets(this.#profile, port), body = await this.#readPreset(context, capability, input.catalogId, input.selected);
			const value = { ...body, identity: { ...body.identity, name: input.name } };
			const preset = this.#profile === 'legacy2' ? normalizeImageDevelopPresetV1OrV2(value) : normalizeImageDevelopSelectedPresetCurrentV1(value);
			return this.#writePreset(context, capability, input.catalogId, { type: 'save', expectedRevision: input.selected.revision, preset });
		});
	}
	#deletePreset(catalogId: string, presetId: string, listRevision: number): Promise<PresetAcknowledgementForProfileV1<Profile> | null> {
		return this.#run(() => ({ catalogId: id(catalogId), selected: this.#selected(catalogId, presetId, listRevision) }), async (context, input) => {
			const port = await this.#acquire(context); if (!port) return null;
			return this.#writePreset(context, presets(this.#profile, port), input.catalogId, { type: 'delete', expectedRevision: input.selected.revision, presetId: input.selected.info.id });
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
	get #schema(): 2 | 3 { return this.#profile === 'legacy2' ? 2 : 3; }
	#assertLegacy(): void { if (this.#profile !== 'legacy2') throw new TypeError('Legacy presets require the legacy profile.'); }
	#assertCurrent(): void { if (this.#profile !== 'current4') throw new TypeError('Current presets require the Current profile.'); }
	#source(value: unknown): SettingsSourceForProfileV1<Profile> {
		return (this.#profile === 'legacy2' ? source(value) : detachPhotoDevelopSettingsSourceCurrentV1(value)) as SettingsSourceForProfileV1<Profile>;
	}
	#selection(value: unknown): SettingsSelectionForProfileV1<Profile> {
		return (this.#profile === 'legacy2' ? normalizeImageDevelopSelectionV2(value) : normalizeImageDevelopSelectionV4(value)) as SettingsSelectionForProfileV1<Profile>;
	}
	async #copy(context: PhotoDevelopExecutionContextForProfileV1<Profile>, port: Readonly<PhotoDevelopPortForProfileV1<Profile>>,
		value: SettingsSourceForProfileV1<Profile>, selection: SettingsSelectionForProfileV1<Profile>): Promise<SettingsPacketForProfileV1<Profile>> {
		if (!this.#admittedCurrent(context)) throw new Error('The settings view retired.');
		const child = settings(this.#profile, port);
		const packet = this.#profile === 'legacy2'
			? (child as NonNullable<PhotoLibraryDevelopPortV2['settings']>).copy({ schemaVersion: 2, develop: value.develop as PhotoDevelopSettingsSourceV2['develop'], selection })
			: await (child as NonNullable<PhotoLibraryDevelopPortCurrentV1['settingsCurrent']>).copySelected({ ...value, schemaVersion: 3,
				selection: selection as ImageDevelopSelectionV4 }, { signal: context.signal });
		if (!this.#admittedCurrent(context)) throw new Error('The settings view retired.');
		if (packet.schemaVersion !== (this.#profile === 'legacy2' ? 2 : 4)) throw new Error('Copied settings changed schema.');
		// Preserve the exact enrolled selected packet; normalizing or cloning it
		// would discard the Session's independent brush-authentication proof.
		return packet as SettingsPacketForProfileV1<Profile>;
	}

	#menu(catalogId: string): PresetSnapshotForProfileV1<Profile> {
		const snapshot = this.#view.presets;
		if (!snapshot || snapshot.catalogId !== id(catalogId)) throw new Error('Load the preset menu first.'); return snapshot;
	}
	#selected(catalogId: string, presetId: string, listRevision: number): SelectedPreset {
		const snapshot = this.#menu(catalogId), expected = revision(listRevision), selected = id(presetId);
		const info = snapshot.presets.find(preset => preset.id === selected);
		if (snapshot.revision !== expected || !info) throw new Error('Reload the changed preset menu.'); return Object.freeze({ revision: expected, info });
	}
	async #readPreset(context: PhotoDevelopExecutionContextForProfileV1<Profile>, capability: PresetPort, catalogId: string, selected: SelectedPreset) {
		const body = await (Reflect.apply(capability.read, capability, [{ schemaVersion: this.#schema, catalogId, presetId: selected.info.id, expectedRevision: selected.revision }, { signal: context.signal }]) as Promise<PhotoLibraryDevelopPresetBodyCurrentV1 | Awaited<ReturnType<PhotoLibraryDevelopPresetsPortV2['read']>>>);
		if (!this.#admittedCurrent(context)) throw new Error('The preset view retired.');
		const preset = this.#profile === 'legacy2' ? normalizeImageDevelopPresetV1OrV2(body.preset) : normalizeImageDevelopSelectedPresetCurrentV1(body.preset);
		if (body.schemaVersion !== this.#schema || body.catalogId !== catalogId || body.revision !== selected.revision || preset.identity.id !== selected.info.id || preset.identity.authoredStateSha256 !== selected.info.authoredStateSha256) throw new Error('The selected preset changed.'); return preset;
	}
	async #writePreset(context: PhotoDevelopExecutionContextForProfileV1<Profile>, capability: PresetPort, catalogId: string, command: PresetCommand) {
		if (!this.#admittedCurrent(context)) throw new Error('The settings view retired.');
		const receipt = await (Reflect.apply(capability.write, capability, [{ schemaVersion: this.#schema, catalogId, command }, { signal: context.signal }]) as Promise<PresetAcknowledgementForProfileV1<Profile>>);
		if (receipt.schemaVersion !== this.#schema || receipt.snapshot.schemaVersion !== this.#schema || receipt.snapshot.catalogId !== catalogId) throw new Error('Preset acknowledgment changed schema or catalog.');
		const snapshot = receipt.snapshot as PresetSnapshotForProfileV1<Profile>;
		if (this.#acknowledgedCurrent(context)) this.#publish({ presets: snapshot, presetReceipt: receipt }); return receipt;
	}
	async #targets(context: PhotoDevelopExecutionContextForProfileV1<Profile>, port: Readonly<PhotoDevelopPortForProfileV1<Profile>>, selected: readonly string[]) {
		const targets: PhotoLibraryDevelopBatchTargetV2[] = [];
		for (const photoId of selected) {
			if (!this.#admittedCurrent(context)) throw new Error('The settings view retired.');
			const document = await (Reflect.apply(port.read, port, [{ schemaVersion: this.#schema, photoId }, { signal: context.signal }]) as Promise<Readonly<{ schemaVersion: 2 | 3; photoId: string; versionId: string; activeVersionId: string; revision: number }>>); check(context.signal);
			if (document.schemaVersion !== this.#schema || document.photoId !== photoId || document.versionId !== document.activeVersionId) throw new Error('The selected active version changed.');
			targets.push(Object.freeze({ photoId, versionId: id(document.versionId), expectedRevision: revision(document.revision) }));
		} return Object.freeze(targets);
	}
	async #batch(context: PhotoDevelopExecutionContextForProfileV1<Profile>, port: Readonly<PhotoDevelopPortForProfileV1<Profile>>, catalogId: string, targets: readonly PhotoLibraryDevelopBatchTargetV2[], action: BatchAction, label: string) {
		if (!this.#admittedCurrent(context)) throw new Error('The settings view retired.');
		const createdAt = this.#now(); if (!this.#admittedCurrent(context)) throw new Error('The settings view retired.');
		const child = settings(this.#profile, port);
		const receipt = await (Reflect.apply(child.applyBatch, child, [{ schemaVersion: this.#schema, catalogId, targets, action, label, createdAt }, { signal: context.signal }]) as Promise<SettingsReceiptForProfileV1<Profile>>);
		if (receipt.schemaVersion !== this.#schema || receipt.catalogId !== catalogId) throw new Error('Settings acknowledgment changed schema or catalog.');
		if (this.#acknowledgedCurrent(context)) {
			this.#publish({ batch: receipt, notice: null });
			try { check(context.signal); await context.refresh(); check(context.signal); }
			catch { if (this.#acknowledgedCurrent(context)) this.#publish({ notice: 'refresh-failed' }); }
		} return receipt;
	}
	async #acquire(context: PhotoDevelopExecutionContextForProfileV1<Profile>) {
		if (!this.#admittedCurrent(context)) return null;
		const value = await context.acquire(); if (!this.#admittedCurrent(context)) return null;
		try { const port = capturePhotoDevelopPortForProfileV1(this.#profile, value); return this.#admittedCurrent(context) ? port : null; }
		catch (error) { check(context.signal); throw error; }
	}
	#current(context: PhotoDevelopExecutionContextForProfileV1<Profile>): boolean {
		const current = context.isCurrent(); return !this.#closed && !this.#retired && current;
	}
	#admittedCurrent(context: PhotoDevelopExecutionContextForProfileV1<Profile>): boolean {
		check(context.signal);
		try { const current = this.#current(context); check(context.signal); return current; }
		catch (error) { check(context.signal); throw error; }
	}
	#acknowledgedCurrent(context: PhotoDevelopExecutionContextForProfileV1<Profile>): boolean {
		try { return this.#current(context); } catch { return false; }
	}
	#admit<Value>(admit: () => Value, signal: AbortSignal): Value {
		check(signal);
		try { const value = admit(); check(signal); return value; }
		catch (error) { check(signal); throw error; }
	}
	#isCurrent(context: PhotoDevelopExecutionContextForProfileV1<Profile>, epoch: number): boolean {
		const current = context.isCurrent(); return epoch === this.#epoch && !this.#closed && !this.#retired && current;
	}
	#publish(update: Partial<PhotoDevelopSettingsWorkflowSnapshotForProfileV1<Profile>>): void {
		if (this.#closed) return; this.#view = Object.freeze({ ...this.#view, ...update });
		try { this.#listener?.(this.#view); } catch { /* Scalar observers cannot erase ACK or strand a demand. */ }
	}
	#run<Input, Result>(admit: () => Input, action: (context: PhotoDevelopExecutionContextForProfileV1<Profile>, input: Input) => Promise<Result>): Promise<Result | null> {
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
						const borrowed = this.#admit(() => capturePhotoDevelopContextForProfileV1(this.#profile, context, signal), stop.signal);
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
function target(value: PhotoDevelopSettingsSourceV2 | PhotoDevelopSettingsSourceCurrentV1): PhotoLibraryDevelopBatchTargetV2 {
	return Object.freeze({ photoId: value.photoId, versionId: value.versionId, expectedRevision: value.revision });
}
function settings<Profile extends PhotoDevelopProfileV1>(profile: Profile, port: Readonly<PhotoDevelopPortForProfileV1<Profile>>) {
	const child = profile === 'legacy2' ? (port as PhotoLibraryDevelopPortV2).settings : (port as PhotoLibraryDevelopPortCurrentV1).settingsCurrent;
	if (!child) throw new Error('Develop settings are unavailable.'); return child;
}
function presets<Profile extends PhotoDevelopProfileV1>(profile: Profile, port: Readonly<PhotoDevelopPortForProfileV1<Profile>>) {
	const child = profile === 'legacy2' ? (port as PhotoLibraryDevelopPortV2).presets : (port as PhotoLibraryDevelopPortCurrentV1).presetsCurrent;
	if (!child) throw new Error('Develop presets are unavailable.'); return child;
}
