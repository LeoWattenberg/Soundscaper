/* SPDX-License-Identifier: AGPL-3.0-only */
import { parentPort } from 'node:worker_threads';
import CanvasKitInit from 'canvaskit-wasm';
import { createMotionPreviewWorkerRuntime } from '../../src/common/editor/motion-preview-worker-runtime.ts';
import { createMotionPreviewRenderSession } from '../../src/common/editor/controller/composition/motion-preview-render-session.ts';
import type { MotionPreviewWorkerScope } from '../../src/common/editor/motion-preview-worker-protocol.ts';
export type MotionSustainedWorkerBackendName = 'worker-cpu';

const port = parentPort; if (!port) throw new Error('The sustained fixture requires a real worker thread.');
const events = new EventTarget();
port.on('message', (data: unknown) => events.dispatchEvent(new MessageEvent('message', { data })));
const runtime = CanvasKitInit().then(kit => ({ kit, fallbackFonts: [] }));
const scope: MotionPreviewWorkerScope = {
	postMessage(message, transfer = []) { port.postMessage(message, transfer.map(value => { if (!(value instanceof ArrayBuffer)) throw new TypeError('Only fixture buffers cross this worker.'); return value; })); },
	addEventListener(type, listener) { events.addEventListener(type, listener as EventListener); },
	removeEventListener(type, listener) { events.removeEventListener(type, listener as EventListener); },
};
createMotionPreviewWorkerRuntime(scope, options => createMotionPreviewRenderSession({ ...options, loadRuntime: () => runtime }));
