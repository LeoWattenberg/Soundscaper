/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { editorProjectFeatureCapabilityProfileDefinition } from '../src/common/editor/project-feature-capability-profile.ts';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import {
	createFramescaperDesktopProjectLibraryV16Handshake,
	createFramescaperDesktopProjectLibraryV16Paths,
	validateFramescaperDesktopProjectLibraryV16Handshake,
} from '../desktop/project-library-v16-contract.ts';
import {
	FRAMESCAPER_V20_PROJECT_FEATURE_CAPABILITY_PROFILE,
} from '../src/framescaper/editor-project-feature-capability-profile-v20.ts';
import {
	FRAMESCAPER_V26_PROJECT_CANDIDATE_CAPABILITY_PROFILE,
} from '../src/framescaper/editor-project-feature-capability-profile-v26.ts';
import {
	FRAMESCAPER_V26_CANDIDATE_CONTRACT,
	FRAMESCAPER_V26_PROJECT_CANDIDATE_PROFILE,
} from '../src/framescaper/editor-project-runtime-profile-v26.ts';
import {
	cloneFramescaperProjectV26,
	createFramescaperProjectV26,
	loadFramescaperProjectV26,
	validateFramescaperProjectV26,
	type FramescaperProjectV26,
} from '../src/framescaper/editor-project-v26.ts';
import {
	createFramescaperOpenFxClipboardV10,
	normalizeFramescaperOpenFxClipboardV10,
	prepareFramescaperOpenFxClipboardPasteV10,
} from '../src/framescaper/editor-session-clipboard-v10.ts';
import {
	framescaperDesktopProjectTransportV26,
} from '../src/framescaper/desktop-project-transport-v26.ts';
import { createFramescaperScapeNativeRuntimeV26 } from '../src/framescaper/editor-scape-native-v26.ts';
import { rebindFramescaperOpenFxSourceIdentitiesV26 } from '../src/framescaper/editor-project-v26-source-rebind.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

const PROFILE = FRAMESCAPER_V26_PROJECT_CANDIDATE_PROFILE;
const SHA_A = 'aa'.repeat(32);
const SHA_B = 'bb'.repeat(32);
const SHA_C = 'cc'.repeat(32);
const SHA_D = 'dd'.repeat(32);

test('V26 freezes project/library/SQLite/scope, clipboard V10, and render plan V12', () => {
	assert.deepEqual(FRAMESCAPER_V26_CANDIDATE_CONTRACT, {
		status: 'dormant-candidate',
		projectSchemaVersion: 26,
		desktopLibrarySchemaVersion: 16,
		desktopDatabaseUserVersion: 18,
		desktopLibraryScope: ['kw.media', 'scape-project-library', 'v16'],
		clipboardVersion: 10,
		renderPlanVersion: 12,
	});
	const handshake = createFramescaperDesktopProjectLibraryV16Handshake();
	assert.deepEqual(validateFramescaperDesktopProjectLibraryV16Handshake(handshake), handshake);
	assert.match(createFramescaperDesktopProjectLibraryV16Paths('/var/lib/soundscaper').libraryRoot, /v16$/u);
	assert.deepEqual(Object.keys(createFramescaperScapeNativeRuntimeV26(PROFILE)), [
		'inspectScapeProject', 'importScapeProject', 'exportScapeProject', 'copyScapeArchive',
	]);
});

test('ofxEffects is known but unavailable in shipped V20 and enabled only in V26 candidate tests', () => {
	assert.equal(PROJECT_FEATURE_CAPABILITY_IDS.ofxEffects, 'org.soundscaper.capability.openfx-effects');
	const shipped = editorProjectFeatureCapabilityProfileDefinition(
		FRAMESCAPER_V20_PROJECT_FEATURE_CAPABILITY_PROFILE,
	).registrations.find(({ key }) => key === 'ofxEffects');
	const candidate = editorProjectFeatureCapabilityProfileDefinition(
		FRAMESCAPER_V26_PROJECT_CANDIDATE_CAPABILITY_PROFILE,
	).registrations.find(({ key }) => key === 'ofxEffects');
	assert.deepEqual(shipped, {
		key: 'ofxEffects', featureId: 'org.soundscaper.capability.openfx-effects', available: false,
	});
	assert.deepEqual(candidate, { ...shipped, available: true });
});

test('V26 persists exact fingerprint-bound state and transports a detached clone', () => {
	const project = ofxProject();
	assert.equal(validateFramescaperProjectV26(PROFILE, project), true);
	assert.equal(project.schemaVersion, 26);
	assert.equal(project.ofxEffects.length, 1);
	const requirements = project.featureRequirements as Readonly<{
		readonly requirements: readonly Readonly<{ readonly id: string }>[];
	}>;
	assert.equal(requirements.requirements.some(({ id }) => id === 'framescaper.openfx-effects'), true);
	const clone = cloneFramescaperProjectV26(PROFILE, project);
	assert.deepEqual(clone, project);
	assert.notStrictEqual(clone.ofxEffects, project.ofxEffects);
	const transport = framescaperDesktopProjectTransportV26(PROFILE);
	assert.deepEqual(transport.decode(transport.encode(project)), project);
	const tampered = structuredClone(project) as unknown as { ofxEffects: Array<Record<string, unknown>> };
	(tampered.ofxEffects[0]!.attachment as Record<string, unknown>).targetId = 'missing-target';
	assert.throws(() => validateFramescaperProjectV26(PROFILE, tampered), /attachment target.*missing/iu);
});

test('V26 requires re-import for earlier projects and keeps future schemas opaque read-only', () => {
	const project = ofxProject();
	assert.throws(() => loadFramescaperProjectV26(PROFILE, { ...project, schemaVersion: 25 }), /re-import|reimport/iu);
	assert.deepEqual(loadFramescaperProjectV26(PROFILE, { schemaVersion: 27, opaque: true }), {
		project: { schemaVersion: 27, opaque: true },
		readOnly: true,
		intrinsicReadOnly: true,
		reason: 'newer-schema',
	});
});

test('clipboard V10 carries OFX state only with explicit fresh identity allocations', () => {
	const project = ofxProject();
	const clipboard = createFramescaperOpenFxClipboardV10(PROFILE, project, ['ofx-instance-1']);
	assert.deepEqual(normalizeFramescaperOpenFxClipboardV10(structuredClone(clipboard)), clipboard);
	assert.throws(
		() => normalizeFramescaperOpenFxClipboardV10({ ...clipboard, schemaVersion: 9 }),
		/re-copy|recopy|V10/iu,
	);
	const paste = prepareFramescaperOpenFxClipboardPasteV10(clipboard, {
		instanceIdMap: new Map([['ofx-instance-1', 'ofx-instance-pasted']]),
		projectReferenceIdMap: new Map([
			['video-clip', 'video-clip-copy'], ['video-source', 'video-source-copy'],
		]),
	});
	assert.equal(paste[0]!.instanceId, 'ofx-instance-pasted');
	assert.equal(paste[0]!.attachment.targetId, 'video-clip-copy');
	assert.equal(paste[0]!.inputs[0]!.sourceRef, 'video-source-copy');
	assert.throws(() => prepareFramescaperOpenFxClipboardPasteV10(clipboard, {
		instanceIdMap: new Map([['ofx-instance-1', 'ofx-instance-1']]),
		projectReferenceIdMap: new Map([
			['video-clip', 'video-clip-copy'], ['video-source', 'video-source-copy'],
		]),
	}), /fresh/iu);
	assert.throws(() => prepareFramescaperOpenFxClipboardPasteV10(clipboard, {
		instanceIdMap: new Map([
			['ofx-instance-1', 'ofx-instance-pasted'], ['unused', 'unused-copy'],
		]),
		projectReferenceIdMap: new Map([
			['video-clip', 'video-clip-copy'], ['video-source', 'video-source-copy'],
		]),
	}), /unused/iu);
	assert.throws(() => prepareFramescaperOpenFxClipboardPasteV10(clipboard, {
		instanceIdMap: new Map([['ofx-instance-1', 'video-clip-copy']]),
		projectReferenceIdMap: new Map([
			['video-clip', 'video-clip-copy'], ['video-source', 'video-source-copy'],
		]),
	}), /collid|unique/iu);
});

test('Scape source collision rebinding follows named inputs without blessing old freeze freshness', () => {
	const project = structuredClone(ofxProject()) as unknown as Record<string, unknown>;
	const effect = (project.ofxEffects as Array<Record<string, unknown>>)[0]!;
	const before = structuredClone(effect.freshness);
	rebindFramescaperOpenFxSourceIdentitiesV26(project, new Map([
		['video-source', 'video-source-imported'],
	]));
	assert.equal(((effect.inputs as Array<Record<string, unknown>>)[0]!.sourceRef), 'video-source');
	const rebound = (project.ofxEffects as Array<Record<string, unknown>>)[0]!;
	assert.equal(((rebound.inputs as Array<Record<string, unknown>>)[0]!.sourceRef), 'video-source-imported');
	assert.deepEqual(rebound.freshness, before, 'old freshness remains stale and can only bypass');
});

function ofxProject(): FramescaperProjectV26 {
	return createFramescaperProjectV26(PROFILE, {
		...framescaperV20Options(),
		videoTransitionsByTrackId: { 'video-track': [] },
		ofxEffects: [{
			schemaVersion: 1,
			instanceId: 'ofx-instance-1',
			pluginId: 'net.example.Blur',
			binarySha256: SHA_A,
			context: 'filter',
			attachment: { kind: 'filter', targetId: 'video-clip' },
			inputs: [{ name: 'Source', sourceRef: 'video-source' }],
			parameters: [{ name: 'radius', type: 'double', value: [2], keyframes: [] }],
			customEncodings: {},
			enabled: true,
			freshness: {
				authoredStateSha256: SHA_A,
				inputIdentitiesSha256: SHA_B,
				renderPlanFingerprintSha256: SHA_C,
				nativeEffectFingerprintSha256: SHA_D,
			},
			frozenFallback: null,
		}],
	});
}
