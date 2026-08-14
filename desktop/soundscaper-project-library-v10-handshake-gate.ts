/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createSoundscaperDesktopProjectLibraryV10Handshake,
	validateSoundscaperDesktopProjectLibraryV10Handshake,
	type SoundscaperDesktopProjectLibraryV10Handshake,
} from './soundscaper-project-library-v10-contract.ts';

export type SoundscaperDesktopProjectLibraryV10HandshakeState =
	| 'pending'
	| 'admitted'
	| 'refused';

export interface SoundscaperDesktopProjectLibraryV10HandshakeGate {
	readonly local: Readonly<SoundscaperDesktopProjectLibraryV10Handshake>;
	state(): SoundscaperDesktopProjectLibraryV10HandshakeState;
	accept(value: unknown): Readonly<SoundscaperDesktopProjectLibraryV10Handshake>;
	assertOperational(): void;
}

/** A one-shot fail-closed gate shared by main, preload, renderer, and worker adapters. */
export function createSoundscaperDesktopProjectLibraryV10HandshakeGate():
	SoundscaperDesktopProjectLibraryV10HandshakeGate {
	const local = createSoundscaperDesktopProjectLibraryV10Handshake();
	let state: SoundscaperDesktopProjectLibraryV10HandshakeState = 'pending';
	return Object.freeze({
		local,
		state: () => state,
		accept(value: unknown) {
			if (state !== 'pending') {
				throw new Error(state === 'refused'
					? 'Soundscaper desktop V10 handshake was refused.'
					: 'Soundscaper desktop V10 handshake is already settled.');
			}
			try {
				const remote = validateSoundscaperDesktopProjectLibraryV10Handshake(value);
				state = 'admitted';
				return remote;
			} catch (error) {
				state = 'refused';
				throw new TypeError('Soundscaper desktop V10 handshake was refused.', { cause: error });
			}
		},
		assertOperational() {
			if (state === 'pending') {
				throw new Error('Soundscaper desktop V10 handshake is required before operational I/O.');
			}
			if (state === 'refused') {
				throw new Error('Soundscaper desktop V10 handshake was refused.');
			}
		},
	});
}
