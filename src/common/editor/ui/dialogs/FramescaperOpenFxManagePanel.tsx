/* SPDX-License-Identifier: AGPL-3.0-only */

import React, { useCallback, useEffect, useRef, useState } from 'react';

import {
	isNativeMediaCapabilityUsable,
	nativeMediaCapabilityEntry,
	NATIVE_MEDIA_CAPABILITY_IDS,
} from '../../native-media-capability-snapshot.ts';
import {
	framescaperOpenFxPluginProjectionV1,
	type FramescaperOpenFxPluginAction,
} from '../../native-ofx-service-contract.ts';
import type { FramescaperNativeServicesBridge } from '../framescaper-native-services-bridge.ts';
import type { FramescaperNativeServicesCopy } from '../framescaper-native-services-copy.ts';
import type {
	FramescaperOpenFxPluginProjectionV1,
} from '../framescaper-native-openfx-bridge.ts';
import type { FramescaperNativeServicesRendererSnapshot } from '../framescaper-native-services-bridge.ts';

export interface FramescaperOpenFxManagePanelProps {
	readonly bridge: FramescaperNativeServicesBridge;
	readonly copy: FramescaperNativeServicesCopy;
	readonly snapshot: FramescaperNativeServicesRendererSnapshot;
	readonly busy: boolean;
	readonly setConsent: (enabled: boolean) => void;
}

export default function FramescaperOpenFxManagePanel({
	bridge, copy, snapshot, busy, setConsent,
}: FramescaperOpenFxManagePanelProps) {
	const [plugins, setPlugins] = useState<readonly FramescaperOpenFxPluginProjectionV1[]>([]);
	const [working, setWorking] = useState(false);
	const [message, setMessage] = useState('');
	const mounted = useRef(false);
	const refreshSequence = useRef(0);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			refreshSequence.current += 1;
		};
	}, []);
	const refresh = useCallback(async (): Promise<void> => {
		const sequence = ++refreshSequence.current;
		if (!bridge.listOpenFxPlugins) {
			if (mounted.current) setPlugins([]);
			return;
		}
		let next: readonly FramescaperOpenFxPluginProjectionV1[];
		try {
			next = Object.freeze((await bridge.listOpenFxPlugins()).map(
				framescaperOpenFxPluginProjectionV1,
			));
		} catch (error: unknown) {
			if (!mounted.current || sequence !== refreshSequence.current) return;
			throw error;
		}
		if (mounted.current && sequence === refreshSequence.current) setPlugins(next);
	}, [bridge]);
	useEffect(() => { void refresh().catch((error: unknown) => {
		if (mounted.current) setMessage(error instanceof Error ? error.message : String(error));
	}); }, [refresh]);
	const run = (operation: () => Promise<void>): void => {
		setWorking(true);
		setMessage('');
		void operation().then(
			() => setMessage(copy.ofxOperationComplete),
			(error: unknown) => setMessage(error instanceof Error ? error.message : String(error)),
		).finally(() => setWorking(false));
	};
	const scan = (): void => run(async () => {
		if (!bridge.scanOpenFxPlugin) throw new Error(copy.ofxRuntimeUnavailable);
		await bridge.scanOpenFxPlugin();
		await refresh();
	});
	const control = (pluginHandle: string, action: FramescaperOpenFxPluginAction): void => run(async () => {
		if (!bridge.controlOpenFxPlugin) throw new Error(copy.ofxRuntimeUnavailable);
		await bridge.controlOpenFxPlugin({ pluginHandle, action });
		await refresh();
	});
	const controllable = snapshot.controllablePreferences.includes('ofx-consent');
	const usable = ofxUsable(snapshot) && bridge.scanOpenFxPlugin !== undefined
		&& bridge.listOpenFxPlugins !== undefined && bridge.controlOpenFxPlugin !== undefined;
	const disabled = busy || working;
	return <>
		<fieldset>
			<legend>{copy.ofxManage}</legend>
			<label className="kw-audio-editor-dialog__field">
				<span>{copy.ofxConsent}</span>
				<input type="checkbox" checked={snapshot.preferences.ofxConsentEnabled}
					disabled={disabled || !controllable} data-native-service-preference="ofx-consent"
					onChange={(event) => setConsent(event.currentTarget.checked)} />
				{!controllable && <small>{copy.preferenceControlUnavailable}</small>}
			</label>
			<p><button type="button" disabled={disabled || !usable}
				data-framescaper-openfx-scan="true" onClick={scan}>{copy.ofxScan}</button></p>
		</fieldset>
		<p role="status" aria-live="polite">{message}</p>
		{plugins.length === 0 ? <p>{copy.ofxNoPlugins}</p> : <ul aria-label={copy.ofxPlugins}>
			{plugins.map((plugin) => <li key={plugin.pluginHandle}
				data-framescaper-openfx-plugin={plugin.pluginHandle}>
				<strong>{plugin.pluginId}</strong>{` — ${plugin.vendor ?? 'Vendor not reported'} — ${plugin.state}`}
				<div className="kw-audio-editor-dialog__actions">
					<button type="button" disabled={disabled || !usable || plugin.state !== 'consented'}
						onClick={() => control(plugin.pluginHandle, 'enable')}>{copy.ofxEnable}</button>
					<button type="button" disabled={disabled || plugin.state === 'revoked'}
						onClick={() => control(plugin.pluginHandle, 'revoke')}>{copy.ofxRevoke}</button>
					<button type="button" disabled={disabled || !usable || !plugin.quarantined}
						onClick={() => control(plugin.pluginHandle, 'clear-quarantine')}>{copy.ofxClearQuarantine}</button>
				</div>
			</li>)}
		</ul>}
	</>;
}

function ofxUsable(snapshot: FramescaperNativeServicesRendererSnapshot): boolean {
	if (!snapshot.preferences.nativeMediaEnabled || !snapshot.preferences.ofxConsentEnabled
		|| snapshot.capabilitySnapshot === null) return false;
	return isNativeMediaCapabilityUsable(nativeMediaCapabilityEntry(
		snapshot.capabilitySnapshot,
		NATIVE_MEDIA_CAPABILITY_IDS.ofxHost.domain,
		NATIVE_MEDIA_CAPABILITY_IDS.ofxHost.id,
	));
}
