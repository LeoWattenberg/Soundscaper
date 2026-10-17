/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperBaselineImageFixture } from './helpers/framescaper-baseline-image-fixture.ts';
import { migrateFramescaperSuccessorProject } from '../src/framescaper/editor-project-successor.ts';
import { createFramescaperCompositionLink } from '../src/framescaper/editor-project-successor-link.ts';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { createMotionscaperRevision } from '../src/common/editor/motion-project-revision.ts';
import { createFramescaperSuccessorHistory, executeFramescaperSuccessorHistory, undoFramescaperSuccessorHistory, redoFramescaperSuccessorHistory, normalizeFramescaperSuccessorHistory } from '../src/framescaper/editor-project-successor-history.ts';
import { framescaperSuccessorBaselineProject, applyFramescaperSuccessorCommand } from '../src/framescaper/editor-project-successor-commands.ts';
import { validateFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
const NOW = '2026-10-11T00:00:00.000Z';
function fixture() {
	const source = createFramescaperBaselineImageFixture({ imageOnly: true });
	const project = migrateFramescaperSuccessorProject(source.project);
	const motion = createMotionscaperProject({ id: 'motion', title: 'Title', compositionId: 'composition', width: 2, height: 1 });
	const link = createFramescaperCompositionLink(source.source.id, 'composition', createMotionscaperRevision(motion));
	return { project, link, motion };
}
test('successor ordinary edits preserve typed links, stable source identities, and undo revision custody', () => {
	const { project, link, motion } = fixture();
	let history = createFramescaperSuccessorHistory(project);
	history = executeFramescaperSuccessorHistory(history, { type: 'composition-link/replace', sourceId: link.sourceId, expectedDigest: null, link, commands: [] }, { now: NOW });
	assert.equal(history.present.schemaVersion, 2); assert.equal(history.present.compositionLinks[0]?.acceptedDigest, link.acceptedDigest);
	const revision = history.present.revision;
	history = executeFramescaperSuccessorHistory(history, { type: 'project/rename', title: 'Edited timeline' }, { now: NOW });
	assert.equal(history.present.title, 'Edited timeline'); assert.equal(history.present.compositionLinks[0]?.acceptedDigest, link.acceptedDigest);
	const newer = createFramescaperCompositionLink(link.sourceId, 'composition', createMotionscaperRevision({ ...motion, revision: 1, title: 'Saved edit' }));
	history = executeFramescaperSuccessorHistory(history, { type: 'composition-link/replace', sourceId: link.sourceId, expectedDigest: link.acceptedDigest, link: newer, commands: [] }, { now: NOW });
	const undone = undoFramescaperSuccessorHistory(history, { now: NOW });
	assert.equal(undone.present.title, 'Edited timeline'); assert.equal(undone.present.compositionLinks[0]?.acceptedDigest, link.acceptedDigest);
	assert.ok(Number(undone.present.revision) > Number(revision)); assert.equal(history.present.compositionLinks[0]?.acceptedDigest, newer.acceptedDigest);
	assert.equal(redoFramescaperSuccessorHistory(undone, { now: NOW }).present.compositionLinks[0]?.acceptedDigest, newer.acceptedDigest);
	const projection = framescaperSuccessorBaselineProject(history.present); assert.equal(projection.schemaVersion, 1); assert.equal(Object.hasOwn(projection, 'compositionLinks'), false);
	assert.equal(validateFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, projection), true); assert.throws(() => validateFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, history.present), /future|newer|current|schema/iu);
});
test('successor link command refuses stale identity and malformed history without mutating accepted project', () => {
	const { project, link } = fixture(); const history = createFramescaperSuccessorHistory({ ...project, compositionLinks: [link] });
	assert.throws(() => executeFramescaperSuccessorHistory(history, { type: 'composition-link/replace', sourceId: link.sourceId, expectedDigest: 'a'.repeat(64), link, commands: [] }), /changed|conflict|stale/iu);
	assert.throws(() => executeFramescaperSuccessorHistory(history, { type: 'composition-link/replace', sourceId: 'different', expectedDigest: null, link, commands: [] }), /identity|source/iu);
	assert.throws(() => normalizeFramescaperSuccessorHistory({ ...history, sessionToken: 'secret' }), /unsupported|unexpected|field|shape/iu);
	let invoked = false; assert.throws(() => normalizeFramescaperSuccessorHistory({ ...history, get present() { invoked = true; return project; } }), /property|accessor|data/iu); assert.equal(invoked, false);
	const restored = normalizeFramescaperSuccessorHistory(JSON.parse(JSON.stringify(history)) as unknown); assert.deepEqual(restored, history); assert.equal(Object.isFrozen(restored.present.compositionLinks), true);
	assert.equal(history.present.compositionLinks[0]?.acceptedDigest, link.acceptedDigest);
});
test('successor link replacement can atomically combine source placement commands and rejects missing associations', () => {
	const { project, link } = fixture();
	const result = applyFramescaperSuccessorCommand(project, { type: 'composition-link/replace', sourceId: link.sourceId, expectedDigest: null, link, commands: [{ type: 'project/rename', title: 'Placed linked title' }] }, { now: NOW });
	assert.equal(result.title, 'Placed linked title'); assert.equal(Number(result.revision), Number(project.revision) + 1); assert.equal(result.compositionLinks.length, 1);
	assert.throws(() => applyFramescaperSuccessorCommand(project, { type: 'composition-link/replace', sourceId: 'missing', expectedDigest: null, link: { ...link, sourceId: 'missing' }, commands: [] }), /source/iu);
});
