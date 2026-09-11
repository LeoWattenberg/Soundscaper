/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useState, useSyncExternalStore } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';

import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import type { MonoConversionConfirmation } from './mono-conversion-confirmation.ts';

interface MonoConversionConfirmationCopy {
	readonly cancel: string;
	readonly monoConversionDontShowAgain: string;
	readonly monoConversionYes: string;
}

export interface MonoConversionConfirmationDialogProps {
	readonly confirmation: MonoConversionConfirmation;
	readonly copy: MonoConversionConfirmationCopy;
}

/** Render the Audacity warning only while a paste is awaiting a decision. */
export default function MonoConversionConfirmationDialog({
	confirmation,
	copy,
}: MonoConversionConfirmationDialogProps) {
	const prompt = useSyncExternalStore(
		confirmation.subscribe,
		confirmation.getSnapshot,
		confirmation.getSnapshot,
	);
	const [dontShowAgain, setDontShowAgain] = useState(false);
	useEffect(() => { setDontShowAgain(false); }, [prompt?.requestId]);
	if (!prompt) return null;
	const settle = (accepted: boolean): void => {
		confirmation.settle(prompt, { accepted, dontShowAgain: accepted && dontShowAgain });
	};
	return <AudioEditorDialogShell
		title={prompt.title}
		width={500}
		onClose={() => { settle(false); }}
		dataAttributes={{ 'data-mono-conversion-confirmation': true }}
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={<>
			<Button variant="secondary" onClick={() => { settle(false); }}>{copy.cancel}</Button>
			<Button variant="primary" onClick={() => { settle(true); }}>{copy.monoConversionYes}</Button>
		</>} />}
	>
		<p>{prompt.body}</p>
		<label>
			<input
				type="checkbox"
				checked={dontShowAgain}
				onChange={(event) => { setDontShowAgain(event.currentTarget.checked); }}
			/>{' '}{copy.monoConversionDontShowAgain}
		</label>
	</AudioEditorDialogShell>;
}
