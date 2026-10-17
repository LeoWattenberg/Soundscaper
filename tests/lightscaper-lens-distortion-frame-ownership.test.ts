/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { framescaperEditableImageWorkingBytes } from '../src/framescaper/timeline-image-current-frame-source.ts';
import { bindFramescaperImageDevelopAuthoringCurrentV1, framescaperImageDevelopAuthoringForCurrentV1 } from '../src/framescaper/editor-selected-timeline-image-develop-authoring-controller-v1.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import type { FramescaperImageSourceSetCommandTimelineImage } from '../src/framescaper/editor-project-timeline-image-image-command.ts';
import { normalizeFramescaperImageSourceV3 } from '../src/common/editor/timeline-image-model-v3.ts';
import { createImageDevelopHandoffProvenanceV2 } from '../src/common/editor/image-develop-handoff-provenance-v2.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { withPreparedBrushMaskResourceV1, type BrushMaskResourceReferenceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { editableImageFixture, PROFILE } from './helpers/framescaper-editable-image-current-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

test('Current Source3 scalar working cost includes every reachable brush alpha and complete largest-body authentication residency', async () => {
	const f = editableImageFixture({ crop: false }), project = f.project();
	const references: Readonly<BrushMaskResourceReferenceV1>[] = [];
	for (let index = 0; index < 4; index++) await withPreparedBrushMaskResourceV1({ width: 2, height: 2, alpha: Uint8Array.of(index, 31, 128, 255) }, value => { references.push(value.reference); });
	const develop = normalizeImageDevelopStateCurrentV1({ ...f.source.develop, processVersion: 3, repairs: { schemaVersion: 1, spots: [] },
		effects: [...references.map((_reference, index) => createVideoEffect('tone-ladder-v1', { id: `tone-${index}` })),
			createVideoEffect('lens-distortion-v1', { id: 'lens', params: { amount: 50 } })],
		masks: references.map((reference, index) => ({ schemaVersion: 1, id: `brush-${index}`, kind: 'mask', inputs: [{ name: 'paint', sourceRef: reference.storageKey, kind: 'alpha' }],
			nodes: [{ id: 'paint', kind: 'alpha', inputName: 'paint' }], outputNodeId: 'paint' })),
		maskBindings: references.map((_reference, index) => ({ maskId: `brush-${index}`, effectId: `tone-${index}` })) });
	const source = normalizeFramescaperImageSourceV3({ ...f.source, schemaVersion: 3, develop,
		provenance: createImageDevelopHandoffProvenanceV2({ original: f.source.provenance.original, develop,
			origin: { schemaFamily: 'framescaper', schemaVersion: 1, projectId: project.id, revision: project.revision,
				sourceId: f.source.id, sequenceId: f.clip.sequenceId, clipId: f.clip.id } }) });
	const snapshot = JSON.stringify(source), pack = f.pack.bytes.slice(), canonical = BigInt(source.canonical.width * source.canonical.height * 4);
	const allRetainedAlpha = references.reduce((sum, reference) => sum + BigInt(reference.width * reference.height), 0n);
	const largestBody = BigInt(Math.max(...references.map(reference => reference.byteLength)));
	// Independent lower bound: canonical + four staged planes + fixed reserve,
	// every reachable alpha, four copies of the largest authenticated body and
	// two simultaneous SHA outputs. This scalar test makes no body-load claim.
	const minimum = canonical + canonical * 4n + 4096n + allRetainedAlpha + largestBody * 4n + 64n;
	assert.ok(framescaperEditableImageWorkingBytes(source) >= minimum, 'Ordinary Frame preflight must charge retained multi-brush residency.');
	assert.equal(JSON.stringify(source), snapshot); assert.deepEqual(f.pack.bytes, pack);
});

/** Genuine immutable model pack and actual selected Current Session. The
 * fixture deliberately makes no browser codec or native ingest claim. */
function fixture(processVersion: 1 | 2) {
	const f = editableImageFixture({ crop: false, processVersion }), commands: FramescaperImageSourceSetCommandTimelineImage[] = [];
	const selected = { selectedClipId: f.clip.id, readOnly: false };
	const controller = { project: f.project(), getSnapshot: () => selected, actions: { edit: { commit(command: FramescaperImageSourceSetCommandTimelineImage) {
		commands.push(command); controller.project = applyFramescaperProjectCommand(PROFILE, controller.project, command);
	} } } };
	bindFramescaperImageDevelopAuthoringCurrentV1({ controller, store: f.store });
	const port = framescaperImageDevelopAuthoringForCurrentV1(controller); assert.ok(port);
	return { ...f, controller, commands, port };
}

for (const processVersion of [1, 2] as const) for (const detach of ['frame', 'coverage'] as const) {
	test(`Current process${processVersion} draft joins held ${detach} transfer and reports the opaque primary and one physical refusal`, async () => {
		const f = fixture(processVersion), session = await f.port.open(), project = structuredClone(f.controller.project), pack = f.pack.bytes.slice(), original = f.original.slice();
		assert.ok(session.withDraftFrame);
		const develop = normalizeImageDevelopStateCurrentV1({ ...session.develop, effects: [createVideoEffect('tone-ladder-v1', { id: 'tone' }),
			createVideoEffect('lens-distortion-v1', { id: 'lens', params: { amount: 100 } })],
			masks: [{ schemaVersion: 1, id: 'local', kind: 'mask', inputs: [], nodes: [{ id: 'ramp', kind: 'linear-gradient',
				start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }], outputNodeId: 'ramp' }], maskBindings: [{ maskId: 'local', effectId: 'tone' }] });
		assert.equal(develop.processVersion, processVersion);
		const entered = deferred<void>(), release = deferred<void>(), opaque = Proxy.revocable({}, {}); opaque.revoke();
		let attached: Uint8Array<ArrayBuffer> | undefined;
		const work = session.withDraftFrame({ develop, maskOverlay: { maskId: 'local', effectId: 'tone' } }, async view => {
			assert.ok(view.maskOverlay);
			const transferred = detach === 'frame' ? view.frame.pixels.buffer : view.maskOverlay.coverage.buffer;
			attached = detach === 'frame' ? view.maskOverlay.coverage : view.frame.pixels;
			structuredClone(transferred, { transfer: [transferred] }); entered.resolve(); await release.promise; throw opaque.proxy;
		});
		const outcome = work.then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
		try {
			await Promise.race([entered.promise, work]); assert.equal(await remainsPending(outcome), true); assert.ok(attached?.some(value => value !== 0));
			release.resolve(); const result = await outcome; assert.equal(result.ok, false); if (result.ok) assert.fail('Transferred native output must refuse retirement.');
			assert.equal(Object.is(result.error, opaque.proxy), false); assert.ok(result.error instanceof AggregateError);
			assert.ok(Object.is(result.error.cause, opaque.proxy), 'The primary failure must remain the exact outer cause.');
			assert.equal(result.error.errors.length, 2); assert.ok(Object.is(result.error.errors[0], opaque.proxy));
			assert.ok(result.error.errors[1] instanceof TypeError, 'Only the one transferred physical backing should fail retirement.');
			assert.ok(attached?.every(value => value === 0)); assert.deepEqual(f.controller.project, project); assert.equal(f.commands.length, 0);
			assert.deepEqual(f.pack.bytes, pack); assert.deepEqual(f.original, original);
		} finally { release.resolve(); await outcome; await session.closeAndJoin(); }
	});
}
