/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	initializeEngineRuntime,
	type EngineRuntimeOptions,
} from './lifecycle.ts';
import { installEngineRuntimeMethods } from './runtime-methods.ts';
import type {
	EngineRuntimeHost,
} from './runtime-types.ts';
import type { EnginePublicApi } from './public-api.ts';
export type {
	EngineOutputDeviceState,
	EngineStateSnapshot,
} from './public-api.ts';

/** Typed public contract implemented by the focused runtime method maps. */
export type WebAudioEditorEngine = EnginePublicApi;

const WebAudioEditorEngineRuntime = class WebAudioEditorEngine {
	constructor(options: EngineRuntimeOptions = {}) {
		initializeEngineRuntime(this as unknown as EngineRuntimeHost, options);
	}
};

interface WebAudioEditorEngineConstructor {
	new(options?: EngineRuntimeOptions): WebAudioEditorEngine;
	readonly prototype: WebAudioEditorEngine;
}

installEngineRuntimeMethods(WebAudioEditorEngineRuntime.prototype);

// The implementation methods live in focused responsibility maps and are
// installed once on the prototype. This typed constructor is the single seam
// between that runtime composition and the public class contract above.
export const WebAudioEditorEngine = WebAudioEditorEngineRuntime as unknown as WebAudioEditorEngineConstructor;

export function createAudioEditorEngine(options: EngineRuntimeOptions = {}): WebAudioEditorEngine {
	return new WebAudioEditorEngine(options);
}
