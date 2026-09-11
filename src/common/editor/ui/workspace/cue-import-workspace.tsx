/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type RefObject } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';

import type { CueImportDestination } from '../../cue-import.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';

interface CueImportController {
	readonly actions: Readonly<{ readonly labels: Readonly<{
		importCueFile(file: File, destination: CueImportDestination): unknown;
	}> }>;
}

interface PendingCueImport {
	readonly file: File;
	readonly projectIdentity: unknown;
	readonly resolve: (value: unknown) => void;
	readonly reject: (reason: unknown) => void;
}

export interface CueImportDialogRuntime {
	readonly fileName: string | null;
	readonly settle: (destination: CueImportDestination | null) => void;
}

export function useCueImportWorkspace(controller: CueImportController, projectIdentity?: unknown) {
	const importInputRef = useRef<HTMLInputElement>(null);
	const pendingRef = useRef<PendingCueImport | null>(null);
	const [fileName, setFileName] = useState<string | null>(null);
	const requestCueImport = useCallback((file: File) => new Promise<unknown>((resolve, reject) => {
		if (pendingRef.current) {
			reject(new Error('Finish choosing a destination for the current CUE sheet first.'));
			return;
		}
		pendingRef.current = { file, projectIdentity, resolve, reject };
		setFileName(file.name);
	}), [projectIdentity]);
	const settle = useCallback((destination: CueImportDestination | null) => {
		const pending = pendingRef.current;
		if (!pending) return;
		pendingRef.current = null;
		setFileName(null);
		if (destination === null) {
			pending.resolve(null);
			return;
		}
		Promise.resolve(controller.actions.labels.importCueFile(pending.file, destination))
			.then(pending.resolve, pending.reject);
	}, [controller]);
	useEffect(() => {
		const pending = pendingRef.current;
		if (!pending || Object.is(pending.projectIdentity, projectIdentity)) return;
		pendingRef.current = null;
		setFileName(null);
		pending.resolve(null);
	}, [projectIdentity]);
	useEffect(() => () => {
		pendingRef.current?.resolve(null);
		pendingRef.current = null;
	}, []);
	return { importInputRef, requestCueImport, cueImportDialog: { fileName, settle } };
}

export function WorkspaceImportInput({ accept, copy, importInputRef, importRoutedFiles, run }: Readonly<{
	accept: string;
	copy: Readonly<{ importFile: string }>;
	importInputRef: RefObject<HTMLInputElement | null>;
	importRoutedFiles(files: readonly File[]): unknown;
	run(operation: () => unknown): unknown;
}>) {
	const importFiles = (event: ChangeEvent<HTMLInputElement>) => {
		const files = [...(event.currentTarget.files ?? [])];
		event.currentTarget.value = '';
		if (files.length) run(() => importRoutedFiles(files));
	};
	return <input ref={importInputRef} className="kw-audio-editor__file-input" data-import-input aria-label={copy.importFile}
		type="file" tabIndex={-1} accept={accept} multiple onChange={importFiles} />;
}

export function CueImportDestinationDialog({ copy, runtime }: Readonly<{
	copy: Readonly<{
		cancel: string;
		importFile: string;
		labels: string;
		panelMarkers: string;
	}>;
	runtime: CueImportDialogRuntime;
}>) {
	if (runtime.fileName === null) return null;
	const settle = runtime.settle;
	return <AudioEditorDialogShell
		title={copy.importFile}
		width={480}
		onClose={() => { settle(null); }}
		dataAttributes={{ 'data-cue-import-choice': true }}
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={<>
			<Button variant="secondary" onClick={() => { settle(null); }}>{copy.cancel}</Button>
			<Button variant="secondary" onClick={() => { settle('markers'); }}>{copy.panelMarkers}</Button>
			<Button variant="primary" onClick={() => { settle('labels'); }}>{copy.labels}</Button>
		</>} />}
	>
		<p>{runtime.fileName}</p>
	</AudioEditorDialogShell>;
}
