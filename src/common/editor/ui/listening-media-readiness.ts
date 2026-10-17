/* SPDX-License-Identifier: AGPL-3.0-only */

/** Native media backends can reset volume while loading a new source. */
export function bindListeningMediaReadiness(
	player: Pick<HTMLMediaElement, 'volume' | 'addEventListener'>,
	readCurrentGain: () => number,
	isCurrentPlayer: () => boolean,
): () => void {
	const listeners = new AbortController();
	let active = true;
	const restoreGain = (): void => {
		if (active && isCurrentPlayer()) player.volume = readCurrentGain();
	};
	player.addEventListener('loadedmetadata', restoreGain, { signal: listeners.signal });
	player.addEventListener('loadeddata', restoreGain, { signal: listeners.signal });
	return () => {
		active = false;
		listeners.abort();
	};
}
