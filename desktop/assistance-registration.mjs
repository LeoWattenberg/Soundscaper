/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Assembles the assistance subsystem and registers it on the main process.
 *
 * The composition root stays a list of registrations rather than the place
 * each subsystem's dependencies are gathered, so everything assistance needs —
 * its catalog, the licensing register it is validated against, and the speech
 * runtime adapter — is assembled here and main names the subsystem once.
 */

import { totalmem } from 'node:os';

import assistanceCatalog from '../config/local-model-catalog.json' with { type: 'json' };
import licensingMatrix from '../config/production-licensing-matrix.json' with { type: 'json' };
import { assistanceServiceFrom, registerAssistanceIpc } from './project-library-runtime/desktop/assistance-main-ipc.js';
import { createSherpaRecognizerFactory } from './project-library-runtime/desktop/assistance-sherpa-recognizer.js';
import { createSpeechRuntimeAdapter } from './project-library-runtime/desktop/assistance-speech-runtime.js';

/**
 * The service is built on first use, so a user who never opens assistance pays
 * no filesystem access, catalog validation, or runtime probe for it.
 */
export function registerAssistance({ channels, handle, sendToRenderer, app, settings }) {
	registerAssistanceIpc({
		channels,
		handle,
		sendToRenderer,
		createService: () => assistanceServiceFrom({
			userDataPath: app.getPath('userData'),
			settingsDirectory: settings.snapshot().modelsDirectory,
			catalog: assistanceCatalog,
			licensingMatrix,
			runtime: createSpeechRuntimeAdapter({ createFactory: createSherpaRecognizerFactory }),
			totalMemoryBytes: totalmem(),
		}),
	});
}
