/* SPDX-License-Identifier: AGPL-3.0-only */

import { createContext, useContext, useLayoutEffect, useRef, type AudioHTMLAttributes } from 'react';

/** Menu-owned auditions share the editor's listening output without changing media transport. */
export const AudioEditorListeningGainContext = createContext(1);

export function AudioEditorListeningPreview(props: AudioHTMLAttributes<HTMLAudioElement>) {
	const audio = useRef<HTMLAudioElement>(null);
	const gain = useContext(AudioEditorListeningGainContext);
	const volume = Number.isFinite(gain) ? Math.max(0, Math.min(1, gain)) : 1;
	useLayoutEffect(() => {
		if (audio.current) audio.current.volume = volume;
	}, [volume]);
	return <audio {...props} ref={audio} />;
}
