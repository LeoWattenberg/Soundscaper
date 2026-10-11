/* SPDX-License-Identifier: AGPL-3.0-only */

import { createContext, useContext, useLayoutEffect, useRef, useState, type AudioHTMLAttributes } from 'react';
import { bindListeningMediaReadiness } from './listening-media-readiness.ts';

/** Menu-owned auditions share the editor's listening output without changing media transport. */
export const AudioEditorListeningGainContext = createContext(1);
export const AudioEditorListeningOutputDeviceContext = createContext('');

export function AudioEditorListeningPreview(props: AudioHTMLAttributes<HTMLAudioElement>) {
	const audio = useRef<HTMLAudioElement>(null);
	const gain = useContext(AudioEditorListeningGainContext);
	const preferredOutput = useContext(AudioEditorListeningOutputDeviceContext);
	const output = preferredOutput.startsWith('native:') ? '' : preferredOutput;
	const routing = useRef(Promise.resolve());
	const [readyOutput, setReadyOutput] = useState<string | null>(null);
	const canRouteOutput = typeof HTMLMediaElement !== 'undefined'
		&& typeof HTMLMediaElement.prototype.setSinkId === 'function';
	const volume = Number.isFinite(gain) ? Math.max(0, Math.min(1, gain)) : 1;
	const currentVolume = useRef(volume);
	useLayoutEffect(() => {
		currentVolume.current = volume;
		if (audio.current) audio.current.volume = volume;
	}, [volume]);
	useLayoutEffect(() => {
		const player = audio.current;
		if (player) return bindListeningMediaReadiness(player, () => currentVolume.current, () => audio.current === player);
	}, []);
	useLayoutEffect(() => {
		const player = audio.current;
		if (!player || typeof player.setSinkId !== 'function') return;
		let current = true;
		setReadyOutput(null);
		routing.current = routing.current.catch(() => undefined).then(async () => {
			if (!current) return;
			await player.setSinkId(output);
			if (current) setReadyOutput(output);
		}).catch(() => { if (current) player.pause(); });
		return () => { current = false; };
	}, [output]);
	return <audio {...props} controls={props.controls && (!canRouteOutput || readyOutput === output)} ref={audio} />;
}
