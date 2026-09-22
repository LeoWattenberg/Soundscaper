/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';

import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
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
			setCopyFeedback(copy.desktopMcpCopied ?? 'Copied to clipboard.');
		} catch {
			setCopyFeedback(copy.desktopMcpCopyFailed ?? 'Could not copy to clipboard.');
		}
	};

	return <AudioEditorDialogShell
		title={copy.desktopMcpConnection ?? 'MCP connection'}
		onClose={onClose}
		width={620}
		initialFocus="dialog"
		dataAttributes={{ 'data-desktop-mcp-dialog': 'true' }}
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={<Button
			variant="primary" onClick={onClose}>{copy.close ?? 'Close'}</Button>} />}
	>
		<p>{copy.desktopMcpDisclosure ?? 'Connected local clients can read project metadata and edit the open project without confirmation for each edit. Share this token only with a client you trust.'}</p>
		<p>{copy.desktopMcpAuthorization ?? 'Connect to the endpoint with an Authorization: Bearer <token> header.'}</p>
		<p>{copy.desktopMcpCloseKeepsRunning ?? 'Closing this dialog keeps MCP running until you stop it or quit Soundscaper.'}</p>
		<p role="status" aria-live="polite">{phase === 'loading'
			? copy.desktopMcpLoading ?? 'Reading MCP connection status…'
			: status?.enabled
				? copy.desktopMcpEnabled ?? 'MCP is running for this session.'
				: copy.desktopMcpDisabled ?? 'MCP is off for this session.'}</p>
		{error && <p role="alert">{error}</p>}
		{status?.enabled && status.url && status.token && <div className="kw-desktop-mcp__credentials">
			<label>{copy.desktopMcpEndpoint ?? 'Endpoint'}
				<input readOnly value={status.url} aria-label={copy.desktopMcpEndpoint ?? 'Endpoint'} />
			</label>
			<Button variant="secondary" onClick={() => { void copyValue(status.url!); }}>
				{copy.desktopMcpCopyEndpoint ?? 'Copy endpoint'}
			</Button>
			<label>{copy.desktopMcpToken ?? 'Session token'}
				<input readOnly value={status.token} aria-label={copy.desktopMcpToken ?? 'Session token'} />
			</label>
			<Button variant="secondary" onClick={() => { void copyValue(status.token!); }}>
				{copy.desktopMcpCopyToken ?? 'Copy token'}
			</Button>
		</div>}
		{copyFeedback && <p role="status" aria-live="polite">{copyFeedback}</p>}
		<Button variant="secondary" disabled={phase !== 'ready'} onClick={() => { void toggle(); }}>
			{status?.enabled ? copy.desktopMcpStop ?? 'Stop MCP' : copy.desktopMcpStart ?? 'Start MCP'}
		</Button>
	</AudioEditorDialogShell>;
}

function errorText(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}
