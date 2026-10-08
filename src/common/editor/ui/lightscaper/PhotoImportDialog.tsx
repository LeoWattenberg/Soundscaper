/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { detachPhotoLibraryImportSettingsV1 } from '../../controller/shared/photo-library-import-gesture-v1.ts';
import type { PhotoLibraryImportGestureReceiptV1, PhotoLibraryImportRequestOptionsV1, PhotoLibraryImportSettingsV1 } from '../../photo-library-import-settings-port-v1.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import PhotoImportOptions, { type PhotoImportOptionsCopyV1 } from './PhotoImportOptions.tsx';
import PhotoImportPresetControls, { type PhotoImportPresetControlsPropsV1, type PhotoImportPresetCopyV1, type PhotoImportPresetDraftV1 } from './PhotoImportPresetControls.tsx';
import PhotoImportKeywordOptions, { type PhotoImportKeywordOptionsPropsV1, type PhotoImportKeywordCopyV1 } from './PhotoImportKeywordOptions.tsx';

interface Props {
	readonly title: string;
	readonly filesLabel: string;
	readonly importLabel: string;
	readonly cancelLabel: string;
	readonly failureLabel: string;
	readonly busy: boolean;
	readonly error: string | null;
	readonly copy: PhotoImportOptionsCopyV1 & PhotoImportPresetCopyV1 & PhotoImportKeywordCopyV1;
	readonly readPresets: PhotoImportPresetControlsPropsV1['readPresets'];
	readonly applyPreset: PhotoImportPresetControlsPropsV1['applyPreset'];
	readonly createId: PhotoImportPresetControlsPropsV1['createId'];
	readonly readDefinitions: PhotoImportKeywordOptionsPropsV1['readDefinitions'];
	readonly readDefinition: PhotoImportKeywordOptionsPropsV1['readDefinition'];
	readonly definitionReader: PhotoImportKeywordOptionsPropsV1['definitionReader'];
	readonly onClose: () => void;
	readonly onImport: (files: readonly File[], options?: Pick<PhotoLibraryImportRequestOptionsV1, 'settings' | 'signal'>) => Promise<PhotoLibraryImportGestureReceiptV1>;
}

const PLAIN_SETTINGS: PhotoLibraryImportSettingsV1 = Object.freeze({ rename: null, metadata: Object.freeze({}), keywordIds: Object.freeze([]) });
interface Scope { live: boolean }
interface Demand { readonly scope: Scope; readonly controller: AbortController }

export default function PhotoImportDialog(props: Props) {
	const input = useRef<HTMLInputElement>(null);
	const [selectedCount, setSelectedCount] = useState(0);
	const [settings, setSettings] = useState(PLAIN_SETTINGS), [pending, setPending] = useState(false), [failure, setFailure] = useState<string | null>(null);
	const [presetDraft, setPresetDraft] = useState<PhotoImportPresetDraftV1>({ id: '', name: '', allocatedId: null });
	const scope = useRef<Scope | null>(null), active = useRef<Demand | null>(null);
	useEffect(() => {
		const current = { live: true }; scope.current = current; setPending(false);
		return () => { current.live = false; if (active.current?.scope === current) active.current.controller.abort(); };
	}, [props.onImport]);
	const close = () => { active.current?.controller.abort(); props.onClose(); };
	const locked = props.busy || pending;
	const submit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const current = scope.current, files = input.current?.files;
		if (!current?.live || active.current || props.busy || !files?.length) return;
		try {
			if (files.length > 64) throw new RangeError('Import requires at most 64 selected Files.');
			const selected = Object.freeze(Array.from(files)), recipe = detachPhotoLibraryImportSettingsV1(settings);
			const plain = recipe.rename === null && Object.keys(recipe.metadata).length === 0 && recipe.keywordIds.length === 0;
			const job = { scope: current, controller: new AbortController() }; active.current = job; setPending(true); setFailure(null);
			// Register ownership before a borrowed callback can synchronously dismiss the form.
			void Promise.resolve().then(() => {
				job.controller.signal.throwIfAborted();
				return props.onImport(selected, { signal: job.controller.signal, ...(plain ? {} : { settings: recipe }) });
			}).then(receipt => {
				if (current.live && active.current === job && !job.controller.signal.aborted && receipt.outcome === 'acknowledged') props.onClose();
			}).catch(error => {
				if (current.live && active.current === job && !job.controller.signal.aborted) setFailure(message(error, props.failureLabel));
			}).finally(() => {
				if (active.current === job) { active.current = null; if (current.live) setPending(false); }
			});
		} catch (error) { setFailure(message(error, props.failureLabel)); }
	};
	return <AudioEditorDialogShell title={props.title} onClose={close}
		className="lightscaper-dialog" overlayClassName="lightscaper-dialog-backdrop"
		initialFocus="input[type=file]" closeOnOutside={false}>
		<form onSubmit={submit} data-photo-import-form>
			{(failure ?? props.error) && <p role="alert">{failure ?? props.error}</p>}
			<label>{props.filesLabel}
				<input ref={input} type="file" multiple accept="image/jpeg,image/png,image/gif,image/webp,image/bmp"
					disabled={locked} onChange={() => { setSelectedCount(input.current?.files?.length ?? 0); }} />
			</label>
			<PhotoImportOptions value={settings} onChange={setSettings} busy={locked} copy={props.copy}>
				<PhotoImportPresetControls value={settings} onChange={setSettings} busy={locked} copy={props.copy}
					readPresets={props.readPresets} applyPreset={props.applyPreset} createId={props.createId} draft={presetDraft} onDraftChange={setPresetDraft} />
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
	const descriptor = error && typeof error === 'object' ? Object.getOwnPropertyDescriptor(error, 'message') : undefined;
	return descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'string' ? descriptor.value.slice(0, 2_048) : fallback;
}
