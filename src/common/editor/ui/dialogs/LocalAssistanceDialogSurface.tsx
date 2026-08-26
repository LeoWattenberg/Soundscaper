/* SPDX-License-Identifier: AGPL-3.0-only */

import LocalAssistanceDialog, { type LocalAssistanceDialogProps } from './LocalAssistanceDialog.tsx';
import { resolveLocalAssistanceBridge } from '../local-assistance-bridge.ts';

export interface LocalAssistanceDialogSurfaceProps
	extends Omit<LocalAssistanceDialogProps, 'bridge'> {
	readonly bridgeScope: unknown;
}

/** Resolve the desktop capability only after the menu-owned dialog is requested. */
export default function LocalAssistanceDialogSurface({
	bridgeScope, ...props
}: LocalAssistanceDialogSurfaceProps) {
	return <LocalAssistanceDialog {...props} bridge={resolveLocalAssistanceBridge(bridgeScope)} />;
}
