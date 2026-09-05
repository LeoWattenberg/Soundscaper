/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ASSISTANCE_ASSET_REFERENCE_LIMITS_V1,
	ASSISTANCE_TRANSCRIPT_BODY_MIME_TYPE_V1,
} from '../src/common/editor/assistance/assistance-asset-reference-v1.ts';
import {
	createNativeMediaImageSequenceInventoryV25,
	createNativeMediaImageSequenceSourceV25,
} from '../src/common/editor/native-media-image-sequence-v25.ts';
import { resolveNativeMediaImageSequence } from '../src/common/editor/native-media-image-sequence.ts';
import {
	createUnreportedVideoSourceCharacteristicsV25,
} from '../src/common/editor/video-source-professional-characteristics-v25.ts';
import {
	collectFramescaperDesktopAssistanceBodyReferences as collectTranscripts,
	collectFramescaperDesktopExtensionBodyReferences as collectExtensions,
	framescaperDesktopCoreBodyProject as coreBodyProject,
	validateFramescaperDesktopBodies as validateBodies,
	validateFramescaperDesktopBodyDescriptor as validateDescriptor,
	FRAMESCAPER_DESKTOP_ASSISTANCE_BODY_ENCODING as TRANSCRIPT_ENCODING,
	type FramescaperDesktopExtensionBodyReference,
} from '../src/framescaper/desktop-project-library-body-contract.ts';
import type { FramescaperProject } from '../src/framescaper/editor-project.ts';

type Data = Record<string, unknown>;
type Reference = Readonly<FramescaperDesktopExtensionBodyReference>;

const PROJECT_SHA256 = 'ab'.repeat(32);
const STILL_SHA256 = '11'.repeat(32);
const FREEZE_SHA256 = '22'.repeat(32);
const LUT_SHA256 = '33'.repeat(32);
const MOTION_SHA256 = '44'.repeat(32);
const TRANSCRIPT_SHA256 = '55'.repeat(32);
const VIDEO_SHA256 = '66'.repeat(32);
const TRANSCRIPT_KEY = `assistance-transcript-sha256:${TRANSCRIPT_SHA256}`;
const STILL_KEY = `media-sha256:${STILL_SHA256}`;
const MOTION_MIME = 'application/vnd.framescaper.motion-analysis+json';
const PACK_MIME = 'application/vnd.soundscaper.image-sequence-pack';

function projectOf(parts: Data = {}): FramescaperProject {
	return {
		sources: [], videoFreezeFallbacks: [], videoVisualPresentations: [],
		videoFinishingPresets: [], videoProcessorStacks: [], videoMotionAnalyses: [],
		assistanceAssets: [], ...parts,
	} as unknown as FramescaperProject;
}

function stillSource(id: string, sha256: string): Data {
	return {
		kind: 'still', id, name: id, mimeType: 'image/png',
		storageKey: `media-sha256:${sha256}`, contentSha256: sha256,
	};
}

function videoSource(overrides: Data = {}): Data {
	return {
		kind: 'video', id: 'video-source', name: 'take one', imageSequence: null,
		storageKey: `media-sha256:${VIDEO_SHA256}`, mimeType: 'video/mp4',
		contentSha256: VIDEO_SHA256, timingAsset: null, proxyAttachment: null, ...overrides,
	};
}

function lutPresentation(): Data {
	return {
		id: 'presentation-1',
		grade: {
			lut: {
				storageKey: `cube-lut-sha256:${LUT_SHA256}`, sha256: LUT_SHA256,
				byteLength: 4_096, size: 17, domainMin: [0, 0, 0], domainMax: [1, 1, 1],
			},
		},
	};
}

function motionAnalysis(): Data {
	return {
		id: 'motion-1', processorStackId: 'stack-1', sourceId: 'video-source',
		storageKey: `motion-analysis-sha256:${MOTION_SHA256}`, sha256: MOTION_SHA256,
		byteLength: 2_048, inputSha256: VIDEO_SHA256,
	};
}

function transcriptAsset(id: string, body: Data = {}): Data {
	return {
		id,
		body: {
			storageKey: TRANSCRIPT_KEY, mimeType: ASSISTANCE_TRANSCRIPT_BODY_MIME_TYPE_V1,
			byteLength: 512, sha256: TRANSCRIPT_SHA256, ...body,
		},
	};
}

/** Stills, a freeze render, a LUT, a motion analysis and one transcript: every extension role. */
function finishingProject(parts: Data = {}): FramescaperProject {
	return projectOf({
		sources: [stillSource('still-a', STILL_SHA256), stillSource('freeze-b', FREEZE_SHA256)],
		videoFreezeFallbacks: [{ renderedSourceId: 'freeze-b' }],
		videoVisualPresentations: [lutPresentation()],
		videoProcessorStacks: [{ id: 'stack-1' }],
		videoMotionAnalyses: [motionAnalysis()],
		assistanceAssets: [transcriptAsset('transcript-1')],
		...parts,
	});
}

function imageSequenceSource(): Data {
	const selection = resolveNativeMediaImageSequence({
		fileNames: ['frame_001.png', 'frame_002.png'], frameRate: { num: 24, den: 1 },
	});
	const inventory = createNativeMediaImageSequenceInventoryV25(selection, [
		{ fileName: 'frame_001.png', frameNumber: 1, byteLength: 101, sha256: '77'.repeat(32) },
		{ fileName: 'frame_002.png', frameNumber: 2, byteLength: 102, sha256: '88'.repeat(32) },
	]);
	const sequence = createNativeMediaImageSequenceSourceV25({
		id: 'sequence-source', name: 'Sequence', selection,
		inventory: inventory.reference,
		sourcePack: {
			kind: 'image-sequence-source-pack',
			storageKey: `image-sequence-pack-sha256:${'99'.repeat(32)}`,
			sha256: '99'.repeat(32), byteLength: 8_192,
		},
		characteristics: createUnreportedVideoSourceCharacteristicsV25(),
	});
	return videoSource({ id: 'sequence-source', imageSequence: sequence });
}

/** The one descriptor the project authority admits for a collected extension reference. */
function descriptorFor(reference: Reference, overrides: Data = {}): Data {
	return {
		kind: reference.kind, encoding: reference.encoding,
		sourceId: reference.storageKey, storageKey: reference.storageKey,
		mimeType: reference.mimeType, byteLength: reference.byteLength ?? 1_024,
		sha256: reference.sha256, ...overrides,
	};
}

function inventoryOf(project: FramescaperProject): Data[] {
	return collectExtensions(project).map((reference) => descriptorFor(reference));
}

function stillBody(overrides: Data = {}): Data {
	return {
		kind: 'framescaper-still', encoding: 'still-image-v1',
		sourceId: STILL_KEY, storageKey: STILL_KEY, mimeType: 'image/png',
		byteLength: 1_024, sha256: STILL_SHA256, ...overrides,
	};
}

test('a still descriptor is returned frozen with exactly the closed baseline body fields', () => {
	const result = validateDescriptor(stillBody());
	assert.deepEqual({ ...result }, {
		kind: 'framescaper-still', encoding: 'still-image-v1',
		sourceId: STILL_KEY, storageKey: STILL_KEY, mimeType: 'image/png',
		byteLength: 1_024, sha256: STILL_SHA256,
	});
	assert.equal(Object.isFrozen(result), true);
	assert.equal(Object.hasOwn(result, 'bindingId'), false);
	assert.equal(validateDescriptor(Object.assign(Object.create(null), stillBody())).sha256, STILL_SHA256);
});

test('a body kind outside the base and extension inventory is refused', () => {
	assert.throws(() => validateDescriptor(stillBody({ kind: 'project-document' })),
		/baseline body kind is unsupported/u);
	assert.throws(() => validateDescriptor(stillBody({ kind: 42 })),
		/baseline body kind is unsupported/u);
	assert.throws(() => validateDescriptor(null), /kind requires a record/u);
	assert.throws(() => validateDescriptor([stillBody()]), /kind must be an own enumerable data property/u);
});

test('a body descriptor must be a plain closed record carrying every baseline field once', () => {
	const framed = Object.assign(Object.create({}) as Data, stillBody());
	assert.throws(() => validateDescriptor(framed), /baseline body descriptor must be a plain record/u);
	const { mimeType, ...missing } = stillBody();
	assert.equal(typeof mimeType, 'string');
	assert.throws(() => validateDescriptor(missing), /baseline body descriptor has missing or unsupported fields/u);
	assert.throws(() => validateDescriptor(stillBody({ bindingId: `p${STILL_SHA256}` })),
		/baseline body descriptor has missing or unsupported fields/u);
});

test('a body field defined as an accessor or hidden from enumeration is not an own data property', () => {
	const accessor = stillBody();
	delete accessor.kind;
	Object.defineProperty(accessor, 'kind', { enumerable: true, get: () => 'framescaper-still' });
	assert.throws(() => validateDescriptor(accessor), /kind must be an own enumerable data property/u);

	const hidden = stillBody();
	Object.defineProperty(hidden, 'sha256', { enumerable: false, value: STILL_SHA256 });
	assert.throws(() => validateDescriptor(hidden), /sha256 must be an own enumerable data property/u);
});

test('each extension kind is bound to exactly one encoding', () => {
	assert.throws(() => validateDescriptor(stillBody({ encoding: 'freeze-render-v1' })),
		/baseline desktop framescaper-still encoding is unsupported/u);
	assert.throws(() => validateDescriptor(stillBody({
		kind: 'framescaper-cube-lut', encoding: 'still-image-v1', mimeType: 'text/plain',
	})), /baseline desktop framescaper-cube-lut encoding is unsupported/u);
	assert.throws(() => validateDescriptor(stillBody({ encoding: '' })),
		/baseline desktop body encoding is invalid/u);
});

test('a body whose source id differs from its storage key is refused as an invalid identity', () => {
	assert.throws(() => validateDescriptor(stillBody({ sourceId: 'other-key' })),
		/baseline body identity is invalid/u);
	assert.throws(() => validateDescriptor(stillBody({ sourceId: '' })),
		/baseline desktop body source id is invalid/u);
	assert.throws(() => validateDescriptor(stillBody({
		sourceId: 'x'.repeat(4_097), storageKey: 'x'.repeat(4_097),
	})), /baseline desktop body source id is invalid/u);
});

test('a proxy body carries a bound proxy binding identity the other kinds do not', () => {
	const proxyKey = `video-proxy-sha256:${VIDEO_SHA256}`;
	const proxy = (overrides: Data = {}): Data => ({
		kind: 'video-proxy', encoding: 'video-proxy-v1', bindingId: `p${VIDEO_SHA256}`,
		sourceId: proxyKey, storageKey: proxyKey, mimeType: 'video/mp4',
		byteLength: 2_048, sha256: VIDEO_SHA256, ...overrides,
	});
	assert.equal(validateDescriptor(proxy()).bindingId, `p${VIDEO_SHA256}`);
	assert.throws(() => validateDescriptor(proxy({ bindingId: `q${VIDEO_SHA256}` })),
		/baseline body identity is invalid/u);
	const { bindingId, ...withoutBinding } = proxy();
	assert.equal(typeof bindingId, 'string');
	assert.throws(() => validateDescriptor(withoutBinding),
		/baseline body descriptor has missing or unsupported fields/u);
});

test('a body digest and byte length are bounded before any body read', () => {
	assert.throws(() => validateDescriptor(stillBody({ sha256: 'AB'.repeat(32) })),
		/baseline desktop body digest is invalid/u);
	assert.throws(() => validateDescriptor(stillBody({ sha256: 'ab'.repeat(31) })),
		/baseline desktop body digest is invalid/u);
	assert.throws(() => validateDescriptor(stillBody({ byteLength: 0 })), RangeError);
	assert.throws(() => validateDescriptor(stillBody({ byteLength: 1.5 })), RangeError);
	assert.throws(() => validateDescriptor(stillBody({ byteLength: 64 * 1024 * 1024 * 1024 + 1 })),
		/baseline desktop body length is invalid/u);
});

test('the still and freeze-render roles are bounded by image media type and image size', () => {
	assert.throws(() => validateDescriptor(stillBody({ mimeType: 'application/octet-stream' })),
		/baseline desktop framescaper-still exceeds its image role bound/u);
	assert.throws(() => validateDescriptor(stillBody({ byteLength: 512 * 1024 * 1024 + 1 })),
		/baseline desktop framescaper-still exceeds its image role bound/u);
	const freeze = stillBody({ kind: 'framescaper-freeze-render', encoding: 'freeze-render-v1' });
	assert.equal(validateDescriptor(freeze).kind, 'framescaper-freeze-render');
	assert.throws(() => validateDescriptor({ ...freeze, mimeType: 'text/plain' }),
		/baseline desktop framescaper-freeze-render exceeds its image role bound/u);
});

test('the LUT, motion and image-sequence roles are bounded by their own media types and sizes', () => {
	const lut = stillBody({
		kind: 'framescaper-cube-lut', encoding: 'cube-lut-v1', mimeType: 'text/plain',
	});
	assert.equal(validateDescriptor(lut).mimeType, 'text/plain');
	assert.throws(() => validateDescriptor({ ...lut, byteLength: 16 * 1024 * 1024 + 1 }),
		/cube LUT exceeds its role bound/u);
	assert.throws(() => validateDescriptor({ ...lut, mimeType: 'text/csv' }),
		/cube LUT exceeds its role bound/u);

	const motion = stillBody({
		kind: 'framescaper-motion-analysis', encoding: 'motion-analysis-json-v1', mimeType: MOTION_MIME,
	});
	assert.equal(validateDescriptor(motion).mimeType, MOTION_MIME);
	assert.throws(() => validateDescriptor({ ...motion, byteLength: 1024 * 1024 * 1024 + 1 }),
		/motion analysis exceeds its role bound/u);
	assert.throws(() => validateDescriptor({ ...motion, mimeType: 'application/json' }),
		/motion analysis exceeds its role bound/u);

	const inventory = stillBody({
		kind: 'image-sequence-inventory', encoding: 'framescaper-image-sequence-inventory-v1',
		mimeType: 'application/json',
	});
	assert.equal(validateDescriptor(inventory).kind, 'image-sequence-inventory');
	assert.throws(() => validateDescriptor({ ...inventory, byteLength: 64 * 1024 * 1024 + 1 }),
		/image-sequence inventory exceeds its role bound/u);

	const pack = stillBody({
		kind: 'image-sequence-source-pack', encoding: 'framescaper-image-sequence-source-pack-v1',
		mimeType: PACK_MIME,
	});
	assert.equal(validateDescriptor(pack).mimeType, PACK_MIME);
	assert.throws(() => validateDescriptor({ ...pack, mimeType: 'application/zip' }),
		/image-sequence source pack has an unsupported media type/u);
});

test('a transcript descriptor is normalized only when its storage key derives from its own digest', () => {
	const transcript = (overrides: Data = {}): Data => ({
		kind: 'assistance-transcript', encoding: TRANSCRIPT_ENCODING,
		sourceId: TRANSCRIPT_KEY, storageKey: TRANSCRIPT_KEY,
		mimeType: ASSISTANCE_TRANSCRIPT_BODY_MIME_TYPE_V1, byteLength: 512,
		sha256: TRANSCRIPT_SHA256, ...overrides,
	});
	assert.deepEqual({ ...validateDescriptor(transcript()) }, transcript());
	assert.throws(() => validateDescriptor(transcript({ storageKey: `assistance-transcript-sha256:${VIDEO_SHA256}` })),
		/transcript descriptor is invalid/u);
	assert.throws(() => validateDescriptor(transcript({ sourceId: 'assistance-transcript' })),
		/transcript descriptor is invalid/u);
	assert.throws(() => validateDescriptor(transcript({ encoding: 'assistance-transcript-v2' })),
		/transcript descriptor is invalid/u);
	assert.throws(() => validateDescriptor(transcript({ mimeType: 'application/json' })),
		/transcript descriptor is invalid/u);
	assert.throws(() => validateDescriptor(transcript({
		byteLength: ASSISTANCE_ASSET_REFERENCE_LIMITS_V1.maximumBodyBytes + 1,
	})), /transcript descriptor is invalid/u);
	assert.throws(() => validateDescriptor(transcript({ bindingId: `p${TRANSCRIPT_SHA256}` })),
		/transcript body has missing or unsupported fields/u);
});

test('extension references are collected as finishing bodies, then professional roots, then transcripts', () => {
	const references = collectExtensions(finishingProject());
	assert.deepEqual(references.map(({ kind }) => kind), [
		'framescaper-still', 'framescaper-freeze-render', 'framescaper-cube-lut',
		'framescaper-motion-analysis', 'assistance-transcript',
	]);
	assert.deepEqual(references.map(({ name }) => name), [
		'still:framescaper:still:still-a', 'freeze-render:framescaper:freeze-render:freeze-b',
		`lut:framescaper:lut:${LUT_SHA256}`, `motion:framescaper:motion:${MOTION_SHA256}`,
		`assistance:transcript:${TRANSCRIPT_KEY}`,
	]);
	assert.equal(references[0]?.byteLength, null, 'a still body carries no project-bound length');
	assert.equal(references[0]?.maximumBytes, 512 * 1024 * 1024);
	assert.equal(references[0]?.archiveReference?.role, 'still');
	assert.equal(references[0]?.professionalReference, null);
	assert.equal(references[4]?.maximumBytes, ASSISTANCE_ASSET_REFERENCE_LIMITS_V1.maximumBodyBytes);
	assert.equal(Object.isFrozen(references), true);
});

test('an image-sequence source contributes its inventory and source pack as professional roots', () => {
	const references = collectExtensions(projectOf({ sources: [imageSequenceSource()] }));
	assert.deepEqual(references.map(({ kind }) => kind),
		['image-sequence-inventory', 'image-sequence-source-pack']);
	assert.deepEqual(references.map(({ mimeType }) => mimeType), ['application/json', PACK_MIME]);
	assert.equal(references[1]?.storageKey, `image-sequence-pack-sha256:${'99'.repeat(32)}`);
	assert.equal(references[1]?.byteLength, 8_192);
	assert.equal(references[1]?.maximumBytes, 8_192, 'a professional root is bounded by its own size');
	assert.equal(references[1]?.archiveReference, null);
	assert.equal(references[1]?.professionalReference?.kind, 'image-sequence-source-pack');
});

test('the proxy and proxy-timing archive roles stay out of the extension inventory', () => {
	const project = projectOf({ sources: [videoSource(), stillSource('still-a', STILL_SHA256)] });
	assert.deepEqual(collectExtensions(project).map(({ kind }) => kind), ['framescaper-still']);
});

test('transcript references are deduplicated by storage key and keep the first asset that named them', () => {
	const references = collectTranscripts(projectOf({
		assistanceAssets: [transcriptAsset('transcript-1'), transcriptAsset('transcript-2')],
	}));
	assert.equal(references.length, 1);
	assert.equal(references[0]?.name, 'assistance:transcript:transcript-1');
	assert.deepEqual({ ...references[0]?.descriptor }, {
		kind: 'assistance-transcript', encoding: TRANSCRIPT_ENCODING,
		sourceId: TRANSCRIPT_KEY, storageKey: TRANSCRIPT_KEY,
		mimeType: ASSISTANCE_TRANSCRIPT_BODY_MIME_TYPE_V1, byteLength: 512, sha256: TRANSCRIPT_SHA256,
	});
	assert.deepEqual(collectTranscripts(projectOf()), []);
});

test('two transcript assets that disagree about one transcript body are refused', () => {
	assert.throws(() => collectTranscripts(projectOf({
		assistanceAssets: [transcriptAsset('transcript-1'), transcriptAsset('transcript-2', { byteLength: 513 })],
	})), new RegExp(`Transcript body ${TRANSCRIPT_KEY} has conflicting references`, 'u'));
});

test('the core body project drops image-sequence sources and leaves the original project untouched', () => {
	const sequence = imageSequenceSource();
	const project = projectOf({ sources: [videoSource(), sequence, stillSource('still-a', STILL_SHA256)] });
	const core = coreBodyProject(project) as unknown as { readonly sources: readonly Data[] };
	assert.deepEqual(core.sources.map((source) => source.id), ['video-source']);
	assert.equal((project.sources as unknown as readonly Data[]).length, 3);
	assert.notEqual(core.sources[0], (project.sources as unknown as readonly Data[])[0]);
});

test('an empty project validates an empty body inventory against its project digest', () => {
	assert.deepEqual(validateBodies(projectOf(), PROJECT_SHA256, []), []);
	assert.throws(() => validateBodies(projectOf(), 'not-a-digest', []),
		/baseline desktop project digest is invalid/u);
});

test('a body inventory must be a bounded dense array', () => {
	assert.throws(() => validateBodies(projectOf(), PROJECT_SHA256, 'bodies'),
		/baseline bodies must be a bounded dense array/u);
	const sparse: unknown[] = [];
	sparse.length = 2;
	assert.throws(() => validateBodies(projectOf(), PROJECT_SHA256, sparse),
		/baseline bodies must be a bounded dense array/u);
	const named = [stillBody()] as unknown as Data;
	named.extra = 'tail';
	assert.throws(() => validateBodies(projectOf(), PROJECT_SHA256, named),
		/baseline bodies must be a bounded dense array/u);
	assert.throws(
		() => validateBodies(projectOf(), PROJECT_SHA256, Array.from({ length: 5_119 }, () => null)),
		/baseline bodies must be a bounded dense array/u,
	);
});

test('the complete finishing inventory validates in canonical project order', () => {
	const project = finishingProject();
	const supplied = inventoryOf(project);
	const validated = validateBodies(project, PROJECT_SHA256, supplied);
	assert.deepEqual(validated.map(({ kind }) => kind), supplied.map(({ kind }) => kind));
	assert.deepEqual(validated.map(({ storageKey }) => storageKey), supplied.map(({ storageKey }) => storageKey));
	assert.equal(Object.isFrozen(validated), true);
});

test('core bodies precede the extension inventory in the canonical body order', () => {
	const project = finishingProject({
		sources: [videoSource(), stillSource('still-a', STILL_SHA256), stillSource('freeze-b', FREEZE_SHA256)],
	});
	const original: Data = {
		kind: 'video-original', encoding: 'framescaper-video-original-v1',
		sourceId: `media-sha256:${VIDEO_SHA256}`, storageKey: `media-sha256:${VIDEO_SHA256}`,
		mimeType: 'video/mp4', byteLength: 4_096, sha256: VIDEO_SHA256,
	};
	const extensions = inventoryOf(project);
	assert.deepEqual(
		validateBodies(project, PROJECT_SHA256, [original, ...extensions]).map(({ kind }) => kind),
		['video-original', 'framescaper-still', 'framescaper-freeze-render',
			'framescaper-cube-lut', 'framescaper-motion-analysis', 'assistance-transcript'],
	);
	assert.throws(() => validateBodies(project, PROJECT_SHA256, [...extensions, original]),
		/body inventory order or role changed/u);
});

test('a finishing body the project requires but the inventory omits is refused as missing', () => {
	const project = finishingProject();
	const [, ...withoutStill] = inventoryOf(project);
	assert.throws(() => validateBodies(project, PROJECT_SHA256, withoutStill),
		/baseline desktop framescaper-still body is missing/u);
	assert.throws(() => validateBodies(project, PROJECT_SHA256, []),
		/baseline desktop framescaper-still body is missing/u);
});

test('a duplicated finishing body is refused before the inventory is bound to the project', () => {
	const project = finishingProject();
	const supplied = inventoryOf(project);
	assert.throws(() => validateBodies(project, PROJECT_SHA256, [supplied[0]!, ...supplied]),
		new RegExp(`baseline desktop body ${STILL_KEY} is duplicated`, 'u'));
});

test('a finishing body the project never referenced is refused as unbound', () => {
	const project = finishingProject();
	const stray = stillBody({
		sourceId: `media-sha256:${VIDEO_SHA256}`, storageKey: `media-sha256:${VIDEO_SHA256}`,
		sha256: VIDEO_SHA256,
	});
	assert.throws(() => validateBodies(project, PROJECT_SHA256, [...inventoryOf(project), stray]),
		/inventory contains an unbound finishing body/u);
});

test('a descriptor that conflicts with project authority on digest, media type or size is refused', () => {
	const project = finishingProject();
	const references = collectExtensions(project);
	const conflict = (index: number, overrides: Data): Data[] => references.map((reference, position) => (
		descriptorFor(reference, position === index ? overrides : {})
	));
	assert.throws(() => validateBodies(project, PROJECT_SHA256, conflict(0, { mimeType: 'image/jpeg' })),
		/baseline desktop framescaper-still descriptor conflicts with project authority/u);
	assert.throws(() => validateBodies(project, PROJECT_SHA256, conflict(2, { byteLength: 8_192 })),
		/baseline desktop framescaper-cube-lut descriptor conflicts with project authority/u);
	assert.throws(() => validateBodies(project, PROJECT_SHA256, conflict(3, { sha256: VIDEO_SHA256 })),
		/baseline desktop framescaper-motion-analysis descriptor conflicts with project authority/u);
	assert.throws(() => validateBodies(project, PROJECT_SHA256, conflict(4, { byteLength: 511 })),
		/baseline desktop assistance-transcript descriptor conflicts with project authority/u);
});

test('a professional root descriptor larger than the size the project recorded is refused', () => {
	const project = projectOf({ sources: [imageSequenceSource()] });
	const references = collectExtensions(project);
	const supplied = references.map((reference, index) => descriptorFor(
		reference, index === 1 ? { byteLength: (reference.byteLength ?? 0) + 1 } : {},
	));
	assert.throws(() => validateBodies(project, PROJECT_SHA256, supplied),
		/baseline desktop image-sequence-source-pack descriptor conflicts with project authority/u);
});

test('a project whose motion analysis has no processor stack cannot describe its extension bodies', () => {
	assert.throws(() => collectExtensions(finishingProject({ videoProcessorStacks: [] })),
		/motion analysis motion-1 has no processor stack/u);
});
