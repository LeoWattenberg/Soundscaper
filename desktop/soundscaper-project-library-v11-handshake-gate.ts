/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createSoundscaperDesktopProjectLibraryV11Handshake,
	validateSoundscaperDesktopProjectLibraryV11Handshake,
	type SoundscaperDesktopProjectLibraryV11Handshake,
} from './soundscaper-project-library-v11-contract.ts';

export type SoundscaperDesktopProjectLibraryV11HandshakeState =
	| 'pending'
	| 'admitted'
	| 'refused';

export interface SoundscaperDesktopProjectLibraryV11HandshakeGate {
	readonly local: Readonly<SoundscaperDesktopProjectLibraryV11Handshake>;
	state(): SoundscaperDesktopProjectLibraryV11HandshakeState;
	accept(value: unknown): Readonly<SoundscaperDesktopProjectLibraryV11Handshake>;
	assertOperational(): void;
}

/** A one-shot fail-closed gate shared by main, preload, renderer, and worker adapters. */
export function createSoundscaperDesktopProjectLibraryV11HandshakeGate():
	SoundscaperDesktopProjectLibraryV11HandshakeGate {
	const local = createSoundscaperDesktopProjectLibraryV11Handshake();
	let state: SoundscaperDesktopProjectLibraryV11HandshakeState = 'pending';
	return Object.freeze({
		local,
		state: () => state,
		accept(value: unknown) {
			if (state !== 'pending') {
				throw new Error(state === 'refused'
					? 'Soundscaper desktop V11 handshake was refused.'
					: 'Soundscaper desktop V11 handshake is already settled.');
			}
			try {
				const remote = validateSoundscaperDesktopProjectLibraryV11Handshake(value);
				state = 'admitted';
				return remote;
			} catch (error) {
				state = 'refused';
				throw new TypeError('Soundscaper desktop V11 handshake was refused.', { cause: error });
			}
		},
		assertOperational() {
			if (state === 'pending') {
				throw new Error('Soundscaper desktop V11 handshake is required before operational I/O.');
			}
			if (state === 'refused') {
				throw new Error('Soundscaper desktop V11 handshake was refused.');
			}
		},
	});
}
