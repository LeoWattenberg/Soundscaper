/* SPDX-License-Identifier: AGPL-3.0-only */

import { ProcessingButton as Button } from './ProcessingButton.tsx';
import { ProcessingSearchField } from './ProcessingSearchField.tsx';
import { Table } from '@soundscaper/design-system/Table/Table';
import { Checkbox } from '@soundscaper/design-system/Checkbox';
import PreferenceDropdownField from './PreferenceDropdownField.jsx';
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
	const [query, setQuery] = useState('');
	const [status, setStatus] = useState('all');
	const [selectedHandle, setSelectedHandle] = useState<string | null>(null);
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
	const visible = plugins.filter((plugin) => (status === 'all' || plugin.state === status)
		&& `${plugin.pluginId} ${plugin.vendor ?? ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
	const selected = visible.find((plugin) => plugin.pluginHandle === selectedHandle);
	return <>
		<div className="kw-processing-filters">
			<ProcessingSearchField value={query} onChange={setQuery} label={copy.searchPlugins} />
			<PreferenceDropdownField label={copy.pluginStatus} value={status} onChange={setStatus}
				options={[{ value: 'all', label: copy.allPluginStates },
					...[...new Set(plugins.map((plugin) => plugin.state))].map((value) => ({ value, label: value }))]} />
		</div>
		<p role="status" aria-live="polite">{message}</p>
		<Table className="kw-processing-table"><table aria-label={copy.ofxPlugins}>
			<thead><tr><th>{copy.pluginName}</th><th>{copy.pluginVendor}</th><th>{copy.pluginStatus}</th></tr></thead>
			<tbody>{visible.map((plugin) => <tr key={plugin.pluginHandle}
				data-framescaper-openfx-plugin={plugin.pluginHandle} aria-selected={plugin.pluginHandle === selectedHandle}>
				<td><Button variant="secondary" onClick={() => setSelectedHandle(plugin.pluginHandle)}>{plugin.pluginId}</Button></td>
				<td>{plugin.vendor ?? '—'}</td><td>{plugin.state}</td>
			</tr>)}</tbody>
		</table></Table>
		{visible.length === 0 && <p>{plugins.length ? copy.noMatchingPlugins : copy.ofxNoPlugins}</p>}
		{selected ? <section className="kw-processing-details" aria-label={copy.pluginDetails}>
			<h3>{selected.pluginId}</h3>
			<div className="kw-processing-actions">
				<Button variant="secondary" disabled={disabled || !usable || selected.state !== 'consented'}
					onClick={() => control(selected.pluginHandle, 'enable')}>{copy.ofxEnable}</Button>
				<Button variant="secondary" disabled={disabled || selected.state === 'revoked'}
					onClick={() => control(selected.pluginHandle, 'revoke')}>{copy.ofxRevoke}</Button>
				<Button variant="secondary" disabled={disabled || !usable || !selected.quarantined}
					onClick={() => control(selected.pluginHandle, 'clear-quarantine')}>{copy.ofxClearQuarantine}</Button>
			</div>
		</section> : visible.length > 0 && <p>{copy.choosePlugin}</p>}
		<details className="kw-processing-details">
			<summary>{copy.tabEffectScan}</summary>
			<div className="kw-processing-checkbox">
				<Checkbox checked={snapshot.preferences.ofxConsentEnabled} aria-label={copy.ofxConsent}
					disabled={disabled || !controllable} onChange={setConsent} />
				<span>{copy.ofxConsent}</span>
				{!controllable && <small>{copy.preferenceControlUnavailable}</small>}
			</div>
			<p><Button variant="secondary" disabled={disabled || !usable}
				data-framescaper-openfx-scan="true" onClick={scan}>{copy.ofxScan}</Button></p>
		</details>
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
