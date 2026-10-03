/* SPDX-License-Identifier: AGPL-3.0-only */

import { useMemo } from 'react';
import LocalAssistanceDialog, { type LocalAssistanceDialogProps } from './LocalAssistanceDialog.tsx';
import { resolveLocalAssistanceBridge } from '../../assistance/local-assistance-bridge.ts';

export interface LocalAssistanceRuntimeDialogProps extends Omit<LocalAssistanceDialogProps, 'bridge'> {
	readonly bridgeScope: unknown;
}

/** Resolve inference capability only after the model prerequisite has admitted the task. */
export default function LocalAssistanceRuntimeDialog({ bridgeScope, ...props }: LocalAssistanceRuntimeDialogProps) {
	const bridge = useMemo(() => resolveLocalAssistanceBridge(bridgeScope), [bridgeScope]);
	return <LocalAssistanceDialog {...props} bridge={bridge} />;
}
