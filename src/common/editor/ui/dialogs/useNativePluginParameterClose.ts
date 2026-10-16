/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef } from 'react';
import { pendingNativePluginParameterWrites } from '../native-plugin-parameter-write-drain.ts';

export function useNativePluginParameterClose(instanceId: string | null, onClose: () => void): () => void {
	const lifetime = useRef(0);
	const closing = useRef<Promise<void> | null>(null);
	const close = useRef(onClose);
	close.current = onClose;
	useEffect(() => {
		lifetime.current += 1;
		closing.current = null;
		return () => { lifetime.current += 1; };
	}, [instanceId]);
	return () => {
		if (closing.current) return;
		const operation = instanceId ? pendingNativePluginParameterWrites(instanceId) : null;
		if (!operation) return close.current();
		const current = lifetime.current;
		closing.current = operation;
		void operation.then(() => {
			if (lifetime.current !== current) return;
			closing.current = null;
			close.current();
		}, () => { if (lifetime.current === current) closing.current = null; });
	};
}
