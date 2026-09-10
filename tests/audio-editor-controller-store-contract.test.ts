/* SPDX-License-Identifier: AGPL-3.0-only */

import type { createProjectStore } from '../src/common/editor/storage.js';
import type { ImportCompositionStore } from '../src/common/editor/controller/import/internal/import-composition-types.ts';
import type { RecordingCompositionStore } from '../src/common/editor/controller/recording/internal/recording-composition-types.ts';

/** Check the concrete store supplied by the root against both consumers. */
const recordingStore: (store: ReturnType<typeof createProjectStore>) => RecordingCompositionStore = store => store;
const importStore: (store: ReturnType<typeof createProjectStore>) => ImportCompositionStore = store => store;
void recordingStore;
void importStore;
