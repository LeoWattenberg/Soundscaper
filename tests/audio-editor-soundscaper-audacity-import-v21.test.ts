/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict'
import test from 'node:test'

import { createAudioTrackV10 } from '../src/common/editor/project-v10.ts'
import { verifyProjectFallbackIntegrity } from '../src/common/editor/project-fallback-integrity.ts'
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts'
import {
	importSoundscaperAudacityProjectV21,
} from '../src/soundscaper/editor-audacity-project-import-v21.ts'
import {
	loadSoundscaperProjectV21,
} from '../src/soundscaper/editor-project-v21.ts'
import { validateSoundscaperProjectV21 } from '../src/soundscaper/editor-project-v21-validation.ts'

const NOW = '2026-08-14T10:00:00.000Z'

test('Audacity interchange promotes exact V17 output into V21 without widening native project migration', async () => {
	const decoded = createAudioEditorProjectV17({
		id: 'audacity-import',
		title: 'Audacity import',
		now: NOW,
		revision: 7,
		tracks: [createAudioTrackV10({
			id: 'voice',
			name: 'Voice',
			clipIds: [],
			envelope: [{ frame: 0, value: 0.75 }],
			opaqueExtensions: { audacity: nestedOpaqueState(24) },
		})],
		sequences: [{ id: 'main-sequence', trackIds: ['voice'] }],
		primarySequenceId: 'main-sequence',
		opaqueExtensions: { audacity: { projectVersion: '3.7' } },
	})
	const original = structuredClone(decoded)

	assert.throws(() => loadSoundscaperProjectV21(decoded), /requires re-import/iu)
	const imported = importSoundscaperAudacityProjectV21(decoded)

	assert.equal(imported.schemaVersion, 21)
	assert.equal(imported.id, decoded.id)
	assert.equal(imported.title, decoded.title)
	assert.equal(imported.revision, decoded.revision)
	assert.equal(imported.createdAt, decoded.createdAt)
	assert.equal(imported.updatedAt, decoded.updatedAt)
	assert.deepEqual(imported.opaqueExtensions, decoded.opaqueExtensions)
	assert.deepEqual(imported.tracks[0]?.opaqueExtensions, decoded.tracks[0]?.opaqueExtensions)
	assert.equal(Object.hasOwn(imported.tracks[0]!, 'envelope'), false)
	assert.deepEqual(imported.automationLanes, [])
	assert.deepEqual(imported.mixer.edges.map(({ id }) => id), [
		'assignment:track:voice:master',
		'assignment:master:output:main',
	])
	assert.equal(validateSoundscaperProjectV21(imported), true)
	const admission = await verifyProjectFallbackIntegrity(imported, {})
	assert.doesNotThrow(() => admission.assertCurrent(imported))
	const changedOpaqueState = structuredClone(imported)
	let opaque = (changedOpaqueState.tracks[0]!.opaqueExtensions as Record<string, unknown>)
		.audacity as Record<string, unknown>
	for (let index = 0; index < 24; index += 1) opaque = opaque.child as Record<string, unknown>
	opaque.nativeTrackId = 43
	assert.throws(() => admission.assertCurrent(changedOpaqueState), /admission changed/iu)
	assert.deepEqual(decoded, original)
	assert.throws(() => importSoundscaperAudacityProjectV21({ ...decoded, schemaVersion: 16 }), /V17|schema/iu)
})

function nestedOpaqueState(depth: number): Readonly<Record<string, unknown>> {
	let value: Readonly<Record<string, unknown>> = Object.freeze({ nativeTrackId: 42 })
	for (let index = 0; index < depth; index += 1) value = Object.freeze({ child: value })
	return value
}
