/* SPDX-License-Identifier: AGPL-3.0-only */

/** Keep script storage, WAV parsing, and command publication outside editor startup. */

import type { TextToSpeechProjectPort, TextToSpeechReviewed } from '../../assistance/text-to-speech-port-contract.ts';
import type { TextToSpeechProjectDependencies } from './local-assistance-text-to-speech-project-service.ts';

export function createLazyTextToSpeechProjectPort(
	dependencies: TextToSpeechProjectDependencies,
): TextToSpeechProjectPort {
	let loaded: Promise<TextToSpeechProjectPort> | null = null;
	const implementation = (): Promise<TextToSpeechProjectPort> => {
		loaded ??= import('./local-assistance-text-to-speech-project-service.ts').then(
			({ createTextToSpeechProjectPort }) => createTextToSpeechProjectPort(dependencies),
		);
		return loaded;
	};
	return Object.freeze({
		loadInitial: async () => (await implementation()).loadInitial(),
		accept: async (reviewed: TextToSpeechReviewed) => (await implementation()).accept(reviewed),
	});
}
