/* SPDX-License-Identifier: AGPL-3.0-only */

import { useId } from 'react';
import { materializeApplicationMenu } from '../application-menu-materialization.ts';
import type { AssistanceMenuEntry } from '../assistance-task-catalog.ts';
import PreferenceCheckbox from '../EditorPreferenceCheckbox.tsx';

export default function AudioProcessingPreferences({ entry }: {
	readonly entry: AssistanceMenuEntry;
}) {
	const reasonId = useId();
	const items = materializeApplicationMenu(entry).items ?? [];
	const reason = items.find((item) => typeof item.disabledReason === 'string')?.disabledReason;
	const description = typeof reason === 'string' ? reasonId : undefined;
	return <fieldset className="kw-processing-audio-preferences" aria-describedby={description}>
		<legend>{entry.label}</legend>
		{items.map((item) => {
			if (item.items?.length) {
				const options = item.items;
				return <label key={item.id} className="kw-audio-editor-preferences__field">
					<span>{item.label}</span>
					<select value={options.find((option) => option.checked === true)?.id ?? ''}
						disabled={options.every((option) => option.disabled === true)} aria-describedby={description}
						onChange={(event) => {
							const option = options.find((candidate) => candidate.id === event.currentTarget.value);
							if (option?.disabled !== true) void option?.onClick?.();
						}}>
						{options.map((option) => <option key={option.id} value={option.id}
							disabled={option.disabled === true}>{option.label}</option>)}
					</select>
				</label>;
			}
			if (typeof item.checked === 'boolean') return <PreferenceCheckbox key={item.id}
				checked={item.checked} label={item.label ?? ''} disabled={item.disabled === true}
				ariaDescribedBy={description} onChange={() => {
						if (item.disabled !== true) void item.onClick?.();
					}} />;
			return <p key={item.id}>{item.label}</p>;
		})}
		{typeof reason === 'string' && <p id={reasonId}>{reason}</p>}
	</fieldset>;
}
