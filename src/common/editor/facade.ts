/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAudioEditorController as createControllerRuntime } from './app.js';
import { createProjectStore as createProjectStoreRuntime } from './storage.js';
import type {
	EditorController,
	EditorControllerOptions,
	EditorProjectStore,
} from './types.ts';

export type CreateEditorController = (
	root?: Element | null,
	options?: EditorControllerOptions,
) => EditorController;

export type CreateEditorProjectStore = (
	options?: Readonly<Record<string, unknown>>,
) => EditorProjectStore;

/** Typed public controller entry point; implementation details stay in app.js. */
export const createAudioEditorController = createControllerRuntime as CreateEditorController;
export const createEditorController = createAudioEditorController;

/** Typed public storage entry point; backend and repository details stay private. */
export const createProjectStore = createProjectStoreRuntime as CreateEditorProjectStore;
export const createEditorProjectStore = createProjectStore;
