/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { reactProps } from './helpers/react-test-dom.ts';
import { remainsPending, settle, waitFor } from './helpers/async-test-control.ts';
import { assertSingleExportPixels, withSingleExportQueue, withMountedSingleExportQueue } from './helpers/lightscaper-single-export-queue-fixture.tsx';

for (const format of ['png', 'jpeg'] as const) {
	test(`${format} Hide/reopen retains the real active owner and calls its picker, renderer and encoder once`, async () => {
		await withSingleExportQueue(format, async f => {
			const write = f.hold('write');
			await withMountedSingleExportQueue(f, async m => {
				await m.ready(); const save = reactProps(m.dom.one(`[data-photo-${format}-export-save]`)).onClick; assert.ok(save);
				await act(async () => { save({}); assert.equal(f.pickers, 1, 'Picker begins in the Save gesture.'); save({}); });
				await write.entered.promise; assert.equal(f.renders, 1); const selectedReads = f.reads;
				await m.hide(); assert.equal(m.dom.find(`[data-photo-${format}-export-dialog]`), null, 'Only presentation is hidden.');
				assert.equal(f.events.includes('abort'), false); assert.equal(f.closed, 0);
				await m.reopen(); assert.equal(f.reads, selectedReads, 'Reopen does not construct a replacement owner.');
				assert.equal(f.pickers, 1); assert.equal(f.renders, 1); assert.equal(f.events.includes('abort'), false);
				await m.hide(); await act(async () => { write.release.resolve(); await waitFor(() => f.events.includes('commit-ack'), 'native destination ACK'); });
				await m.reopen(); await act(async () => { await settle(); });
				assert.equal(m.dom.one(`[data-photo-${format}-export-receipt]`).getAttribute(`data-photo-${format}-export-status`), 'saved');
				assertSingleExportPixels(f); assert.equal(f.pickers, 1); assert.equal(f.renders, 1); assert.equal(f.closed, 0);
			});
		});
	});

	test(`${format} managed Hide is offered separately from explicit cancellation`, async () => {
		await withSingleExportQueue(format, async f => {
			await withMountedSingleExportQueue(f, async m => {
				await m.ready(); assert.ok(m.dom.find(`[data-photo-${format}-export-hide]`), 'Managed export must have a Hide action.');
				await m.event(`[data-photo-${format}-export-hide]`, 'onClick'); await m.render();
				assert.equal(f.hidden, 1); assert.equal(f.closed, 0); assert.equal(m.dom.find(`[data-photo-${format}-export-dialog]`), null);
				await m.reopen(); await m.ready(); assert.equal(f.reads, 1); assert.equal(f.pickers, 0);
			});
		});
	});

	test(`${format} generation retirement joins the hidden native write and its independent abort ACK`, async () => {
		await withSingleExportQueue(format, async f => {
			const write = f.hold('write'), abort = f.hold('abort');
			await withMountedSingleExportQueue(f, async m => {
				await m.ready(); const stale = reactProps(m.dom.one(`[data-photo-${format}-export-save]`)).onClick;
				await m.event(`[data-photo-${format}-export-save]`, 'onClick'); await write.entered.promise;
				await m.hide(); assert.equal(f.events.includes('abort'), false); const retired = f.destinations.retireAndJoin();
				assert.equal(await remainsPending(retired), true); await abort.entered.promise;
				// The native abort listener may run immediately; either held operation must still be joined.
				await act(async () => { if (format === 'png') write.release.resolve(); else abort.release.resolve(); await settle(); });
				assert.equal(await remainsPending(retired), true); assert.equal(f.events.includes('commit-ack'), false);
				assert.equal(f.events.includes(format === 'png' ? 'abort-ack' : 'write-released'), false);
				await act(async () => { write.release.resolve(); abort.release.resolve(); await retired; });
				assert.equal(f.events.includes('abort-ack'), true); assert.equal(f.events.includes('commit'), false);
				await act(async () => { stale?.({}); }); assert.equal(f.pickers, 1); assert.equal(m.dom.find(`[data-photo-${format}-export-dialog]`), null);
			});
		});
	});

	test(`${format} irreversible destination ACK survives hidden retirement during actual commit`, async () => {
		await withSingleExportQueue(format, async f => {
			const commit = f.hold('commit');
			await withMountedSingleExportQueue(f, async m => {
				await m.ready(); await m.event(`[data-photo-${format}-export-save]`, 'onClick'); await commit.entered.promise;
				await m.hide(); const retired = f.destinations.retireAndJoin(); assert.equal(await remainsPending(retired), true);
				assert.equal(f.events.includes('abort'), false);
				await act(async () => { commit.release.resolve(); await retired; await settle(); });
				// A retired generation cannot reopen/register presentation; read its real irreversible ACK instead.
				assert.equal(m.dom.find(`[data-photo-${format}-export-dialog]`), null); assert.equal(f.preparedSaves.length, 1);
				assert.deepEqual(f.preparedSaves[0]!.savedFile(), { method: 'file-system-access', fileName: format === 'png' ? 'Queue original.png' : 'Queue original.jpg', size: f.outputs[0]!.byteLength });
				assertSingleExportPixels(f); assert.equal(f.pickers, 1); assert.equal(f.renders, 1); assert.equal(f.events.includes('abort'), false);
			});
		});
	});

	test(`${format} stale Close captured before Hide cannot cancel hidden work; current Close still joins`, async () => {
		await withSingleExportQueue(format, async f => {
			const write = f.hold('write'), abort = f.hold('abort');
			await withMountedSingleExportQueue(f, async m => {
				await m.ready(); const close = reactProps(m.dom.one(`[data-photo-${format}-export-close]`)).onClick; assert.ok(close);
				await m.event(`[data-photo-${format}-export-save]`, 'onClick'); await write.entered.promise; await m.hide();
				await act(async () => { close({}); await settle(); }); assert.equal(f.closed, 0);
				assert.equal(f.events.includes('abort'), false); await m.reopen();
				await m.event(`[data-photo-${format}-export-close]`, 'onClick'); assert.equal(f.closed, 0);
				await act(async () => { write.release.resolve(); await abort.entered.promise; }); assert.equal(f.closed, 0);
				await act(async () => { abort.release.resolve(); await waitFor(() => f.closed === 1, 'current explicit Close after native abort'); });
				assert.equal(f.events.includes('commit'), false); assert.equal(f.pickers, 1);
			});
		});
	});
}

test('stale Save from a hidden presentation cannot obtain a destination, including after reopen', async () => {
	await withSingleExportQueue('png', async f => {
		await withMountedSingleExportQueue(f, async m => {
			await m.ready(); const save = reactProps(m.dom.one('[data-photo-png-export-save]')).onClick; assert.ok(save);
			await m.hide(); await act(async () => { save({}); await settle(); }); assert.equal(f.pickers, 0); assert.equal(f.renders, 0);
			await m.reopen(); await act(async () => { save({}); await settle(); }); assert.equal(f.pickers, 0);
			await m.event('[data-photo-png-export-save]', 'onClick'); await act(async () => { await waitFor(() => f.events.includes('commit-ack'), 'current Save'); });
			assert.equal(f.pickers, 1); assertSingleExportPixels(f);
		});
	});
});

test('hidden partial JSON retains the native image ACK and retries only JSON from the current presentation', async () => {
	await withSingleExportQueue('png', async f => {
		const json = f.hold('json'), reason = Symbol('opaque JSON refusal'); f.setJsonFailure(reason);
		await withMountedSingleExportQueue(f, async m => {
			await m.ready(); await m.event('[data-photo-raster-export-sidecar]', 'onChange', { target: { checked: true } });
			await m.event('[data-photo-png-export-save]', 'onClick'); await json.entered.promise;
			assert.equal(f.events.includes('commit-ack'), true); await m.hide();
			await act(async () => { json.release.resolve(); await settle(); }); await m.reopen();
			assert.equal(m.dom.one('[data-photo-png-export-receipt]').getAttribute('data-photo-png-export-status'), 'saved');
			assert.ok(m.dom.one('[data-photo-raster-export-sidecar-partial]')); assert.equal(f.jsonAttempts, 1); assert.equal(f.json.length, 0);
			const retry = reactProps(m.dom.one('[data-photo-raster-export-sidecar-retry]')).onClick; assert.ok(retry);
			await m.hide(); f.clearJsonFailure(); await act(async () => { retry({}); await settle(); }); assert.equal(f.jsonAttempts, 1);
			await m.reopen(); await act(async () => { retry({}); await settle(); }); assert.equal(f.jsonAttempts, 1);
			await m.event('[data-photo-raster-export-sidecar-retry]', 'onClick');
			await act(async () => { await waitFor(() => m.dom.find('[data-photo-raster-export-sidecar-receipt]') !== null, 'JSON-only retry receipt'); });
			assert.equal(f.jsonAttempts, 2); assert.equal(f.json.length, 1); assert.equal(f.captures, 1); assert.equal(f.pickers, 1); assert.equal(f.renders, 1);
			assert.match(f.json[0]!, new RegExp(f.photo.id)); assertSingleExportPixels(f);
		});
	});
});

test('a preset read begun before Hide cannot replace the owner after its held result arrives', async () => {
	await withSingleExportQueue('png', async f => {
		const preset = f.hold('preset');
		await withMountedSingleExportQueue(f, async m => {
			await m.ready(); await m.event('[data-photo-export-preset-select]', 'onChange', { currentTarget: { value: 'other-format' } });
			await m.event('[data-photo-export-preset-apply]', 'onClick'); await preset.entered.promise; const reads = f.reads;
			await m.hide(); await act(async () => { preset.release.resolve(); await settle(); }); await m.reopen(); await act(async () => { await settle(); });
			assert.ok(m.dom.one('[data-photo-png-export-dialog]')); assert.equal(m.dom.find('[data-photo-jpeg-export-dialog]'), null);
			assert.equal(f.reads, reads); assert.equal(f.pickers, 0); assert.equal(f.closed, 0);
		});
	});
});

test('same-photo replacement fences callbacks from an old job key and joins its held native write', async () => {
	await withSingleExportQueue('png', async f => {
		const write = f.hold('write'), abort = f.hold('abort');
		await withMountedSingleExportQueue(f, async m => {
			await m.ready(); const oldSave = reactProps(m.dom.one('[data-photo-png-export-save]')).onClick;
			const oldClose = reactProps(m.dom.one('[data-photo-png-export-close]')).onClick;
			await m.event('[data-photo-png-export-save]', 'onClick'); await write.entered.promise;
			await m.replace('replacement-job', { replacement: true }); assert.equal(f.closed, 0);
			await act(async () => { oldSave?.({}); oldClose?.({}); }); assert.equal(f.pickers, 1);
			const retirement = f.destinations.retireAndJoin(); assert.equal(await remainsPending(retirement), true);
			await act(async () => { write.release.resolve(); await abort.entered.promise; }); assert.equal(await remainsPending(retirement), true);
			await act(async () => { abort.release.resolve(); await retirement; }); assert.equal(f.closed, 0); assert.equal(f.events.includes('commit'), false);
		});
	});
});

test('standalone PNG wrapper also hides without unregistering its destination owner', async () => {
	await withSingleExportQueue('png', async f => {
		const write = f.hold('write');
		await withMountedSingleExportQueue(f, async m => {
			await m.ready(); await m.event('[data-photo-png-export-save]', 'onClick'); await write.entered.promise;
			await m.hide(); assert.equal(m.dom.find('[data-photo-png-export-dialog]'), null); assert.equal(f.events.includes('abort'), false);
			await act(async () => { write.release.resolve(); await settle(); }); await m.reopen();
			assert.equal(m.dom.one('[data-photo-png-export-receipt]').getAttribute('data-photo-png-export-status'), 'saved'); assertSingleExportPixels(f);
		}, false);
	});
});
