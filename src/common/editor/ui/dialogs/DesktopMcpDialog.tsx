/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';

import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { resolveDesktopMcpCopy } from '../desktop-mcp-copy.ts';
import './DesktopMcpDialog.css';

export interface DesktopMcpStatus {
	readonly enabled: boolean;
	readonly url: string | null;
	readonly token: string | null;
}

export interface DesktopMcpFileService {
	readMcpStatus(): Promise<DesktopMcpStatus>;
	startMcp(): Promise<DesktopMcpStatus>;
	stopMcp(): Promise<DesktopMcpStatus>;
}

type Copy = Readonly<Record<string, string | undefined>>;
type Phase = 'loading' | 'ready' | 'working';

export default function DesktopMcpDialog({ copy, fileService, onClose }: {
	readonly copy: Copy;
	readonly fileService: DesktopMcpFileService;
	readonly onClose: () => void;
}) {
	const mcpCopy = resolveDesktopMcpCopy(copy);
	const [status, setStatus] = useState<DesktopMcpStatus | null>(null);
	const [phase, setPhase] = useState<Phase>('loading');
	const [error, setError] = useState<string | null>(null);
	const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
	const busy = useRef(false);

	useEffect(() => {
		let mounted = true;
		void fileService.readMcpStatus().then((next) => {
			if (mounted) {
				setStatus(next);
				setPhase('ready');
			}
		}).catch((cause: unknown) => {
			if (mounted) {
				setError(errorText(cause));
				setPhase('ready');
			}
		});
		return () => { mounted = false; };
	}, [fileService]);

	const toggle = async (): Promise<void> => {
		if (busy.current) return;
		busy.current = true;
		setPhase('working');
		setError(null);
		setCopyFeedback(null);
		try {
			setStatus(await (status?.enabled ? fileService.stopMcp() : fileService.startMcp()));
		} catch (cause) {
			setError(errorText(cause));
		} finally {
			busy.current = false;
			setPhase('ready');
		}
	};

	const copyValue = async (value: string): Promise<void> => {
		try {
			await globalThis.navigator.clipboard.writeText(value);
			setCopyFeedback(mcpCopy.copied);
		} catch {
			setCopyFeedback(mcpCopy.copyFailed);
		}
	};

	return <AudioEditorDialogShell
		title={mcpCopy.connection}
		onClose={onClose}
		width={620}
		initialFocus="dialog"
		dataAttributes={{ 'data-desktop-mcp-dialog': 'true' }}
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={<Button
			variant="primary" onClick={onClose}>{copy.close ?? 'Close'}</Button>} />}
	>
		<p>{mcpCopy.disclosure}</p>
		<p>{mcpCopy.authorization}</p>
		<p>{mcpCopy.closeKeepsRunning}</p>
		<p role="status" aria-live="polite">{phase === 'loading'
			? mcpCopy.loading
			: status?.enabled
				? mcpCopy.enabled
				: mcpCopy.disabled}</p>
		{error && <p role="alert">{error}</p>}
		{status?.enabled && status.url && status.token && <div className="kw-desktop-mcp__credentials">
			<label>{mcpCopy.endpoint}
				<input readOnly value={status.url} aria-label={mcpCopy.endpoint} />
			</label>
			<Button variant="secondary" onClick={() => { void copyValue(status.url!); }}>
				{mcpCopy.copyEndpoint}
			</Button>
			<label>{mcpCopy.token}
				<input readOnly value={status.token} aria-label={mcpCopy.token} />
			</label>
			<Button variant="secondary" onClick={() => { void copyValue(status.token!); }}>
				{mcpCopy.copyToken}
			</Button>
		</div>}
		{copyFeedback && <p role="status" aria-live="polite">{copyFeedback}</p>}
		<Button variant="secondary" disabled={phase !== 'ready'} onClick={() => { void toggle(); }}>
			{status?.enabled ? mcpCopy.stop : mcpCopy.start}
		</Button>
	</AudioEditorDialogShell>;
}

function errorText(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}
