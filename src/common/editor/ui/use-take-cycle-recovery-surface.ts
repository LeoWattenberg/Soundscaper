/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, useState } from 'react';

interface PendingRecovery {
	readonly recoveryToken: string;
}

/** Auto-offer each exact recovery authority once while retaining menu reopen. */
export function useTakeCycleRecoverySurface(
	productId: string,
	pending: PendingRecovery | null | undefined,
) {
	const [activeSurface, setActiveSurface] = useState<string | null>(null);
	const offeredToken = useRef<string | null>(null);
	useEffect(() => {
		if (productId !== 'soundscaper' || !pending) return;
		if (offeredToken.current === pending.recoveryToken) return;
		offeredToken.current = pending.recoveryToken;
		setActiveSurface('take-cycle-recovery');
	}, [pending, productId]);
	return [activeSurface, setActiveSurface] as const;
}
