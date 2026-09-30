/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createAup4Client,
	requestAup3FileHandle,
	saveAup3Result,
} from '../src/common/editor/aup4-client.js';

interface WorkerMessage {
	readonly id: string;
	readonly type: string;
	readonly args: Record<string, unknown>;
}

class FakeWorker {
	readonly messages: WorkerMessage[] = [];
	readonly listeners = new Map<string, (event: { data: Record<string, unknown> }) => void>();
	addEventListener(type: string, listener: (event: { data: Record<string, unknown> }) => void): void {
		this.listeners.set(type, listener);
	}
	removeEventListener(type: string, listener: (event: { data: Record<string, unknown> }) => void): void {
		if (this.listeners.get(type) === listener) this.listeners.delete(type);
	}
	postMessage(message: WorkerMessage): void { this.messages.push(message); }
	emit(data: Record<string, unknown>): void { this.listeners.get('message')?.({ data }); }
	terminate(): void {}
}

test('Audacity worker creation carries the requested AUP3 target generation', async () => {
	const worker = new FakeWorker();
	const client = createAup4Client({ worker });
	try {
		const creating = client.create('project-1', { targetGeneration: 'aup3' });
		const message = worker.messages.at(-1);
		assert.ok(message);
		assert.equal(message.type, 'create');
		assert.deepEqual(message.args, { projectId: 'project-1', targetGeneration: 'aup3' });
		worker.emit({ id: message.id, result: { projectId: 'project-1', targetGeneration: 'aup3' } });
		assert.deepEqual(await creating, { projectId: 'project-1', targetGeneration: 'aup3' });
	} finally {
		client.dispose();
	}
});

test('AUP3 publication preserves bytes and forces the .aup3 extension', async () => {
	let request: Record<string, unknown> | undefined;
	const saved = await saveAup3Result({
		bytes: Uint8Array.of(1, 2, 3),
		mimeType: 'application/x-audacity-project',
	}, {
		fileName: 'legacy-project.aup4',
		saveTarget: { id: 'target-1', name: 'legacy-project.aup3' },
		fileService: {
			async saveFile(value: Record<string, unknown>) {
				request = value;
				return { method: 'desktop' };
			},
		},
	});

	assert.equal(request?.purpose, 'aup3');
	assert.equal(request?.suggestedName, 'legacy-project.aup3');
	assert.equal(request?.mimeType, 'application/x-audacity-project');
	assert.deepEqual(new Uint8Array(await (request?.blob as Blob).arrayBuffer()), Uint8Array.of(1, 2, 3));
	assert.deepEqual(saved, { method: 'desktop' });
});

test('AUP3 picker advertises only the legacy project extension', async () => {
	const pickerGlobal = globalThis as typeof globalThis & {
		showSaveFilePicker?: (options: Record<string, unknown>) => Promise<unknown>;
	};
	const original = pickerGlobal.showSaveFilePicker;
	try {
		let pickerOptions: Record<string, unknown> | undefined;
		const handle = { name: 'session.aup3' };
		pickerGlobal.showSaveFilePicker = async (options) => {
			pickerOptions = options;
			return handle;
		};
		assert.equal(await requestAup3FileHandle({ fileName: 'session.aup4' }), handle);
		assert.equal(pickerOptions?.suggestedName, 'session.aup3');
		assert.deepEqual(pickerOptions?.types, [{
			description: 'Audacity 3 project',
			accept: { 'application/x-audacity-project': ['.aup3'] },
		}]);
	} finally {
		if (original === undefined) delete pickerGlobal.showSaveFilePicker;
		else pickerGlobal.showSaveFilePicker = original;
	}
});
