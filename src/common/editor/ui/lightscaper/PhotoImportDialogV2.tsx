/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { PhotoLibraryImportGestureReceiptV1, PhotoLibraryImportSettingsV1 } from '../../photo-library-import-settings-port-v1.ts';
import type { PhotoLibraryDevelopPresetReadV2 } from '../../photo-library-develop-presets-port-v2.ts';
import { photoDevelopSettingsCopy } from '../../../i18n/lightscaper-develop-settings-copy.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import PhotoImportOptions, { type PhotoImportOptionsCopyV1 } from './PhotoImportOptions.tsx';
import PhotoImportPresetControls, { type PhotoImportPresetControlsPropsV1, type PhotoImportPresetCopyV1, type PhotoImportPresetDraftV1 } from './PhotoImportPresetControls.tsx';
import PhotoImportKeywordOptions, { type PhotoImportKeywordOptionsPropsV1, type PhotoImportKeywordCopyV1 } from './PhotoImportKeywordOptions.tsx';
import PhotoImportDevelopPresetsV2, { type PhotoImportDevelopPresetsPropsV2 } from './PhotoImportDevelopPresetsV2.tsx';
import { detachPhotoLibraryImportGestureV2, type PhotoLibraryImportGestureOptionsV2 } from './photo-library-workflow-import-v2.ts';

export interface PhotoImportDialogPropsV2 {
	readonly locale?: string;
	readonly title: string;
	readonly filesLabel: string;
	readonly importLabel: string;
	readonly cancelLabel: string;
	readonly failureLabel: string;
	readonly busy: boolean;
	readonly error: string | null;
	readonly copy: PhotoImportOptionsCopyV1 & PhotoImportPresetCopyV1 & PhotoImportKeywordCopyV1;
	readonly readPresets: PhotoImportPresetControlsPropsV1['readPresets'];
	readonly readDevelopPresets?: PhotoImportDevelopPresetsPropsV2['readPresets'];
	readonly applyPreset: PhotoImportPresetControlsPropsV1['applyPreset'];
	readonly createId: PhotoImportPresetControlsPropsV1['createId'];
	readonly readDefinitions: PhotoImportKeywordOptionsPropsV1['readDefinitions'];
	readonly readDefinition: PhotoImportKeywordOptionsPropsV1['readDefinition'];
	readonly definitionReader: PhotoImportKeywordOptionsPropsV1['definitionReader'];
	readonly onClose: () => void;
	readonly onImport: (files: readonly File[], options?: PhotoLibraryImportGestureOptionsV2) => Promise<PhotoLibraryImportGestureReceiptV1>;
}
const PLAIN_SETTINGS: PhotoLibraryImportSettingsV1 = Object.freeze({ rename: null, metadata: Object.freeze({}), keywordIds: Object.freeze([]) });
const nativeCheck = AbortSignal.prototype.throwIfAborted;
const nativeAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
interface Scope { live: boolean; dismissing: boolean; readonly importFiles: PhotoImportDialogPropsV2['onImport'] }
interface Demand { readonly scope: Scope; readonly controller: AbortController }

/** Opted-in current import choices; immutable originals and recipe bodies remain with the selected Session. */
export default function PhotoImportDialogV2(props: PhotoImportDialogPropsV2) {
	const input = useRef<HTMLInputElement>(null), latest = useRef(props); latest.current = props;
	const [selectedCount, setSelectedCount] = useState(0);
	const [settings, setSettings] = useState(PLAIN_SETTINGS), [pending, setPending] = useState(false), [failure, setFailure] = useState<string | null>(null);
	const [presetDraft, setPresetDraft] = useState<PhotoImportPresetDraftV1>({ id: '', name: '', allocatedId: null });
	const [developPreset, setDevelopPreset] = useState<PhotoLibraryDevelopPresetReadV2 | null>(null), [presetPending, setPresetPending] = useState(false);
	const scope = useRef<Scope | null>(null), active = useRef<Demand | null>(null);
	useEffect(() => {
		const current: Scope = { live: true, dismissing: false, importFiles: props.onImport }; scope.current = current; setPending(active.current !== null); setFailure(null);
		return () => { current.live = false; if (active.current?.scope === current) active.current.controller.abort(); };
	}, [props.onImport, props.onClose]);
	const close = () => {
		const current = scope.current;
		if (latest.current !== props || !current?.live || current.dismissing) return;
		const dismiss = props.onClose; current.dismissing = true; active.current?.controller.abort();
		if (current.live && scope.current === current && latest.current.onImport === current.importFiles && latest.current.onClose === dismiss) Reflect.apply(dismiss, props, []);
	};
	const locked = props.busy || pending || presetPending;
	const submit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const current = scope.current, files = input.current?.files;
		if (!current?.live || current.dismissing || current.importFiles !== props.onImport || latest.current !== props || active.current || locked || !files?.length) return;
		const job: Demand = { scope: current, controller: new AbortController() }; active.current = job; setPending(true); setFailure(null);
		const live = () => current.live && !current.dismissing && scope.current === current && active.current === job;
		const fail = (error: unknown, fallback: string) => {
			if (!live() || Reflect.apply(nativeAborted, job.controller.signal, [])) return;
			const diagnostic = message(error, fallback);
			if (live() && !Reflect.apply(nativeAborted, job.controller.signal, [])) setFailure(diagnostic);
		};
		try {
			if (files.length > 64) throw new RangeError('Import requires at most 64 selected Files.');
			const draft = detachPhotoLibraryImportGestureV2(Object.freeze(Array.from(files)), { signal: job.controller.signal, settings,
				...(developPreset === null ? {} : { developPreset }) });
			const recipe = draft.settings!, plain = recipe.rename === null && Object.keys(recipe.metadata).length === 0 && recipe.keywordIds.length === 0;
			const request: PhotoLibraryImportGestureOptionsV2 = Object.freeze({ signal: job.controller.signal,
				...(plain ? {} : { settings: recipe }), ...(draft.developPreset === undefined ? {} : { developPreset: draft.developPreset }) });
			const write = props.onImport, dismiss = props.onClose, fallback = props.failureLabel;
			Reflect.apply(nativeCheck, job.controller.signal, []);
			void Promise.resolve().then(() => {
				Reflect.apply(nativeCheck, job.controller.signal, []);
				if (!live()) return undefined;
				return Reflect.apply(write, props, [draft.selected, request]) as ReturnType<typeof write>;
			}).then(receipt => {
				Reflect.apply(nativeCheck, job.controller.signal, []);
				if (!live()) return;
				const acknowledged = receipt?.outcome === 'acknowledged';
				Reflect.apply(nativeCheck, job.controller.signal, []);
				if (live() && acknowledged) { current.dismissing = true; Reflect.apply(dismiss, props, []); }
			}).catch((error: unknown) => { fail(error, fallback); }).finally(() => {
				if (active.current === job) { active.current = null; if (scope.current?.live) setPending(false); }
			});
		} catch (error) {
			fail(error, props.failureLabel);
			if (active.current === job) { active.current = null; if (scope.current?.live) setPending(false); }
		}
	};
	return <AudioEditorDialogShell title={props.title} onClose={close}
		className="lightscaper-dialog" overlayClassName="lightscaper-dialog-backdrop"
		initialFocus="input[type=file]" closeOnOutside={false}>
		<form onSubmit={submit} data-photo-import-form>
			{(failure ?? props.error) && <p role="alert">{failure ?? props.error}</p>}
			<label>{props.filesLabel}<input ref={input} type="file" multiple accept="image/jpeg,image/png,image/gif,image/webp,image/bmp"
				disabled={locked} onChange={() => { setSelectedCount(input.current?.files?.length ?? 0); }} /></label>
			<PhotoImportOptions value={settings} onChange={setSettings} busy={locked} copy={props.copy}>
				<PhotoImportPresetControls value={settings} onChange={setSettings} busy={locked} copy={props.copy}
					readPresets={props.readPresets} applyPreset={props.applyPreset} createId={props.createId} draft={presetDraft} onDraftChange={setPresetDraft} />
				{props.readDevelopPresets && <PhotoImportDevelopPresetsV2 readPresets={props.readDevelopPresets} value={developPreset} onChange={setDevelopPreset}
					busy={locked} onPending={setPresetPending} copy={photoDevelopSettingsCopy(props.locale ?? 'en')} />}
				<PhotoImportKeywordOptions keywordIds={settings.keywordIds} busy={locked} copy={props.copy}
					onChange={keywordIds => { setSettings(previous => Object.freeze({ ...previous, keywordIds })); }}
					readDefinitions={props.readDefinitions} readDefinition={props.readDefinition} definitionReader={props.definitionReader} />
			</PhotoImportOptions>
			<div className="lightscaper-dialog-actions">
				<button type="submit" disabled={locked || selectedCount === 0}>{props.importLabel}</button>
				<button type="button" data-photo-import-cancel onClick={close}>{props.cancelLabel}</button>
			</div>
		</form>
	</AudioEditorDialogShell>;
}
function message(error: unknown, fallback: string): string {
	try {
		const descriptor = error && typeof error === 'object' ? Object.getOwnPropertyDescriptor(error, 'message') : undefined;
		return descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'string' ? descriptor.value.slice(0, 2_048) : fallback;
	} catch { return fallback; }
}
