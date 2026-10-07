/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useState } from 'react';
import { pffftSpectrogramRevision, subscribePffftSpectrogram } from '../../pffft-spectrogram.js';

interface RevisionStore { read(): number; subscribe(listener: (revision: number) => void): () => void; }
const SPECTROGRAM_REVISION_STORE: RevisionStore = { read: pffftSpectrogramRevision, subscribe: subscribePffftSpectrogram };

/** FFT preparation must only invalidate rows that actually paint an FFT view. */
export function useSpectrogramCanvasRevision(enabled: boolean, store: RevisionStore = SPECTROGRAM_REVISION_STORE): number {
	const [revision, setRevision] = useState(store.read);
	useEffect(() => {
		if (!enabled) return undefined;
		setRevision(store.read());
		return store.subscribe(setRevision);
	}, [enabled, store]);
	return revision;
}
