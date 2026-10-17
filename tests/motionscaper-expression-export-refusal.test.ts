/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import CanvasKitInit from 'canvaskit-wasm';
import { createMotionLayer, createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { createMotionscaperHistory } from '../src/motionscaper/editor-project-commands.ts';
import { createMotionscaperExpressionCommands } from '../src/motionscaper/editor-expression-commands.ts';
import { createMotionscaperRevision } from '../src/motionscaper/editor-project-revision.ts';
import { createMotionscaperRenderRequest } from '../src/motionscaper/editor-render-task.ts';
import { createMotionscaperDeliveryQueue } from '../src/motionscaper/editor-delivery-queue.ts';
import { renderMotionFrameSequence } from '../src/common/editor/controller/export/motion-render-pipeline.ts';
import { createCanvasKitMotionRasterizer } from '../src/common/editor/motion-canvaskit-rasterizer.ts';
import { MotionExpressionPropertyError } from '../src/common/editor/motion-expression-runtime.ts';
import { MotionExpressionError } from '../src/common/editor/motion-expression-ast.ts';
import { motionExpressionErrorMessage } from '../src/common/editor/motion-expression-error-message.ts';
import { motionColor, motionVector } from '../src/common/editor/motion-property.ts';
import { MotionDeliveryCleanupFailure, pendingMotionDeliveryCleanup } from '../src/common/editor/motion-delivery-cleanup.ts';
import { aggregateScapeErrors } from '../src/common/editor/scape-abort.ts';

const runtime = CanvasKitInit();
for (const source of ['window.fetch("/")', '1 / 0']) test(`M08 final rendering refuses retained ${source} without publication and succeeds after correction`, async () => {
	const base = createMotionscaperProject({ id: 'invalid', title: 'Invalid source', compositionId: 'main', width: 8, height: 8 });
	const layer = createMotionLayer({ id: 'solid', name: 'Responsible solid', durationFrames: 300, content: { kind: 'solid', size: motionVector([8, 8]), color: motionColor([1, 0, 0, 1]) } });
	const history = createMotionscaperHistory({ ...base, compositions: [{ ...base.compositions[0]!, layers: [layer] }] });
	const address = { compositionId: 'main', layerId: 'solid', propertyPath: 'transform.opacity' };
	const invalid = history.commit(createMotionscaperExpressionCommands({ project: history.snapshot().project, ...address, expression: { source, enabled: true, references: [] } }));
	const before = createMotionscaperRevision(invalid); const kit = await runtime;
	let writes = 0, finishes = 0, releases = 0, aborts = 0, alpha: number | null = null;
	const render = (project: typeof invalid) => renderMotionFrameSequence(createMotionscaperRenderRequest({ project, compositionId: 'main', firstFrame: 0, endFrame: 1,
		acquire: () => Promise.resolve({ rasterizer: createCanvasKitMotionRasterizer(kit, { assets: [], fallbackFonts: [], loadAsset: () => Promise.reject(new Error('No assets.')) }), release: () => { releases++; return Promise.resolve(); } }),
		sink: { write(output) { writes++; alpha = output.surface.pixels[3]!; return Promise.resolve(); }, finish() { finishes++; return Promise.resolve('published'); }, abort() { aborts++; return Promise.resolve(); } },
	}));
	await assert.rejects(render(invalid), (error: unknown) => {
		assert.ok(error instanceof MotionExpressionPropertyError); assert.equal(error.compositionId, 'main'); assert.equal(error.layerId, 'solid'); assert.equal(error.propertyPath, 'transform.opacity');
		assert.ok(error.diagnostic.end > error.diagnostic.start); return true;
	});
	assert.deepEqual([writes, finishes, releases, aborts], [0, 0, 1, 1]);
	assert.equal(history.snapshot().project, invalid); assert.equal(createMotionscaperRevision(invalid).digest, before.digest);
	const reopened = createMotionscaperRevision(JSON.parse(JSON.stringify(invalid)) as unknown).project;
	assert.equal(reopened.compositions[0]!.layers[0]!.transform.opacity.expression!.source, source);
	const queue = createMotionscaperDeliveryQueue({ store: { readAsset: () => Promise.resolve(null) }, deliver: async () => { await render(invalid); return null; } });
	try {
		const job = queue.enqueue({ project: invalid, compositionId: 'main', firstFrame: 0, endFrame: 1, format: 'png' }); await assert.rejects(job.completion, MotionExpressionPropertyError);
		assert.match(queue.snapshot()[0]!.error!, /Responsible solid.*transform\.opacity/u); assert.equal(queue.output(job.id), null);
	} finally { await queue.dispose(); }
	const corrected = history.commit(createMotionscaperExpressionCommands({ project: invalid, ...address, expression: { source: '0.5', enabled: true, references: [] } }));
	assert.equal(history.undo(), true); assert.equal(history.snapshot().project.compositions[0]!.layers[0]!.transform.opacity.expression!.source, source);
	assert.equal(history.redo(), true); assert.equal((await render(corrected)).output, 'published');
	assert.deepEqual([writes, finishes, releases, aborts, alpha], [1, 1, 3, 2, 0.5]);
});

test('expression diagnostics retain localized spans without changing ordinary error handling', () => {
	const project = createMotionscaperProject({ id: 'diagnostic', title: 'Diagnostic', compositionId: 'main' });
	const failure = new MotionExpressionError('syntax', 'Expected an expression.', { start: 1, end: 3 });
	assert.equal(motionExpressionErrorMessage(failure, project, 'Quelltextposition'), 'Quelltextposition 2–4: Expected an expression.');
	assert.equal(motionExpressionErrorMessage(new Error('Destination failed.'), project), null); assert.equal(motionExpressionErrorMessage(null, project), null);
});

test('expression aggregate presentation bounds cyclic graphs and never invokes errors getters', () => {
	const project = createMotionscaperProject({ id: 'cyclic-diagnostic', title: 'Diagnostic', compositionId: 'main' });
	const failure = new MotionExpressionError('syntax', 'Expected an expression.', { start: 1, end: 3 });
	const cyclic = new AggregateError([], 'Cleanup wrapper.'); (cyclic.errors as unknown[]).push(cyclic, failure);
	assert.equal(motionExpressionErrorMessage(cyclic, project, 'Quelltextposition'), 'Cleanup wrapper. Quelltextposition 2–4: Expected an expression.');
	const ordinary = new AggregateError([], 'Ordinary cleanup.'); (ordinary.errors as unknown[]).push(ordinary); assert.equal(motionExpressionErrorMessage(ordinary, project), null);
	const getter = new AggregateError([], 'Foreign getter.'); Object.defineProperty(getter, 'errors', { get() { assert.fail('Error presentation must not invoke errors getters.'); } });
	assert.equal(motionExpressionErrorMessage(getter, project), null);
});

test('expression export diagnostics survive actual pipeline cleanup aggregation without losing the owned cleanup capability', async () => {
	const base = createMotionscaperProject({ id: 'cleanup', title: 'Cleanup', compositionId: 'main', width: 8, height: 8 });
	const layer = createMotionLayer({ id: 'solid', name: 'Responsible solid', durationFrames: 300, content: { kind: 'solid', size: motionVector([8, 8]), color: motionColor([1, 0, 0, 1]) } });
	const project = { ...base, compositions: [{ ...base.compositions[0]!, layers: [{ ...layer, transform: { ...layer.transform, opacity: { ...layer.transform.opacity, expression: { source: '1 / 0', enabled: true, references: [] } } } }] }] };
	let released = 0, cleaned = 0, rasterized = 0, failed: unknown;
	const cleanup = new MotionDeliveryCleanupFailure([new Error('Owned destination remains open.')], 'Destination cleanup failed.', () => { cleaned++; return Promise.resolve(); });
	try {
		await renderMotionFrameSequence(createMotionscaperRenderRequest({ project, compositionId: 'main', firstFrame: 0, endFrame: 1,
			acquire: () => Promise.resolve({ rasterizer: { rasterize() { rasterized++; return Promise.reject(new Error('Must not rasterize invalid expressions.')); } }, release: () => { released++; return Promise.resolve(); } }),
			sink: { write: () => { assert.fail('No frame may be written.'); }, finish: () => { assert.fail('No output may be published.'); }, abort: () => Promise.reject(cleanup) },
		})); assert.fail('Invalid export must fail.');
	} catch (failure) { failed = failure; }
	assert.ok(failed instanceof AggregateError); assert.deepEqual([released, rasterized], [1, 0]);
	const nested = aggregateScapeErrors(failed, [new Error('Secondary destination shutdown failed.')], 'Delivery finalization failed.');
	const queue = createMotionscaperDeliveryQueue({ store: { readAsset: () => Promise.resolve(null) }, deliver: () => Promise.reject(nested) });
	try {
		const job = queue.enqueue({ project, compositionId: 'main', firstFrame: 0, endFrame: 1, format: 'png' }); await assert.rejects(job.completion, error => error === nested);
		const message = queue.snapshot()[0]!.error!;
		assert.match(message, /Responsible solid.*transform\.opacity/u); assert.match(message, /Destination cleanup failed/u); assert.match(message, /Secondary destination shutdown failed/u);
		assert.deepEqual(pendingMotionDeliveryCleanup(nested), [cleanup]); assert.equal(queue.snapshot()[0]!.cleanupRequired, true);
		assert.throws(() => queue.retry(job.id), /failed or cancelled/u); await queue.cancel(job.id);
		assert.equal(cleaned, 1); assert.equal(queue.snapshot()[0]!.cleanupRequired, false); assert.deepEqual(pendingMotionDeliveryCleanup(nested), []);
	} finally { await queue.dispose(); }
});
