/* SPDX-License-Identifier: AGPL-3.0-only */

import { useId } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';

import { desktopDownloadUrl } from '../../desktop-download-links.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';

interface WebFileLimitDialogProps {
	readonly copy: Readonly<{
		webFileLimitTitle: string;
		webFileLimitDescription: string;
		downloadDesktopVersion: string;
		close: string;
	}>;
	readonly productId: string;
	readonly onClose: () => void;
}

/** Offer the product's desktop build when a browser load exceeds local capacity. */
export default function WebFileLimitDialog({ copy, productId, onClose }: WebFileLimitDialogProps) {
	const descriptionId = useId();
	const openDownload = (): void => {
		const opened = globalThis.open?.(desktopDownloadUrl(productId), '_blank', 'noopener,noreferrer');
		if (opened) opened.opener = null;
	};
	return <AudioEditorDialogShell
		title={copy.webFileLimitTitle}
		onClose={onClose}
		ariaDescribedBy={descriptionId}
		dataAttributes={{ 'data-web-file-limit-dialog': 'true' }}
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={<>
			<Button variant="secondary" onClick={onClose}>{copy.close}</Button>
			<Button variant="primary" onClick={openDownload}>{copy.downloadDesktopVersion}</Button>
		</>} />}
	>
		<p id={descriptionId}>{copy.webFileLimitDescription}</p>
	</AudioEditorDialogShell>;
}
