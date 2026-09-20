/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	aup4NativeRichFixture,
	expect,
	test,
} from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseFileAction,
	chooseNestedCommandAction,
	collectClientErrors,
	trackNameText,
} from './audio-editor-test-helpers.js';

test.describe('Audacity project worker client workflows', () => {
	test('opens streamed AUP4 audio and publishes a staged snapshot through the File menu', async ({ page }) => {
		test.setTimeout(90_000);
		await installAup4BrowserProbe(page);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');

		const chooser = page.waitForEvent('filechooser');
		await chooseFileAction(page, editor, 'Open');
		await (await chooser).setFiles({
			name: 'worker-client-round-trip.aup4',
			mimeType: 'application/x-audacity-project',
			buffer: Buffer.from(aup4NativeRichFixture()),
		});
		await expect(editor.locator('[data-status]')).toContainText('Audacity project opened', { timeout: 30_000 });
		await expect(editor).toHaveAttribute('data-track-count', '2');
		await expect(editor).toHaveAttribute('data-clip-count', '5');
		await expect(trackNameText(editor)).toHaveCount(2);
		await expect.poll(() => requestTypes(page)).toContain('delete');

		const opened = await requestLog(page);
		expect(opened.slice(0, 3).map(({ type }) => type)).toEqual([
			'initialize', 'open-file', 'plan-import',
		]);
		expect(opened.filter(({ type }) => type === 'read-import-chunk').length).toBeGreaterThan(0);
		expect(opened.at(-1)?.type).toBe('delete');

		await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export AUP4']);
		await expect.poll(() => page.evaluate(() => globalThis.__aup4BrowserProbe.closeCalls)).toBe(1);
		await expect(editor.locator('[data-status]')).toContainText('Audacity interchange file exported.', { timeout: 30_000 });

		const completed = await requestLog(page);
		const exportStart = completed.findIndex(({ type }) => type === 'create');
		expect(exportStart).toBeGreaterThan(opened.length - 1);
		const exported = completed.slice(exportStart);
		for (const type of [
			'create', 'begin-snapshot', 'append-snapshot-source', 'finalize-snapshot', 'commit', 'export', 'delete',
		]) {
			expect(exported.map((entry) => entry.type)).toContain(type);
		}
		expect(exported.filter(({ type }) => type === 'append-snapshot-source'))
			.toEqual(expect.arrayContaining([expect.objectContaining({ transferCount: expect.any(Number) })]));
		expect(exported.filter(({ type }) => type === 'append-snapshot-source')
			.every(({ transferCount }) => transferCount > 0)).toBe(true);
		expect(exported.at(-1)?.type).toBe('delete');

		const publication = await page.evaluate(() => ({
			pickerOptions: globalThis.__aup4BrowserProbe.pickerOptions,
			writes: globalThis.__aup4BrowserProbe.writes,
			abortCalls: globalThis.__aup4BrowserProbe.abortCalls,
		}));
		expect(publication.pickerOptions).toHaveLength(1);
		expect(publication.pickerOptions[0]).toMatchObject({
			suggestedName: expect.stringMatching(/\.aup4$/iu),
			accept: { 'application/x-audacity-project': ['.aup4'] },
		});
		expect(publication.writes).toEqual([
			expect.objectContaining({ size: expect.any(Number), signature: 'SQLite format 3' }),
		]);
		expect(publication.writes[0].size).toBeGreaterThan(0);
		expect(publication.abortCalls).toBe(0);
		expect(errors).toEqual([]);
	});

	test('reports a corrupt AUP4 worker response and recovers through another File Open', async ({ page }) => {
		test.setTimeout(60_000);
		await installAup4BrowserProbe(page);
		const editor = await bootEditor(page, '/embed/en/');
		const originalProject = await editor.getAttribute('data-project-id');

		const brokenChooser = page.waitForEvent('filechooser');
		await chooseFileAction(page, editor, 'Open');
		await (await brokenChooser).setFiles({
			name: 'corrupt-worker-project.aup4',
			mimeType: 'application/x-audacity-project',
			buffer: Buffer.from('This is not a SQLite project.'),
		});
		const status = editor.locator('[data-status]');
		await expect(status).toHaveAttribute('data-state', 'error', { timeout: 30_000 });
		await expect(status).not.toBeEmpty();
		await expect(editor).toHaveAttribute('data-project-id', originalProject);
		await expect.poll(() => responseLog(page)).toEqual(expect.arrayContaining([
			expect.objectContaining({ requestType: 'open-file', kind: 'error' }),
		]));

		const retryChooser = page.waitForEvent('filechooser');
		await chooseFileAction(page, editor, 'Open');
		await (await retryChooser).setFiles({
			name: 'recovered-worker-project.aup4',
			mimeType: 'application/x-audacity-project',
			buffer: Buffer.from(aup4NativeRichFixture()),
		});
		await expect(status).toContainText('Audacity project opened', { timeout: 30_000 });
		await expect(editor).toHaveAttribute('data-track-count', '2');
		await expect(editor).toHaveAttribute('data-clip-count', '5');
		await expect.poll(() => requestTypes(page).then((types) => (
			types.filter((type) => type === 'delete').length
		))).toBe(2);

		const requests = await requestTypes(page);
		expect(requests.filter((type) => type === 'initialize')).toHaveLength(1);
		expect(requests.filter((type) => type === 'open-file')).toHaveLength(2);
		expect(requests.filter((type) => type === 'plan-import')).toHaveLength(1);
		expect(requests.filter((type) => type === 'read-import-chunk').length).toBeGreaterThan(0);
	});
});

async function installAup4BrowserProbe(page) {
	await page.addInitScript(() => {
		const state = {
			abortCalls: 0,
			closeCalls: 0,
			pickerOptions: [],
			requestById: {},
			requests: [],
			responses: [],
			writes: [],
		};
		Object.defineProperty(globalThis, '__aup4BrowserProbe', { configurable: true, value: state });
		const NativeWorker = globalThis.Worker;
		globalThis.Worker = class extends NativeWorker {
			constructor(url, options) {
				super(url, options);
				this.isAup4Worker = options?.name === 'kw-media-audacity-projects';
				if (!this.isAup4Worker) return;
				this.addEventListener('message', ({ data: message }) => {
					const requestType = state.requestById[message?.id] || null;
					state.responses.push({
						requestType,
						kind: message?.progress ? 'progress' : message?.error ? 'error' : 'result',
						code: message?.error?.code || null,
					});
				});
			}
			postMessage(message, ...options) {
				if (this.isAup4Worker && message?.type !== 'cancel') {
					state.requestById[message.id] = message.type;
					state.requests.push({
						type: message.type,
						projectId: message.args?.projectId || null,
						transferCount: Array.isArray(options[0]) ? options[0].length : 0,
					});
				}
				return super.postMessage(message, ...options);
			}
		};
		Object.defineProperty(globalThis, 'showSaveFilePicker', {
			configurable: true,
			value: async (options) => {
				state.pickerOptions.push({
					suggestedName: options.suggestedName,
					accept: options.types?.[0]?.accept || null,
				});
				return {
					name: options.suggestedName,
					async createWritable() {
						return {
							async write(value) {
								const blob = value instanceof Blob ? value : new Blob([value]);
								const bytes = new Uint8Array(await blob.arrayBuffer());
								state.writes.push({
									size: bytes.byteLength,
									signature: new TextDecoder().decode(bytes.subarray(0, 15)),
								});
							},
							async close() { state.closeCalls += 1; },
							async abort() { state.abortCalls += 1; },
						};
					},
				};
			},
		});
	});
}

function requestLog(page) {
	return page.evaluate(() => globalThis.__aup4BrowserProbe.requests);
}

async function requestTypes(page) {
	return (await requestLog(page)).map(({ type }) => type);
}

function responseLog(page) {
	return page.evaluate(() => globalThis.__aup4BrowserProbe.responses);
}
