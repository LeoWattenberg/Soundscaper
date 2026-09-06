/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAudioEditorController as createControllerRuntime } from './app.js';
import { createProjectStore as createProjectStoreRuntime } from './storage.js';
import type { EditorControllerOptions } from './types.ts';

export {
	createPlatformCapabilitiesSnapshot,
	type PlatformAdapterProbe,
	type PlatformCapabilities,
	type PlatformCapabilityProbe,
	type PlatformCapabilityScope,
	type PlatformProjectStoreProbe,
	type PlatformRuntime,
	type PlatformStorageBackend,
	type PlatformTierStatus,
} from './platform-capabilities.ts';

export type CreateEditorController = (
	root?: Element | null,
	options?: EditorControllerOptions,
) => ReturnType<typeof createControllerRuntime>;

export type CreateEditorProjectStore = typeof createProjectStoreRuntime;

/** Preserve the implementation's inferred contract through the public entry. */
export const createAudioEditorController: CreateEditorController = createControllerRuntime;
export const createEditorController = createAudioEditorController;

/** Typed public storage entry point; backend and repository details stay private. */
export const createProjectStore: CreateEditorProjectStore = createProjectStoreRuntime;
export const createEditorProjectStore = createProjectStore;
