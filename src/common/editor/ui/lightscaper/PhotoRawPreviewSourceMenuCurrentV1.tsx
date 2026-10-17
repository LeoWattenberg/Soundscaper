/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FocusEventHandler, KeyboardEventHandler, MouseEvent } from 'react';
import type { PhotoLibraryRawPreviewSourceCurrentV1 } from '../../photo-library-session-port-current-v1.ts';
import { photoRawPreviewSourceCopy } from '../../../i18n/lightscaper-photo-raw-preview-copy.ts';

interface Props {
	readonly locale: string;
	readonly source: PhotoLibraryRawPreviewSourceCurrentV1;
	readonly disabled: boolean;
	readonly onSelect: (source: PhotoLibraryRawPreviewSourceCurrentV1) => void;
	readonly closeMenu: (event: MouseEvent<HTMLButtonElement>) => boolean;
	readonly onKeyDown: KeyboardEventHandler<HTMLDetailsElement>;
	readonly onBlur: FocusEventHandler<HTMLDetailsElement>;
}

/** A culling preference is available only through the existing View menu. */
export default function PhotoRawPreviewSourceMenuCurrentV1(props: Props) {
	const copy = photoRawPreviewSourceCopy(props.locale);
	return <details className="lightscaper-photo-submenu" onKeyDown={props.onKeyDown} onBlur={props.onBlur}>
		<summary className="application-header__menu-item">{copy.menu}</summary>
		<div className="lightscaper-menu-items">
			{(['neutral-original', 'camera-embedded'] as const).map(source => <button key={source} type="button"
				disabled={props.disabled} aria-pressed={props.source === source} onClick={event => {
					if (!props.disabled && props.closeMenu(event)) props.onSelect(source);
				}}>{source === 'neutral-original' ? copy.neutral : copy.camera}</button>)}
		</div>
	</details>;
}
