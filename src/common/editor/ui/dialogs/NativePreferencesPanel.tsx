/* SPDX-License-Identifier: AGPL-3.0-only */
import { Button } from '@soundscaper/design-system/Button';
import { Checkbox } from '@soundscaper/design-system/Checkbox';
import { PreferencePanel } from '@soundscaper/design-system/PreferencePanel';
import type { AssistanceMenuEntry } from '../assistance-task-catalog.ts';
import type { NativePreferenceEntry } from '../local-processing-menus.ts';

export default function NativePreferencesPanel({ menus, section, copy, onNavigate }: {
	readonly menus: readonly (AssistanceMenuEntry & { nativePreferences?: readonly NativePreferenceEntry[] })[];
	readonly section: string;
	readonly onNavigate: () => void;
	readonly copy: Readonly<Record<string, string>>;
}) {
	const entries: AssistanceMenuEntry[] = menus.flatMap((menu) => menu.nativePreferences ?? [])
		.filter((entry) => entry.section === section).flatMap((entry) => entry.items ?? [entry]);
	if (section === 'effects') {
		for (const menu of menus) for (const entry of menu.items ?? []) {
			if (entry.id === 'native-effect-manage' || entry.id === 'framescaper-ofx-manage') entries.push(entry);
		}
	}
	if (entries.length === 0) return null;
	return <PreferencePanel title={section === 'effects' ? copy.assistancePlugins || 'Plugins'
		: copy.assistanceDeviceProcessing || 'Device processing'}>
		<div className="kw-processing-preferences">
			{entries.map((entry) => typeof entry.checked === 'boolean'
				? <div className="kw-processing-checkbox" key={entry.id}>
					<Checkbox checked={entry.checked} aria-label={entry.label} disabled={entry.disabled === true}
						onChange={() => { void entry.onClick?.(); }} /><span>{entry.label}</span>
				</div>
				: <Button key={entry.id} variant="secondary" disabled={entry.disabled === true}
					onClick={() => { onNavigate(); queueMicrotask(() => { void entry.onClick?.(); }); }}>{entry.label}</Button>)}
		</div>
	</PreferencePanel>;
}
