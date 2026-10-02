/* SPDX-License-Identifier: AGPL-3.0-only */

import { useSyncExternalStore } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import type { FileSizeWarningConfirmation } from '../../controller/shared/file-size-warning-confirmation.ts';

export default function FileSizeWarningDialog({ confirmation, copy }: Readonly<{
	confirmation: FileSizeWarningConfirmation;
	copy: Readonly<Record<string, string>>;
}>) {
	const prompt = useSyncExternalStore(confirmation.subscribe, confirmation.getSnapshot, confirmation.getSnapshot);
	if (!prompt) return null;
	return <AudioEditorDialogShell
		title={copy.fileSizeWarningTitle ?? 'Large file warning'}
		width={500}
		onClose={() => { confirmation.settle(prompt, false); }}
		dataAttributes={{ 'data-file-size-warning': true }}
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={<>
			<Button variant="secondary" onClick={() => { confirmation.settle(prompt, false); }}>{copy.cancel}</Button>
			<Button variant="primary" onClick={() => { confirmation.settle(prompt, true); }}>{copy.fileSizeWarningContinue ?? 'Continue'}</Button>
		</>} />}
	>
		<p>{(copy.fileSizeWarningSize ?? '{label} is {size}, above the recommended {threshold}.')
			.replace('{label}', prompt.label).replace('{size}', formatSize(prompt.byteLength)).replace('{threshold}', formatSize(prompt.thresholdBytes))}</p>
		<p>{copy.fileSizeWarningDescription ?? 'Continuing may use substantial memory or storage and could fail if capacity is insufficient.'}</p>
	</AudioEditorDialogShell>;
}

function formatSize(bytes: number): string {
	const units = ['bytes', 'KiB', 'MiB', 'GiB', 'TiB'];
	const index = Math.min(units.length - 1, Math.floor(Math.log(Math.max(1, bytes)) / Math.log(1024)));
	return `${Number((bytes / 1024 ** index).toFixed(1))} ${units[index]}`;
}
