/* SPDX-License-Identifier: AGPL-3.0-only */
import React, { useEffect, useRef } from 'react';
import { PreferenceThumbnail, type PreferenceThumbnailProps } from '@soundscaper/design-system/PreferenceThumbnail';

/** Localized accessible naming at the owning vendor adapter. */
export default function PreferenceChoice({ selectLabel, label, ...props }: PreferenceThumbnailProps & { selectLabel: string }) {
	const wrapperRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const button = wrapperRef.current?.querySelector<HTMLButtonElement>('.preference-thumbnail__image-button');
		if (button) button.ariaLabel = `${selectLabel}: ${label}`;
	}, [label, selectLabel]);
	return <div ref={wrapperRef}><PreferenceThumbnail label={label} {...props} /></div>;
}
