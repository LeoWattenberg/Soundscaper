/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

const assetLoader = `
	export async function resolve(specifier, context, nextResolve) {
		if (specifier === '@ffmpeg/core?url' || specifier === '@ffmpeg/core/wasm?url') {
			return {
				url: 'data:text/javascript,export default "mock-ffmpeg-asset"',
				shortCircuit: true,
			};
		}
		return nextResolve(specifier, context);
	}
`;

register(`data:text/javascript,${encodeURIComponent(assetLoader)}`, import.meta.url);

const { createAudioEditorController } = await import('../src/common/editor/app.js');

function deferred<Value>() {
	let resolve: (value: Value | PromiseLike<Value>) => void = () => undefined;
	const promise = new Promise<Value>((complete) => { resolve = complete; });
	return { promise, resolve };
}

test('public Scape inspection is lifetime-owned and closes its reader on disposal', async () => {
	const started = deferred<void>();
	let closeCalls = 0;
	let inspectionSignal: AbortSignal | undefined;
	const controller = createAudioEditorController(null, {
		headless: true,
		locale: 'en',
		engine: createTestEngine(),
		ffmpeg: { dispose() {} },
	});

	try {
		await controller.ready;
		const inspect = controller.actions.project.inspectScape;
		if (typeof inspect !== 'function') throw new TypeError('Scape inspection must be callable.');
		const pending = inspect(new Blob(['synthetic archive']), {
			archiveReaderFactory: (_input: Blob, signal?: AbortSignal) => {
				assert.ok(signal);
				inspectionSignal = signal;
				return {
					async *getEntriesGenerator() {
						started.resolve();
						await new Promise<void>((_resolve, reject) => {
							if (signal.aborted) reject(signal.reason);
							else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
						});
						return false;
					},
					async close() { closeCalls += 1; },
				};
			},
		});
		await started.promise;

		const disposing = controller.dispose();
		await assert.rejects(pending, (error) => (
			error === inspectionSignal?.reason
			&& (error as Readonly<{ code?: string }>).code === 'DISPOSED'
		));
		await disposing;
		assert.equal(closeCalls, 1);
	} finally {
		await controller.dispose().catch(() => undefined);
	}
});

function createTestEngine() {
	return {
		setSourceResolver() { return this; },
		loadProject() {},
		async applyProject() {},
		getState() { return { state: 'stopped', loop: { enabled: false } }; },
		getPositionFrames() { return 0; },
		stop() {},
		async dispose() {},
	};
}
