/* SPDX-License-Identifier: AGPL-3.0-only */
import { SearchField } from '@soundscaper/design-system/SearchField';

/** Supply the visible association missing from the design-system search field. */
export function ProcessingSearchField({ label, value, onChange }: {
	readonly label: string; readonly value: string; readonly onChange: (value: string) => void;
}) {
	return <label className="kw-processing-search">
		<span className="kw-audio-editor-sr-only">{label}</span>
		<SearchField value={value} onChange={onChange} placeholder={label} />
	</label>;
}
