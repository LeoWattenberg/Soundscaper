/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
	SOUNDSCAPER_PROJECT_V29_SCHEMA_VERSION,
	isSoundscaperProductionProjectSchema,
} from '../src/common/editor/project-schema-version.ts'
import { createSoundscaperProjectV23 } from '../src/soundscaper/editor-project-v23.ts'
import {
	SoundscaperProjectV29ReimportRequiredError,
	cloneSoundscaperProjectV29,
	createSoundscaperProjectV29,
	loadSoundscaperProjectV29,
	validateSoundscaperProjectV29,
} from '../src/soundscaper/editor-project-v29.ts'
import { createSoundscaperProjectRuntimeV29Selection } from '../src/soundscaper/editor-project-runtime-v29-selection.ts'
import { editorProjectRuntimeProfileDefinition } from '../src/common/editor/project-runtime-profile.ts'
import { editorProjectRuntimeProfilePrerequisiteDefinition } from '../src/common/editor/project-runtime-profile-prerequisite.ts'
import { editorProjectStorageProfileNames } from '../src/common/editor/storage/project-storage-profile.ts'
import { createSoundscaperTrackDuplicateClipboardV8 } from '../src/soundscaper/editor-session-clipboard-v8.ts'

const NOW = '2026-08-23T00:00:00.000Z'
const STATE_SHA256 = 'ab'.repeat(32)

function state(overrides: Record<string, unknown> = {}) {
	return {
		instanceId: 'native-effect-01',
		format: 'vst3',
		stablePluginId: 'org.example.effect',
		binarySha256: 'cd'.repeat(32),
		stateBody: {
			kind: 'native-plugin-state',
			bodyId: `native-plugin-state:${STATE_SHA256}`,
			byteLength: 3,
			sha256: STATE_SHA256,
		},
		enabled: true,
		bypassed: false,
		continuity: 'live',
		latencySamples: 128,
		...overrides,
	}
}

function project(nativePluginStates: readonly unknown[] = []) {
	return createSoundscaperProjectV29({
		id: 'soundscaper-v29', title: 'Native custody', now: NOW,
		tracks: [{ type: 'audio', id: 'track-01', name: 'Track' }],
		nativePluginStates,
	} as never)
}

test('V29 is selected production authority and adds bounded content-addressed native state', () => {
	assert.equal(SOUNDSCAPER_PROJECT_V29_SCHEMA_VERSION, 29)
	assert.equal(isSoundscaperProductionProjectSchema(29), true)
	const held = project([state()])
	assert.equal(validateSoundscaperProjectV29(held), true)
	assert.equal(held.nativePluginStates[0]?.stateBody.bodyId,
		`native-plugin-state:${STATE_SHA256}`)
	assert.equal(JSON.stringify(cloneSoundscaperProjectV29(held)), JSON.stringify(held))
})

test('V23 upgrades exactly once into writable V29 with empty native state', () => {
	const predecessor = createSoundscaperProjectV23({
		id: 'v23', title: 'Validated predecessor', now: NOW,
	} as never)
	const selected = createSoundscaperProjectRuntimeV29Selection()
	const loaded = selected.migrateProject(predecessor)
	assert.equal(loaded.fromVersion, 23)
	assert.equal(loaded.migrated, true)
	assert.equal(loaded.readOnly, false)
	assert.equal(loaded.project.schemaVersion, 29)
	assert.deepEqual((loaded.project as ReturnType<typeof project>).nativePluginStates, [])
	assert.equal(selected.migrateProject(project()).migrated, false)
})

test('selected V29 runtime pins desktop V11, user_version 13 and storage namespace v29', () => {
	const selected = createSoundscaperProjectRuntimeV29Selection()
	const definition = editorProjectRuntimeProfileDefinition(selected.runtimeProfile)
	const prerequisite = editorProjectRuntimeProfilePrerequisiteDefinition(definition.prerequisite)
	assert.equal(prerequisite.desktopLibrarySchemaVersion, 11)
	assert.equal(prerequisite.desktopProjectSchemaVersion, 29)
	assert.equal(prerequisite.desktopDatabaseUserVersion, 13)
	assert.deepEqual(prerequisite.desktopLibraryScope, ['kw.media', 'soundscaper-project-library', 'v11'])
	for (const value of Object.values(editorProjectStorageProfileNames(selected.storageProfile))) {
		assert.match(value, /v29/u)
	}
})

test('pre-V23 documents require re-import and future documents retain opaque custody read-only', () => {
	assert.throws(() => loadSoundscaperProjectV29({ ...project(), schemaVersion: 21 }), (error) => {
		assert.ok(error instanceof SoundscaperProjectV29ReimportRequiredError)
		assert.equal(error.sourceSchemaVersion, 21)
		return true
	})
	const future = { ...project([state()]), schemaVersion: 30, futureCustody: { kept: [1, 2, 3] } }
	const loaded = loadSoundscaperProjectV29(future)
	assert.equal(loaded.readOnly, true)
	assert.equal(loaded.reason, 'newer-schema')
	assert.deepEqual((loaded.project as Record<string, unknown>).futureCustody, { kept: [1, 2, 3] })
})

test('native state rejects paths, non-content-addressed bodies, oversize bytes and unstable live flags', () => {
	assert.throws(() => project([state({ instanceId: '/tmp/plugin' })]), /instance ID/iu)
	assert.throws(() => project([state({ stateBody: {
		kind: 'native-plugin-state', bodyId: `native-plugin-state:${'11'.repeat(32)}`,
		byteLength: 3, sha256: STATE_SHA256,
	} })]), /derived from its SHA-256/iu)
	assert.throws(() => project([state({ stateBody: {
		kind: 'native-plugin-state', bodyId: `native-plugin-state:${STATE_SHA256}`,
		byteLength: 16 * 1024 * 1024 + 1, sha256: STATE_SHA256,
	} })]), /outside its admitted bounds/iu)
	assert.throws(() => project([state({ enabled: false })]), /Live native plug-in continuity/iu)
})

test('clipboard V8 accepts exact V29 and keeps the new document field out of the carrier', () => {
	const held = project([state()])
	const carrier = createSoundscaperTrackDuplicateClipboardV8(held, 'track-01')
	assert.equal(carrier.schemaVersion, 8)
	assert.equal(carrier.originProjectId, held.id)
	assert.equal(carrier.sourceTrackId, 'track-01')
	assert.equal(Object.hasOwn(carrier, 'nativePluginStates'), false)
})
