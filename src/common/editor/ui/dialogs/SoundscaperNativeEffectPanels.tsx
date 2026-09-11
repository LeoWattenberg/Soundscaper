/* SPDX-License-Identifier: AGPL-3.0-only */

import React, { useState } from 'react';
import { ProcessingButton as Button } from './ProcessingButton.tsx';
import { ProcessingSearchField } from './ProcessingSearchField.tsx';
import { Table } from '@soundscaper/design-system/Table/Table';
import PreferenceDropdownField from './PreferenceDropdownField.jsx';

import type {
	NativePluginFormatConsentView,
	NativePluginQuarantineRecord,
} from '../soundscaper-native-services-bridge.ts';
import type { SoundscaperNativeServicesCopy } from '../soundscaper-native-services-copy.ts';
import {
	soundscaperNativeServicesActionKey,
	type SoundscaperNativeScanState,
	type SoundscaperNativeServicesDialogAction,
	type SoundscaperNativeServicesDialogState,
} from '../soundscaper-native-services-dialog-model.ts';

export interface SoundscaperNativeEffectPanelProps {
	readonly copy: SoundscaperNativeServicesCopy;
	readonly state: SoundscaperNativeServicesDialogState;
	readonly disabled: boolean;
	readonly perform: (action: SoundscaperNativeServicesDialogAction) => void;
}

export function SoundscaperNativeEffectScanPanel({
	copy, state, disabled, perform,
}: SoundscaperNativeEffectPanelProps) {
	const plugins = state.plugins;
	const formats = plugins?.consent.formats ?? [];
	return <div className="audio-editor-soundscaper-native-scan">
		{plugins !== null && !plugins.enabled && <p>{copy.discoveryDisabled}</p>}
		{formats.map((format) => <section key={format.format} data-native-plugin-format={format.format}>
			<h3>{format.format}</h3>
			{!format.supported
				? <p>{copy.formatUnsupported}</p>
				: <FormatConsent copy={copy} format={format} disabled={disabled} perform={perform} />}
			{format.supported && <RootList
				copy={copy}
				format={format}
				scans={state.scans}
				canScan={plugins?.enabled === true && !plugins.quarantined
					&& plugins.payload.status === 'available' && plugins.consent.scanningEnabled}
				disabled={disabled}
				perform={perform}
			/>}
		</section>)}
	</div>;
}

function FormatConsent({ copy, format, disabled, perform }: Readonly<{
	copy: SoundscaperNativeServicesCopy;
	format: NativePluginFormatConsentView;
	disabled: boolean;
	perform: (action: SoundscaperNativeServicesDialogAction) => void;
}>) {
	return <p>
		<Button
			variant="secondary"
			disabled={disabled}
			data-native-plugin-consent={format.granted ? 'revoke' : 'grant'}
			onClick={() => perform({
				type: 'consent',
				format: format.format,
				consent: format.granted ? 'revoke' : 'grant',
			})}
		>{format.granted ? copy.revokeFormat : copy.grantFormat}</Button>
		<Button
			variant="secondary"
			disabled={disabled || !format.granted}
			data-native-plugin-consent="add-custom-root"
			onClick={() => perform({ type: 'consent', format: format.format, consent: 'add-custom-root' })}
		>{copy.chooseFolder}</Button>
	</p>;
}

function RootList({ copy, format, scans, disabled, canScan, perform }: Readonly<{
	copy: SoundscaperNativeServicesCopy;
	format: NativePluginFormatConsentView;
	scans: Readonly<Record<string, SoundscaperNativeScanState>>;
	canScan: boolean;
	disabled: boolean;
	perform: (action: SoundscaperNativeServicesDialogAction) => void;
}>) {
	if (!format.roots.length) return <p>{copy.noRoots}</p>;
	return <ul>
		{format.roots.map((root) => {
			const scan = scans[soundscaperNativeServicesActionKey({
				type: 'scan', format: format.format, rootId: root.rootId,
			})];
			return <li key={root.rootId} data-native-plugin-root={root.rootId}>
				<span>{root.name}</span>
				{root.admitted
					? <Button
						variant="secondary"
						disabled={disabled || !canScan || !format.granted || scan?.running === true}
						data-native-plugin-scan={root.rootId}
						onClick={() => perform({ type: 'scan', format: format.format, rootId: root.rootId })}
					>{scan?.running === true ? copy.scanRunning : copy.scanRoot}</Button>
					: <Button
						variant="secondary"
						disabled={disabled || !format.granted}
						data-native-plugin-admit={root.rootId}
						onClick={() => perform({
							type: 'consent',
							format: format.format,
							consent: 'add-standard-root',
							rootId: root.rootId,
						})}
					>{copy.admitRoot}</Button>}
				{scan && <ScanReport copy={copy} scan={scan} />}
			</li>;
		})}
	</ul>;
}

function ScanReport({ copy, scan }: Readonly<{
	copy: SoundscaperNativeServicesCopy;
	scan: SoundscaperNativeScanState;
}>) {
	return <div data-native-plugin-scan-report={scan.rootId} aria-busy={scan.running ? 'true' : undefined}>
		<p role="status" aria-live="polite">
			{scan.running ? copy.scanRunning : `${scan.status}${scan.detail ? ` — ${scan.detail}` : ''}`}
		</p>
		{scan.entries.length > 0 && <ul aria-label={copy.scanEntries}>
			{scan.entries.map((entry) => <li key={entry.stableId}>
				{`${entry.name} — ${entry.vendor} ${entry.version} (${entry.signature}, ${entry.compatibility})`}
			</li>)}
		</ul>}
	</div>;
}

export function SoundscaperNativeEffectManagePanel({
	copy, state, disabled, perform, mode = 'manage',
}: SoundscaperNativeEffectPanelProps & { readonly mode?: 'manage' | 'use' }) {
	const [query, setQuery] = useState('');
	const [format, setFormat] = useState('all');
	const [status, setStatus] = useState('all');
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const entries = state.registry?.entries ?? [];
	const visible = entries.filter((entry) => (format === 'all' || entry.format === format)
		&& (status === 'all' || (status === 'ready' ? entry.eligible : !entry.eligible))
		&& `${entry.name} ${entry.vendor}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
	const selected = visible.find((entry) => entry.entryId === selectedId);
	const records = state.plugins?.quarantine.records ?? [];
	return <div className="audio-editor-soundscaper-native-manage">
		{mode === 'use' && state.pluginInstance !== null && <PluginInstanceControls
			copy={copy} state={state} disabled={disabled} perform={perform} />}
		<div className="kw-processing-filters">
			<ProcessingSearchField value={query} onChange={setQuery} label={copy.searchPlugins} />
			<PreferenceDropdownField label={copy.pluginFormat} value={format} onChange={setFormat}
				options={[{ value: 'all', label: copy.allPluginFormats },
					...[...new Set(entries.map((entry) => entry.format))].map((value) => ({ value, label: value }))]} />
			<PreferenceDropdownField label={copy.pluginStatus} value={status} onChange={setStatus}
				options={[{ value: 'all', label: copy.allPluginStates }, { value: 'ready', label: copy.pluginReady },
					{ value: 'attention', label: copy.pluginNeedsAttention }]} />
		</div>
		<Table className="kw-processing-table"><table aria-label={copy.installedPlugins}>
			<thead><tr><th>{copy.pluginName}</th><th>{copy.pluginVendor}</th><th>{copy.pluginFormat}</th><th>{copy.pluginStatus}</th></tr></thead>
			<tbody>{visible.map((entry) => <tr key={entry.entryId} data-native-plugin-entry={entry.entryId}
				aria-selected={selectedId === entry.entryId}>
				<td><Button variant="secondary" onClick={() => setSelectedId(entry.entryId)}>{entry.name}</Button></td>
				<td>{entry.vendor}</td><td>{entry.format}</td>
				<td>{entry.eligible ? copy.pluginReady : copy.pluginNeedsAttention}</td>
			</tr>)}</tbody>
		</table></Table>
		{visible.length === 0 && <p role="status">{entries.length ? copy.noMatchingPlugins : copy.noInstalledPlugins}</p>}
		{selected ? <section className="kw-processing-details" aria-label={copy.pluginDetails}>
			<h3>{selected.name}</h3>
			{!selected.eligible && <p role="status">{selected.ineligibleReason || copy.pluginNeedsAttention}</p>}
			<ul className="kw-processing-list">{selected.installations.map((installation) => <li
				key={installation.installationId} data-native-plugin-installation={installation.installationId}>
				<strong>{installation.version}</strong>
				<div className="kw-processing-actions">
				{mode === 'manage' ? <>
					<Button variant="secondary" disabled={disabled} data-native-plugin-review={installation.reviewed ? 'revoke' : 'allow'}
						onClick={() => perform({ type: 'review-plugin', installationId: installation.installationId,
							review: installation.reviewed ? 'revoke' : 'allow' })}>
						{installation.reviewed ? copy.revokePluginInstallation : copy.allowPluginInstallation}</Button>
					{selected.installations.length > 1 && !installation.selected && <Button variant="secondary"
						disabled={disabled} data-native-plugin-review="select" onClick={() => perform({
							type: 'review-plugin', installationId: installation.installationId, review: 'select',
						})}>{copy.selectPluginInstallation}</Button>}
				</> : <Button variant="primary"
					disabled={disabled || !selected.eligible || state.pluginInstance !== null
						|| (selected.installations.length > 1 && !installation.selected)}
					data-native-plugin-instantiate={installation.installationId}
					onClick={() => perform({ type: 'instantiate-plugin', installationId: installation.installationId })}>
					{copy.instantiatePlugin}</Button>}
				</div>
			</li>)}</ul>
		</section> : visible.length > 0 && <p>{copy.choosePlugin}</p>}
		{mode === 'manage' && <details className="kw-processing-details" open={records.length > 0}>
			<summary>{copy.quarantinedPlugins}</summary>
			{records.length === 0 ? <p>{copy.noQuarantine}</p> : <ul className="kw-processing-list">
				{records.map((record) => <QuarantineRecord key={record.digest}
					copy={copy} record={record} disabled={disabled} perform={perform} />)}
			</ul>}
		</details>}
	</div>;
}

function PluginInstanceControls({ copy, state, disabled, perform }: SoundscaperNativeEffectPanelProps) {
	const instance = state.pluginInstance;
	if (instance === null) return null;
	const nextGeneration = state.pluginStateGeneration + 1;
	const vendorWindow = state.pluginVendorWindow;
	return <section data-native-plugin-instance={instance.instanceId}>
		<h3>{`${instance.format} — ${instance.state}`}</h3>
		<details className="kw-processing-details"><summary>{copy.pluginOfflineDetails}</summary>
		<p>{`${instance.latencySamples} latency frames`}</p>
		<Button variant="secondary" disabled={disabled} data-native-plugin-run-offline="true"
			onClick={() => perform({ type: 'run-plugin-offline', instanceId: instance.instanceId })}
		>{copy.runPluginOffline}</Button></details>
		<Button variant="secondary" disabled={disabled} data-native-plugin-bypass={String(!instance.bypassed)}
			onClick={() => perform({
				type: 'set-plugin-bypassed', instanceId: instance.instanceId, bypassed: !instance.bypassed,
			})}
		>{instance.bypassed ? copy.enablePlugin : copy.bypassPlugin}</Button>
		<Button variant="secondary" disabled={disabled} data-native-plugin-persist-state="true"
			onClick={() => perform({
				type: 'persist-plugin-state', instanceId: instance.instanceId,
				generation: nextGeneration,
			})}
		>{copy.storePluginState}</Button>
		<Button variant="secondary" disabled={disabled || state.pluginStateBody === null}
			data-native-plugin-restore-state="true"
			onClick={() => { if (state.pluginStateBody !== null) perform({
				type: 'restore-plugin-state', instanceId: instance.instanceId,
				generation: nextGeneration, stateBody: state.pluginStateBody,
			}); }}
		>{copy.restorePluginState}</Button>
		{vendorWindow === null
			? <Button variant="secondary" disabled={disabled} data-native-plugin-open-vendor-ui="true"
				onClick={() => perform({ type: 'open-plugin-vendor-ui', instanceId: instance.instanceId })}
			>{copy.openVendorUi}</Button>
			: <Button variant="secondary" disabled={disabled} data-native-plugin-close-vendor-ui="true"
				onClick={() => perform({
					type: 'close-plugin-vendor-ui', instanceId: instance.instanceId,
					windowHandleId: vendorWindow.windowHandleId,
				})}
			>{copy.closeVendorUi}</Button>}
		<Button variant="secondary" disabled={disabled} data-native-plugin-close="true"
			onClick={() => perform({ type: 'close-plugin', instanceId: instance.instanceId })}
		>{copy.closePlugin}</Button>
		{state.pluginOffline !== null && <p>{`${state.pluginOffline.blocksRendered} blocks rendered`}</p>}
	</section>;
}

function QuarantineRecord({ copy, record, disabled, perform }: Readonly<{
	copy: SoundscaperNativeServicesCopy;
	record: NativePluginQuarantineRecord;
	disabled: boolean;
	perform: (action: SoundscaperNativeServicesDialogAction) => void;
}>) {
	const label = `${record.scope} — ${record.kind} — ${record.digest.slice(0, 12)}`;
	return <li data-native-quarantine-digest={record.digest}>
		<span>{label}</span>
		{(['rescan', 're-enable'] as const).map((clearance) => <Button
			key={clearance}
			variant="secondary"
			disabled={disabled}
			data-native-quarantine-clear={clearance}
			aria-label={`${clearance === 'rescan' ? copy.clearByRescan : copy.clearByReEnable}: ${label}`}
			onClick={() => perform({ type: 'clear-quarantine', digest: record.digest, clearance })}
		>{clearance === 'rescan' ? copy.clearByRescan : copy.clearByReEnable}</Button>)}
	</li>;
}
