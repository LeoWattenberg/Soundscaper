/* SPDX-License-Identifier: AGPL-3.0-only */

import React from 'react';

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
		<button
			type="button"
			disabled={disabled}
			data-native-plugin-consent={format.granted ? 'revoke' : 'grant'}
			onClick={() => perform({
				type: 'consent',
				format: format.format,
				consent: format.granted ? 'revoke' : 'grant',
			})}
		>{format.granted ? copy.revokeFormat : copy.grantFormat}</button>
		<button
			type="button"
			disabled={disabled || !format.granted}
			data-native-plugin-consent="add-custom-root"
			onClick={() => perform({ type: 'consent', format: format.format, consent: 'add-custom-root' })}
		>{copy.chooseFolder}</button>
	</p>;
}

function RootList({ copy, format, scans, disabled, perform }: Readonly<{
	copy: SoundscaperNativeServicesCopy;
	format: NativePluginFormatConsentView;
	scans: Readonly<Record<string, SoundscaperNativeScanState>>;
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
					? <button
						type="button"
						disabled={disabled || !format.granted || scan?.running === true}
						data-native-plugin-scan={root.rootId}
						onClick={() => perform({ type: 'scan', format: format.format, rootId: root.rootId })}
					>{scan?.running === true ? copy.scanRunning : copy.scanRoot}</button>
					: <button
						type="button"
						disabled={disabled || !format.granted}
						data-native-plugin-admit={root.rootId}
						onClick={() => perform({
							type: 'consent',
							format: format.format,
							consent: 'add-standard-root',
							rootId: root.rootId,
						})}
					>{copy.admitRoot}</button>}
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
	copy, state, disabled, perform,
}: SoundscaperNativeEffectPanelProps) {
	const entries = state.registry?.entries ?? [];
	const records = state.plugins?.quarantine.records ?? [];
	return <div className="audio-editor-soundscaper-native-manage">
		{state.pluginInstance !== null && <PluginInstanceControls
			copy={copy}
			state={state}
			disabled={disabled}
			perform={perform}
		/>}
		<section>
			<h3>{copy.installedPlugins}</h3>
			{entries.length === 0
				? <p>{copy.noInstalledPlugins}</p>
				: <ul>
					{entries.map((entry) => <li key={entry.entryId} data-native-plugin-entry={entry.entryId}>
						<p>{`${entry.name} — ${entry.vendor} (${entry.format})`}</p>
						{!entry.eligible && <p>{entry.ineligibleReason ?? ''}</p>}
						<ul>{entry.installations.map((installation) => <li
							key={installation.installationId}
							data-native-plugin-installation={installation.installationId}
						>
							<span>{installation.version}</span>
							{!installation.reviewed && <button type="button" disabled={disabled}
								data-native-plugin-review="allow"
								onClick={() => perform({
									type: 'review-plugin', installationId: installation.installationId, review: 'allow',
								})}
							>{copy.allowPluginInstallation}</button>}
							{entry.installations.length > 1 && !installation.selected && <button
								type="button"
								disabled={disabled}
								data-native-plugin-review="select"
								onClick={() => perform({
									type: 'review-plugin', installationId: installation.installationId, review: 'select',
								})}
							>{copy.selectPluginInstallation}</button>}
							<button type="button"
								disabled={disabled || !entry.eligible || state.pluginInstance !== null
									|| (entry.installations.length > 1 && !installation.selected)}
								data-native-plugin-instantiate={installation.installationId}
								onClick={() => perform({
									type: 'instantiate-plugin', installationId: installation.installationId,
								})}
							>{copy.instantiatePlugin}</button>
						</li>)}</ul>
					</li>)}
				</ul>}
		</section>
		<section>
			<h3>{copy.quarantinedPlugins}</h3>
			{records.length === 0
				? <p>{copy.noQuarantine}</p>
				: <ul>
					{records.map((record) => <QuarantineRecord
						key={record.digest}
						copy={copy}
						record={record}
						disabled={disabled}
						perform={perform}
					/>)}
				</ul>}
		</section>
	</div>;
}

function PluginInstanceControls({ copy, state, disabled, perform }: SoundscaperNativeEffectPanelProps) {
	const instance = state.pluginInstance;
	if (instance === null) return null;
	const nextGeneration = state.pluginStateGeneration + 1;
	const vendorWindow = state.pluginVendorWindow;
	return <section data-native-plugin-instance={instance.instanceId}>
		<h3>{`${instance.format} — ${instance.state}`}</h3>
		<p>{`${instance.latencySamples} latency frames`}</p>
		<button type="button" disabled={disabled} data-native-plugin-run-offline="true"
			onClick={() => perform({ type: 'run-plugin-offline', instanceId: instance.instanceId })}
		>{copy.runPluginOffline}</button>
		<button type="button" disabled={disabled} data-native-plugin-bypass={String(!instance.bypassed)}
			onClick={() => perform({
				type: 'set-plugin-bypassed', instanceId: instance.instanceId, bypassed: !instance.bypassed,
			})}
		>{instance.bypassed ? copy.enablePlugin : copy.bypassPlugin}</button>
		<button type="button" disabled={disabled} data-native-plugin-persist-state="true"
			onClick={() => perform({
				type: 'persist-plugin-state', instanceId: instance.instanceId,
				generation: nextGeneration,
			})}
		>{copy.storePluginState}</button>
		<button type="button" disabled={disabled || state.pluginStateBody === null}
			data-native-plugin-restore-state="true"
			onClick={() => { if (state.pluginStateBody !== null) perform({
				type: 'restore-plugin-state', instanceId: instance.instanceId,
				generation: nextGeneration, stateBody: state.pluginStateBody,
			}); }}
		>{copy.restorePluginState}</button>
		{vendorWindow === null
			? <button type="button" disabled={disabled} data-native-plugin-open-vendor-ui="true"
				onClick={() => perform({ type: 'open-plugin-vendor-ui', instanceId: instance.instanceId })}
			>{copy.openVendorUi}</button>
			: <button type="button" disabled={disabled} data-native-plugin-close-vendor-ui="true"
				onClick={() => perform({
					type: 'close-plugin-vendor-ui', instanceId: instance.instanceId,
					windowHandleId: vendorWindow.windowHandleId,
				})}
			>{copy.closeVendorUi}</button>}
		<button type="button" disabled={disabled} data-native-plugin-close="true"
			onClick={() => perform({ type: 'close-plugin', instanceId: instance.instanceId })}
		>{copy.closePlugin}</button>
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
		{(['rescan', 're-enable'] as const).map((clearance) => <button
			key={clearance}
			type="button"
			disabled={disabled}
			data-native-quarantine-clear={clearance}
			aria-label={`${clearance === 'rescan' ? copy.clearByRescan : copy.clearByReEnable}: ${label}`}
			onClick={() => perform({ type: 'clear-quarantine', digest: record.digest, clearance })}
		>{clearance === 'rescan' ? copy.clearByRescan : copy.clearByReEnable}</button>)}
	</li>;
}
