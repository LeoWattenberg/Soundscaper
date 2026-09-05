/* SPDX-License-Identifier: AGPL-3.0-only */

import { useMemo } from 'react';

import LocalAssistanceDialog, { type LocalAssistanceDialogProps } from './LocalAssistanceDialog.tsx';
import { resolveLocalAssistanceBridge } from '../../assistance/local-assistance-bridge.ts';

export interface LocalAssistanceDialogSurfaceProps
	extends Omit<LocalAssistanceDialogProps, 'bridge'> {
	readonly bridgeScope: unknown;
}

/** Resolve the desktop capability only after the menu-owned dialog is requested. */
export default function LocalAssistanceDialogSurface({
	bridgeScope, ...props
}: LocalAssistanceDialogSurfaceProps) {
	const bridge = useMemo(() => resolveLocalAssistanceBridge(bridgeScope), [bridgeScope]);
	return <LocalAssistanceDialog {...props} bridge={bridge} />;
}
