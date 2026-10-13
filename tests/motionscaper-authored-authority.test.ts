/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chmod, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMotionLayer, createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { motionColor, motionScalar, motionVector } from '../src/common/editor/motion-property.ts';
import { motionRectanglePath } from '../src/common/editor/motion-shape-primitives.ts';
import { decodeMotionChannel } from '../src/common/editor/motion-surface.ts';
import { verifyMotionAuthoredProject } from '../desktop/motionscaper-authored-reference.ts';
import { motionAuthoredFileIdentity, verifyMotionAuthoredFileIdentity } from '../desktop/motionscaper-authored-identity.ts';
import { finishMotionAuthoredQualification } from '../desktop/motionscaper-authored-lifecycle.ts';

test('Motionscaper authored title rejects changed saved opacity independently of reference pixels', () => {
	const base = createMotionscaperProject({ id: 'authored', compositionId: 'main', title: 'Desktop authored title', width: 160, height: 96, durationFrames: 2 });
	const title = createMotionLayer({ id: 'title', name: 'Title', durationFrames: 2, content: { kind: 'text', document: {
		runs: [{ text: 'Motion', fontAssetId: 'font', fontSize: motionScalar(24), color: motionColor([1, 1, 1, 1]), tracking: motionScalar(0) }],
		align: 'left', lineHeight: motionScalar(1), boxSize: motionVector([120, 40]),
	} } });
	const card = createMotionLayer({ id: 'card', name: 'Card', durationFrames: 2, content: { kind: 'shapes', shapes: [{ id: 'rectangle',
		path: motionRectanglePath({ x: 0, y: 0, width: 140, height: 64 }), stroke: null,
		fill: motionColor([decodeMotionChannel(74 / 255, 'srgb'), decodeMotionChannel(128 / 255, 'srgb'), 1, 1]),
	}] } });
	const project = (opacity = motionScalar(1)) => ({ ...base, compositions: [{ ...base.compositions[0]!, layers: [
		{ ...title, transform: { ...title.transform, position: motionVector([20, 20, 0]), opacity } },
		{ ...card, transform: { ...card.transform, position: motionVector([10, 8, 0]) } },
	] }] });
	assert.doesNotThrow(() => verifyMotionAuthoredProject(project()));
	assert.throws(() => verifyMotionAuthoredProject(project(motionScalar(.5))), /opacity/u);
	assert.throws(() => verifyMotionAuthoredProject(project({ ...motionScalar(1), expression: { source: 'value * .5', enabled: true, references: [] } })), /opacity/u);
});

test('Motionscaper authored decoder authority refuses changed executable bytes, inode, permissions and symlinks', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'motion-authored-decoder-'));
	try {
		const path = join(directory, 'decoder'); await writeFile(path, 'original', { mode: 0o755 });
		const initial = await motionAuthoredFileIdentity(path); await verifyMotionAuthoredFileIdentity(initial);
		await writeFile(path, 'changed!'); await assert.rejects(verifyMotionAuthoredFileIdentity(initial), /identity/u);
		const changed = await motionAuthoredFileIdentity(path); await writeFile(join(directory, 'replacement'), 'changed!', { mode: 0o755 });
		await rename(join(directory, 'replacement'), path); await assert.rejects(verifyMotionAuthoredFileIdentity(changed), /identity/u);
		const replaced = await motionAuthoredFileIdentity(path); await chmod(path, 0o644); await assert.rejects(verifyMotionAuthoredFileIdentity(replaced), /identity/u);
		await symlink(path, join(directory, 'alias')); await assert.rejects(motionAuthoredFileIdentity(join(directory, 'alias')), /canonical/u);
		const admitted = await motionAuthoredFileIdentity(path); let result: unknown;
		await assert.rejects(finishMotionAuthoredQualification(() => Promise.resolve('decoded'), () => writeFile(path, 'replaced'),
			() => verifyMotionAuthoredFileIdentity(admitted), value => { result = value; return Promise.resolve(); }), /Authored qualification/u);
		assert.ok(result && typeof result === 'object'); assert.equal(Reflect.get(result, 'status'), 'failed');
	} finally { await rm(directory, { recursive: true, force: true }); }
});
