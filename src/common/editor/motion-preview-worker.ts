/* SPDX-License-Identifier: AGPL-3.0-only */

import { createMotionPreviewWorkerRuntime } from './motion-preview-worker-runtime.ts';
import type { MotionPreviewWorkerScope } from './motion-preview-worker-protocol.ts';

createMotionPreviewWorkerRuntime(globalThis as unknown as MotionPreviewWorkerScope);
