/* SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ClipSourceController } from './clip-source-editor-types.ts';
import type { TimelinePcmWindow } from '../timeline/waveform-view-model.ts';
import { clipSourceWaveformModels } from './clip-source-waveform-model.ts';
import { createWaveformContentKey } from '../waveform-preview-cache.ts';

export function useClipSourceAudioWindows(options: Parameters<typeof clipSourceWaveformModels>[0],
	load: ClipSourceController['actions']['effects']['loadSourceAudioWindow'], onError: (error: unknown) => void,
) {
	const identity = JSON.stringify([createWaveformContentKey(options.source, { sourceId: options.clip.sourceId }), options.source.frameCount, options.source.sampleRate]);
	const peaks = options.visual.peaks;
	const [loaded, setLoaded] = useState<{ identity: string; peaks: unknown; windows: readonly TimelinePcmWindow[] } | null>(null);
	const plans = useMemo(() => clipSourceWaveformModels({ ...options,
		windows: loaded?.identity === identity && loaded.peaks === peaks ? loaded.windows : [] }), [options, loaded, identity, peaks]);
	const { requests } = plans;
	const clipId = options.clip.id, sourceId = options.source.id;
	const requested = useRef(requests); requested.current = requests;
	const report = useRef(onError); report.current = onError;
	const key = JSON.stringify(requests);
	useEffect(() => {
		if (!load || requested.current.length === 0) return;
		const abort = new AbortController();
		void Promise.all(requested.current.map(range => load(clipId, { ...range, signal: abort.signal }))).then(results => {
			if (abort.signal.aborted) return;
			const windows = results.filter((window): window is TimelinePcmWindow => window !== null);
			if (windows.length) setLoaded(current => ({ identity, peaks, windows: [...windows,
				...(current?.identity === identity && current.peaks === peaks ? current.windows : [])].slice(0, 6) }));
		}).catch(error => { if (!abort.signal.aborted) report.current(error); });
		return () => { abort.abort(); };
	}, [clipId, sourceId, load, key, identity, peaks]);
	return plans;
}
