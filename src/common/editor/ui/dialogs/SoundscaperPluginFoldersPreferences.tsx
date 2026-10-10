/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { PreferencePanel } from '@soundscaper/design-system/PreferencePanel';
import PreferenceCheckbox from '../EditorPreferenceCheckbox.tsx';
import { ProcessingButton as Button } from './ProcessingButton.tsx';
import {
	resolveSoundscaperNativeServicesBridge,
	soundscaperNativeServicesStoreFor,
	type SoundscaperNativeServicesBridge,
} from '../soundscaper-native-services-bridge.ts';
import { resolveSoundscaperNativeServicesCopy } from '../soundscaper-native-services-copy.ts';
import { createSoundscaperNativeServicesDialogRuntime } from '../soundscaper-native-services-dialog-runtime.ts';
import {
	soundscaperNativeServicesActionKey,
	type SoundscaperNativeServicesDialogAction,
} from '../soundscaper-native-services-dialog-model.ts';
import type { SoundscaperNativeEffectPanelProps } from './SoundscaperNativeEffectPanels.tsx';

export default function SoundscaperPluginFoldersPreferences({ productId, copy }: {
	readonly productId: string;
	readonly copy: Readonly<Record<string, string | undefined>>;
}) {
	const bridge = productId === 'soundscaper' ? resolveSoundscaperNativeServicesBridge() : null;
	return bridge === null ? null : <PluginFoldersPreferences bridge={bridge} copy={copy} />;
}

function PluginFoldersPreferences({ bridge, copy: hostCopy }: {
	readonly bridge: SoundscaperNativeServicesBridge;
	readonly copy: Readonly<Record<string, string | undefined>>;
}) {
	const copy = useMemo(() => resolveSoundscaperNativeServicesCopy(hostCopy), [hostCopy]);
	const runtime = useMemo(() => createSoundscaperNativeServicesDialogRuntime(bridge), [bridge]);
	const store = soundscaperNativeServicesStoreFor(bridge);
	const tier = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
	const state = useSyncExternalStore(runtime.subscribe, runtime.getState, runtime.getState);
	useEffect(() => { void runtime.perform({ type: 'refresh' }); }, [runtime, tier?.pluginEnabled]);
	const perform = (action: SoundscaperNativeServicesDialogAction): void => { void runtime.perform(action); };
	return <PreferencePanel title={copy.pluginFolders}>
		{state.error && <p role="alert">{state.error}</p>}
		<SoundscaperPluginFoldersPanel copy={copy} state={state}
			disabled={state.pending !== null} perform={perform} />
	</PreferencePanel>;
}

export function SoundscaperPluginFoldersPanel({ copy, state, disabled, perform }: SoundscaperNativeEffectPanelProps) {
	const plugins = state.plugins;
	const removalFocus = useRef<{ button: HTMLButtonElement; group: HTMLFieldSetElement } | null>(null);
	useEffect(() => {
		if (disabled || !removalFocus.current) return;
		const { button, group } = removalFocus.current;
		removalFocus.current = null;
		if (!group.isConnected || button.ownerDocument.activeElement !== button.ownerDocument.body) return;
		const next = button.isConnected ? button : group.querySelector<HTMLButtonElement>('[data-native-plugin-add]');
		if (next && !next.disabled) next.focus();
	}, [disabled, plugins]);
	const formats = (plugins?.consent.formats ?? []).filter((format) => format.supported);
	const canScan = plugins?.enabled === true && !plugins.quarantined && plugins.payload.status === 'available';
	const folders = formats.flatMap((format) => format.roots.filter((root) => root.admitted)
		.map((root) => ({ format: format.format, rootId: root.rootId })));
	const scanning = Object.values(state.scans).some((scan) => scan.running);
	return <div className="kw-plugin-folder-preferences">
		<p>{copy.pluginFoldersHelp}</p>
		{plugins !== null && !plugins.enabled && <p>{copy.pluginScanningOff}</p>}
		{formats.map((format) => {
			const custom = format.roots.filter((root) => root.origin === 'custom' && root.admitted);
			return <fieldset key={format.format} data-native-plugin-format={format.format}>
				<legend>{format.format === 'au' ? copy.pluginFormatAudioUnits : format.format === 'vamp' ? copy.pluginFormatVamp : format.format.toUpperCase()}</legend>
				<div className="kw-plugin-folder-preferences__system">
					{format.roots.filter((root) => root.origin === 'standard').map((root) => <PreferenceCheckbox
						key={root.rootId} label={root.name} checked={root.admitted} disabled={disabled}
						onChange={(checked) => perform({ type: 'consent', format: format.format,
							consent: checked ? 'add-standard-root' : 'remove-root', rootId: root.rootId })} />)}
				</div>
				<p className="kw-plugin-folder-preferences__label">{copy.customPluginPaths}</p>
				{custom.length > 0 ? <ul className="kw-plugin-folder-preferences__paths">
					{custom.map((root) => <li key={root.rootId}>
						<span>{root.displayPath ?? root.name}</span>
						<Button disabled={disabled} aria-label={`${copy.removePluginPath}: ${root.displayPath ?? root.name}`}
							onClick={(event) => {
								const button = event.currentTarget;
								const group = button.closest('fieldset');
								if (group && button.ownerDocument.activeElement === button) removalFocus.current = { button, group };
								perform({ type: 'consent', format: format.format, consent: 'remove-root', rootId: root.rootId });
							}}>
							{copy.removePluginPath}</Button>
					</li>)}
				</ul> : <p>{copy.noCustomPluginPaths}</p>}
				<Button disabled={disabled} data-native-plugin-add aria-label={`${copy.addPluginPath}: ${format.format.toUpperCase()}`}
					onClick={() => perform({ type: 'consent', format: format.format, consent: 'add-custom-root' })}>
					{copy.addPluginPath}</Button>
			</fieldset>;
		})}
		{formats.length > 0 && <Button disabled={disabled || scanning || !canScan || folders.length === 0}
			data-native-plugin-scan="true" onClick={() => {
				for (const folder of folders) perform({ type: 'scan', ...folder });
			}}>{scanning ? copy.scanRunning : copy.scanPluginFolders}</Button>}
		{folders.map((folder) => {
			const scan = state.scans[soundscaperNativeServicesActionKey({ type: 'scan', ...folder })];
			return scan ? <p key={`${folder.format}:${folder.rootId}`} role="status" aria-live="polite">
				{`${folder.format.toUpperCase()}: ${scan.running ? copy.scanRunning
					: scan.status === 'failed' || scan.status === 'refused' ? scan.detail || scan.status
					: `${copy.scanEntries}: ${scan.entries.length}${scan.detail ? ` — ${scan.detail}` : ''}`}`}
			</p> : null;
		})}
	</div>;
}
