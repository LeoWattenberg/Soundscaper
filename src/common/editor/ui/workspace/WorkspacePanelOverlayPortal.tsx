/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ReactNode, ReactPortal } from 'react';
import { createPortal } from 'react-dom';

interface WorkspacePanelOverlayPortalProps {
	readonly target: Element | null | undefined;
	readonly children: ReactNode;
}

/** Let panel dialogs escape the dock's clipping and stacking context. */
export function WorkspacePanelOverlayPortal({
	target, children,
}: WorkspacePanelOverlayPortalProps): ReactPortal | null {
	return target ? createPortal(children, target) : null;
}
