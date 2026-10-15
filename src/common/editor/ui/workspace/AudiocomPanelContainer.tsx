/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import { audiocomCopy } from '../../../i18n/audiocom-copy.ts';
import {
	createAudiocomPanelSession,
	audiocomPanelSession,
	type AudiocomPanelSession,
} from '../../controller/import/audiocom-panel-session.ts';
import AudiocomPanel from './AudiocomPanel.tsx';

export interface AudiocomPanelContainerProps {
	readonly controller?: object;
	readonly snapshot: Readonly<Record<string, unknown>>;
	readonly copy: Readonly<Record<string, string>>;
	readonly locale?: unknown;
	readonly disabled?: boolean;
	readonly blocked?: boolean;
	readonly panelActive?: boolean;
	readonly session?: AudiocomPanelSession;
}

export default function AudiocomPanelContainer({
	controller, snapshot, copy, locale, disabled = false, panelActive = true, session: providedSession,
}: AudiocomPanelContainerProps) {
	const session = useMemo(() => providedSession ?? (controller ? audiocomPanelSession(controller) : createAudiocomPanelSession()),
		[controller, providedSession]);
	const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
	const localizedCopy = useMemo(() => audiocomCopy(locale ?? snapshot.locale, copy), [copy, locale, snapshot.locale]);
	const [linkError, setLinkError] = useState('');
	const openLink = useCallback((url: string) => {
		setLinkError('');
		void Promise.resolve().then(async () => {
			const bridge = (globalThis as typeof globalThis & {
				soundscaperDesktop?: { v1?: { openAudiocomLink?: (url: string) => Promise<unknown> } };
			}).soundscaperDesktop?.v1;
			if (!bridge?.openAudiocomLink) throw new Error(localizedCopy.openLinkError);
			await bridge.openAudiocomLink(url);
		}).catch((reason: unknown) => setLinkError(reason instanceof Error ? reason.message : localizedCopy.openLinkError));
	}, [localizedCopy.openLinkError]);
	const devices = record(snapshot.audioDevices);
	const outputDevice = typeof devices?.preferredOutputDeviceId === 'string'
		&& !devices.preferredOutputDeviceId.startsWith('native:') ? devices.preferredOutputDeviceId : '';
	const gain = Number(devices?.playbackGain ?? 1);
	useEffect(() => {
		void session.initialize();
		return () => {
			if (controller && !providedSession) session.setActive(false);
			else session.dispose();
		};
	}, [controller, providedSession, session]);
	useEffect(() => session.setActive(panelActive), [panelActive, session]);
	useEffect(() => session.setListeningPreferences(gain, outputDevice), [gain, outputDevice, session]);
	return <AudiocomPanel copy={localizedCopy} state={state} disabled={disabled} linkError={linkError}
		onOpenLink={globalThis.location?.protocol === 'soundscaper-app:' ? openLink : undefined}
		onSearch={(request) => { void session.search(request); }}
		onPreview={(id) => { void session.preview(id); }} onStopPreview={session.stopPreview}
		onConnect={() => { void session.connect(); }} onDisconnect={() => { void session.disconnect(); }}
		onUploadFiles={(files) => { session.enqueueFiles(files); }} onPublish={session.publish}
		onRetry={session.retry} onCancel={session.cancel} onRemove={session.remove} />;
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : null;
}
