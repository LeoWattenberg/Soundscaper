/* SPDX-License-Identifier: AGPL-3.0-only */

import { Button, PreferencePanel } from '@dilsonspickles/components';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
	createBrowserFfmpegRuntimeManager,
	type BrowserFfmpegRuntimeManager,
} from '../../../offline/browser-ffmpeg-runtime.ts';
import type { VerifiedRuntimeRelease } from '../../../offline/ffmpeg-runtime-cache.ts';
import './OfflineRuntimePreferencePanel.css';

interface OfflineRuntimeCopy {
	readonly offlineRuntimeTitle: string;
	readonly offlineRuntimeDescription: string;
	readonly offlineRuntimeChecking: string;
	readonly offlineRuntimeNotInstalled: string;
	readonly offlineRuntimeReady: string;
	readonly offlineRuntimeUnsupported: string;
	readonly offlineRuntimeDownloading: string;
	readonly offlineRuntimeDownload: string;
	readonly offlineRuntimeCheckUpdate: string;
	readonly offlineRuntimeRetry: string;
	readonly offlineRuntimeFailed: string;
	readonly offlineRuntimeRelease: string;
}

type PanelState =
	| Readonly<{ status: 'checking' }>
	| Readonly<{ status: 'unsupported' }>
	| Readonly<{ status: 'not-installed' }>
	| Readonly<{ status: 'installing'; completedBytes: number; totalBytes: number }>
	| Readonly<{ status: 'ready'; release: VerifiedRuntimeRelease }>
	| Readonly<{ status: 'failed'; release: VerifiedRuntimeRelease | null }>;

export interface OfflineRuntimePreferencePanelProps {
	readonly copy: OfflineRuntimeCopy;
	readonly manager?: BrowserFfmpegRuntimeManager;
}

export default function OfflineRuntimePreferencePanel({
	copy,
	manager: providedManager,
}: OfflineRuntimePreferencePanelProps) {
	const manager = useMemo(
		() => providedManager ?? createBrowserFfmpegRuntimeManager(),
		[providedManager],
	);
	const [state, setState] = useState<PanelState>({ status: 'checking' });
	const operation = useRef<AbortController | null>(null);

	useEffect(() => {
		let current = true;
		void manager.read().then((result) => {
			if (current) setState(result);
		}).catch(() => {
			if (current) setState({ status: 'unsupported' });
		});
		return () => {
			current = false;
			operation.current?.abort();
		};
	}, [manager]);

	async function install(): Promise<void> {
		const controller = new AbortController();
		operation.current?.abort();
		operation.current = controller;
		setState({ status: 'installing', completedBytes: 0, totalBytes: 0 });
		try {
			const result = await manager.install({
				signal: controller.signal,
				onProgress: ({ completedBytes, totalBytes }) => {
					if (!controller.signal.aborted) {
						setState({ status: 'installing', completedBytes, totalBytes });
					}
				},
			});
			if (!controller.signal.aborted) setState({ status: 'ready', release: result.release });
		} catch {
			if (controller.signal.aborted) return;
			let release: VerifiedRuntimeRelease | null = null;
			try {
				const retained = await manager.read();
				if (retained.status === 'ready') release = retained.release;
			} catch {
				// The generic failure state remains actionable even if status rereading fails.
			}
			setState({ status: 'failed', release });
		} finally {
			if (operation.current === controller) operation.current = null;
		}
	}

	const progress = state.status === 'installing' && state.totalBytes > 0
		? Math.min(100, Math.floor(state.completedBytes / state.totalBytes * 100))
		: 0;
	const release = state.status === 'ready' || state.status === 'failed' ? state.release : null;
	const action = state.status === 'ready'
		? copy.offlineRuntimeCheckUpdate
		: state.status === 'failed'
			? copy.offlineRuntimeRetry
			: copy.offlineRuntimeDownload;

	return (
		<PreferencePanel title={copy.offlineRuntimeTitle}>
			<div
				className="kw-audio-editor-offline-runtime"
				data-offline-ffmpeg-runtime
				data-offline-runtime-status={state.status}
			>
				<p>{copy.offlineRuntimeDescription}</p>
				<p role="status" aria-live="polite">{statusText(copy, state, progress)}</p>
				{state.status === 'installing' && (
					<progress
						aria-label={copy.offlineRuntimeDownloading.replace('{percent}', String(progress))}
						max={100}
						value={progress}
					/>
				)}
				{state.status === 'failed' && <p role="alert">{copy.offlineRuntimeFailed}</p>}
				{release && (
					<small>{copy.offlineRuntimeRelease.replace('{release}', release.releaseId.slice(0, 12))}</small>
				)}
				{!['checking', 'unsupported', 'installing'].includes(state.status) && (
					<Button variant="secondary" onClick={() => { void install(); }}>{action}</Button>
				)}
			</div>
		</PreferencePanel>
	);
}

function statusText(copy: OfflineRuntimeCopy, state: PanelState, progress: number): string {
	switch (state.status) {
		case 'checking': return copy.offlineRuntimeChecking;
		case 'unsupported': return copy.offlineRuntimeUnsupported;
		case 'not-installed': return copy.offlineRuntimeNotInstalled;
		case 'installing': return copy.offlineRuntimeDownloading.replace('{percent}', String(progress));
		case 'ready': return copy.offlineRuntimeReady;
		case 'failed': return copy.offlineRuntimeFailed;
	}
}
