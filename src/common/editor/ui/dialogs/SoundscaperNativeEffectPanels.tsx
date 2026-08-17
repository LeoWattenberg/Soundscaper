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
		<section>
			<h3>{copy.installedPlugins}</h3>
			{entries.length === 0
				? <p>{copy.noInstalledPlugins}</p>
				: <ul>
					{entries.map((entry) => <li key={entry.entryId} data-native-plugin-entry={entry.entryId}>
						{`${entry.name} — ${entry.vendor} (${entry.format})`}
						{!entry.eligible && <span>{` — ${entry.ineligibleReason ?? ''}`}</span>}
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
