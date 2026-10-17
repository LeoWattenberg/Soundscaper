/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { framescaperProjectForEditClipboardConsumers } from '../src/framescaper/editor-project-runtime.ts';
import { createClipboardDescriptorV7, preparePasteCommandV7 } from '../src/common/editor/commands/clipboard-runtime-v7.ts';
import { createFramescaperSessionClipboardV14, normalizeFramescaperSessionClipboardV14 } from '../src/framescaper/editor-session-clipboard-v14.ts';
import { normalizeFramescaperSessionClipboardV13 } from '../src/framescaper/editor-session-clipboard-v13.ts';
import { createAudioEditorSessionControllerV2 } from '../src/common/editor/session-v2.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';
import { prepareFramescaperSessionClipboardPasteV14 } from '../src/framescaper/editor-session-clipboard-v14-paste.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { createEditorProjectRuntimeSelection } from '../src/framescaper/editor-project-runtime-selection.ts';

const REF = { storageKey: `lut-sha256:${'ab'.repeat(32)}`, sha256: 'ab'.repeat(32), byteLength: 84,
	size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
function fixture(lut: unknown = REF) {
	const options = framescaperV20Options();
	const project = createFramescaperProject(PROFILE, { ...options, clips: (options.clips as readonly Record<string, unknown>[])
		.map(clip => clip.id === 'video-clip' ? { ...clip, videoEffects: [
			{ id: 'tone', type: 'tone-ladder-v1', enabled: true, params: { exposure: 0.5 } },
			{ id: 'cube', type: 'cube-lut-profile-v1', enabled: false, params: { lut } },
		] } : clip) });
	const descriptor = createClipboardDescriptorV7(framescaperProjectForEditClipboardConsumers(PROFILE, project),
		{ startFrame: 0, endFrame: 24_000, trackIds: ['video-track'] });
	return { project, descriptor };
}

test('Frame14 snapshots a single complete descriptor7 beside admitted V13 metadata and exact disabled resource closure', () => {
	const { project, descriptor } = fixture();
	const original = structuredClone(project);
	const carrier = createFramescaperSessionClipboardV14(PROFILE, project, descriptor);
	assert.equal(carrier.schemaVersion, 14); assert.equal(carrier.descriptor.schemaVersion, 7);
	assert.deepEqual(carrier.descriptor, descriptor); assert.deepEqual(carrier.cubeLuts, [REF]);
	assert.deepEqual(carrier.clipBindings, [{ clipId: 'video-clip', descriptorKey: 'video-clip:0:24000' }]);
	assert.equal(carrier.finishing.originProjectId, project.id); assert.equal(carrier.finishing.originRevision, project.revision);
	assert.deepEqual(normalizeFramescaperSessionClipboardV14(JSON.parse(JSON.stringify(carrier))), carrier);
	assert.throws(() => normalizeFramescaperSessionClipboardV13(carrier), /V13|exact|schema/iu);
	assert.deepEqual(project, original);
});

test('Frame14 refuses omitted, conflicting or hitchhiking resource closure and never infers a resource from null', () => {
	const { project, descriptor } = fixture(); const carrier = createFramescaperSessionClipboardV14(PROFILE, project, descriptor);
	for (const cubeLuts of [[], [{ ...REF, size: 3 }], [REF, { ...REF, sha256: 'cd'.repeat(32), storageKey: `lut-sha256:${'cd'.repeat(32)}` }]]) {
		assert.throws(() => normalizeFramescaperSessionClipboardV14({ ...carrier, cubeLuts }), /closure|resource|reference|ledger/iu);
	}
	const neutral = fixture(null); assert.deepEqual(createFramescaperSessionClipboardV14(PROFILE, neutral.project, neutral.descriptor).cubeLuts, []);
	assert.throws(() => normalizeFramescaperSessionClipboardV14({ ...carrier, unknown: true }), /unsupported field/iu);
});

test('current Session2 retains Frame14 descriptor source and immutable LUT roots through a real snapshot', () => {
	const { project, descriptor } = fixture(); const carrier = createFramescaperSessionClipboardV14(PROFILE, project, descriptor);
	const session = createAudioEditorSessionControllerV2({ currentSchemaVersion: 1 });
	session.openProject(project); session.setClipboard({ schemaVersion: 2, originProjectId: carrier.originProjectId,
		descriptor: carrier.descriptor, sources: carrier.sources });
	session.closeProject(project.id, { force: true });
	assert.deepEqual([...session.getHistoryStorageKeys()], [REF.storageKey]);
	const restored = createAudioEditorSessionControllerV2({ currentSchemaVersion: 1, snapshot: session.serialize() });
	restored.openProject(project);
	assert.deepEqual(restored.clipboardForProject(project.id)!.descriptor, carrier.descriptor);
	restored.dispose(); session.dispose();
});

test('actual current Frame14 paste preserves the full authored resource order with independent IDs and unchanged original', () => {
	const { project, descriptor } = fixture(); const original = structuredClone(project);
	const clipboard = createFramescaperSessionClipboardV14(PROFILE, project, descriptor);
	const projection = framescaperProjectForEditClipboardConsumers(PROFILE, project);
	let counter = 0; const createId = (prefix = 'id') => `${prefix}-${String(++counter)}`;
	const base = preparePasteCommandV7(descriptor, { project: projection, atFrame: 48_000 }, createId);
	const prepared = prepareFramescaperSessionClipboardPasteV14(PROFILE, project, clipboard, base, createId);
	const result = applyFramescaperProjectCommand(PROFILE, project, prepared.command);
	const key = descriptor.tracks[0]!.clips[0]!.key as string;
	const added = result.clips.find(clip => clip.id === base.clipIds![key])!;
	assert.ok(added); assert.equal(added.sequenceStartFrame, 10);
	assert.ok(Array.isArray(added.videoEffects));
	const effects = added.videoEffects as readonly { id: string; type: string; enabled: boolean; params: unknown }[];
	assert.deepEqual(effects.map(effect => effect.id), base.videoEffectIds![key]);
	assert.deepEqual(effects.map(effect => effect.type), ['tone-ladder-v1', 'cube-lut-profile-v1']);
	assert.deepEqual(effects[1]!.params, { lut: REF });
	assert.equal(effects[1]!.enabled, false);
	assert.deepEqual(prepared.cubeLuts, [REF]); assert.deepEqual(project, original);
});

test('the selected Frame runtime retains current clipboard resources after closing the origin tab', () => {
	const { project, descriptor } = fixture();
	const runtime = createEditorProjectRuntimeSelection(PROFILE);
	const session = runtime.createSessionController();
	session.openProject(project);
	assert.equal(session.serialize().schemaVersion, 2);
	session.setClipboard({ schemaVersion: 2, originProjectId: project.id, descriptor, sources: project.sources });
	session.closeProject(project.id, { force: true });
	assert.deepEqual([...session.getHistoryStorageKeys()], [REF.storageKey]);
	session.dispose();
});

test('the selected Frame runtime refuses an accessor schema tag without invoking borrowed code', () => {
	const { project, descriptor } = fixture();
	const runtime = createEditorProjectRuntimeSelection(PROFILE);
	let reads = 0;
	Object.defineProperty(descriptor, 'schemaVersion', {
		enumerable: true,
		get() { reads += 1; throw new Error('borrowed schema getter executed'); },
	});
	assert.throws(() => runtime.createEditSessionClipboard(project, descriptor), /data property|accessor/iu);
	assert.equal(reads, 0);
});
