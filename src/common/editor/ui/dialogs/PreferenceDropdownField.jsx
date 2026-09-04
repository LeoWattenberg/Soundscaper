/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef } from 'react';
import { Dropdown } from '@soundscaper/design-system/Dropdown';

/**
 * A preferences dropdown with a visible (or screen-reader-only) caption.
 *
 * The vendored Dropdown renders its trigger without an accessible name, so the
 * caption is attached to the trigger as well as to the group wrapper; without
 * it every preference dropdown reaches the accessibility gate unnamed.
 */
export default function PreferenceDropdownField({
	label,
	options,
	value,
	visuallyHiddenLabel = false,
	disabled = false,
	onChange,
}) {
	const wrapperRef = useRef(null);
	useEffect(() => {
		wrapperRef.current?.querySelector('.dropdown__trigger')?.setAttribute('aria-label', label);
	}, [label]);
	return (
		<div ref={wrapperRef} className="kw-audio-editor-preferences__field" role="group" aria-label={label}>
			<span className={visuallyHiddenLabel ? 'kw-audio-editor-sr-only' : undefined}>{label}</span>
			<Dropdown options={options} value={value} onChange={onChange} width="100%" disabled={disabled} />
		</div>
	);
}
