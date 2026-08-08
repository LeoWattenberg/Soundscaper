/* SPDX-License-Identifier: AGPL-3.0-only */

export const DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_MODE = 'project-library-source-bearing-handoff-v1';
export const MAX_DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_PLAN_BYTES = 64 * 1024;
export const DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_WORKFLOW_IDS = Object.freeze([
	'electron-soundscaper-to-framescaper-to-soundscaper-library',
	'electron-framescaper-to-soundscaper-to-framescaper-library',
]);

const SHA256 = /^[a-f\d]{64}$/u;
const BINDING_ID = /^[mv][a-f\d]{64}$/u;
const STAGES = Object.freeze(['publish', 'advance', 'return']);
const WORKFLOW_DEFINITIONS = Object.freeze([
	Object.freeze({
		id: DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_WORKFLOW_IDS[0],
		projectPrefix: 'packaged-sound-roundtrip',
		products: Object.freeze(['soundscaper', 'framescaper', 'soundscaper']),
		title: 'Packaged Soundscaper mixed-media roundtrip',
	}),
	Object.freeze({
		id: DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_WORKFLOW_IDS[1],
		projectPrefix: 'packaged-frame-roundtrip',
		products: Object.freeze(['framescaper', 'soundscaper', 'framescaper']),
		title: 'Packaged Framescaper mixed-media roundtrip',
	}),
]);

const WORKFLOWS = Object.freeze(WORKFLOW_DEFINITIONS.map(createWorkflow));

export function createDesktopProjectLibrarySourceBearingWorkflows() {
	return WORKFLOWS;
}

export function createDesktopProjectLibrarySourceBearingPlan({
	workflowId,
	stage,
	previous,
}) {
	const workflow = workflowFor(workflowId);
	const stageIndex = STAGES.indexOf(stage);
	if (stageIndex < 0) throw new TypeError('Source-bearing packaged handoff stage is invalid');
	if (stage === 'publish' && previous !== null) {
		throw new TypeError('Source-bearing packaged publish stage requires a null previous result');
	}
	if (stage !== 'publish' && previous === null) {
		throw new TypeError(`Source-bearing packaged ${stage} stage requires a previous result`);
	}
	const normalizedPrevious = previous === null ? null : validatePrevious(previous, workflow);
	return deepFreeze({
		schemaVersion: 1,
		mode: DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_MODE,
		workflowId: workflow.id,
		stage,
		productId: workflow.stages[stageIndex].productId,
		previous: normalizedPrevious,
		seed: workflow.seed,
	});
}

export function encodeDesktopProjectLibrarySourceBearingPlan(value) {
	const encoded = Buffer.from(canonicalJson(value), 'utf8').toString('base64url');
	if (Buffer.byteLength(encoded, 'utf8') > MAX_DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_PLAN_BYTES) {
		throw new RangeError('Source-bearing packaged handoff plan exceeds the 64 KiB command-line limit');
	}
	return encoded;
}

export function decodeDesktopProjectLibrarySourceBearingPlan(value) {
	if (typeof value !== 'string' || !value || !/^[A-Za-z0-9_-]+$/u.test(value)) {
		throw new TypeError('Source-bearing packaged handoff plan must be canonical base64url');
	}
	if (Buffer.byteLength(value, 'utf8') > MAX_DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_PLAN_BYTES) {
		throw new RangeError('Source-bearing packaged handoff plan exceeds the 64 KiB command-line limit');
	}
	let plan;
	try {
		plan = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
	} catch (error) {
		throw new TypeError('Source-bearing packaged handoff plan is not valid base64url JSON', { cause: error });
	}
	assertExactKeys(
		plan,
		['schemaVersion', 'mode', 'workflowId', 'stage', 'productId', 'previous', 'seed'],
		'source-bearing packaged handoff plan',
	);
	if (plan.schemaVersion !== 1 || plan.mode !== DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_MODE) {
		throw new TypeError('Source-bearing packaged handoff plan has an unsupported schema or mode');
	}
	const admitted = createDesktopProjectLibrarySourceBearingPlan(plan);
	if (canonicalJson(admitted) !== canonicalJson(plan)
		|| encodeDesktopProjectLibrarySourceBearingPlan(admitted) !== value) {
		throw new TypeError('Source-bearing packaged handoff plan is not canonical or fixed');
	}
	return admitted;
}

export function validateDesktopProjectLibrarySourceBearingResult(value, planValue) {
	const plan = createDesktopProjectLibrarySourceBearingPlan(planValue);
	if (canonicalJson(plan) !== canonicalJson(planValue)) {
		throw new TypeError('Source-bearing packaged result plan is not fixed');
	}
	assertExactKeys(value, [
		'schemaVersion', 'mode', 'workflowId', 'stage', 'productId', 'project', 'sources',
		'ui', 'host', 'catalogRevision',
	], 'source-bearing packaged handoff result');
	if (value.schemaVersion !== 1 || value.mode !== DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_MODE
		|| value.workflowId !== plan.workflowId || value.stage !== plan.stage
		|| value.productId !== plan.productId) {
		throw new TypeError('Source-bearing packaged handoff result identity is invalid');
	}
	const project = validateResultProject(value.project, plan);
	const sources = validateResultSources(value.sources, plan);
	const ui = validateResultUi(value.ui, plan, sources);
	const host = validateResultHost(value.host, plan);
	if (!Number.isSafeInteger(value.catalogRevision) || value.catalogRevision < 1) {
		throw new TypeError('Source-bearing packaged handoff result catalog revision is invalid');
	}
	return deepFreeze({
		schemaVersion: 1,
		mode: DESKTOP_PROJECT_LIBRARY_SOURCE_BEARING_MODE,
		workflowId: plan.workflowId,
		stage: plan.stage,
		productId: plan.productId,
		project,
		sources,
		ui,
		host,
		catalogRevision: value.catalogRevision,
	});
}

function createWorkflow(definition) {
	const seed = createSeed(definition);
	return deepFreeze({
		id: definition.id,
		seed,
		stages: STAGES.map((stage, index) => ({
			stage,
			productId: definition.products[index],
			profileId: definition.products[index],
		})),
	});
}

function createSeed(definition) {
	const projectId = `${definition.projectPrefix}-project`;
	const audio = Object.freeze({
		sourceId: `${definition.projectPrefix}-audio`,
		storageKey: `${definition.projectPrefix}-audio-pcm`,
		clipId: `${definition.projectPrefix}-audio-clip`,
		trackId: `${definition.projectPrefix}-audio-track`,
		frameCount: 4_800,
		channelCount: 1,
		sampleRate: 48_000,
	});
	const video = Object.freeze({
		sourceId: `${definition.projectPrefix}-video`,
		storageKey: `${definition.projectPrefix}-video-original`,
		clipId: `${definition.projectPrefix}-video-clip`,
		trackId: `${definition.projectPrefix}-video-track`,
		binClipId: `${definition.projectPrefix}-bin-video`,
		binItemId: `${definition.projectPrefix}-bin-item`,
		frameCount: 48_000,
		sampleRate: 48_000,
		width: 64,
		height: 36,
		frameRate: 30,
	});
	return deepFreeze({
		projectId,
		title: definition.title,
		document: createProjectDocument({ projectId, title: definition.title, audio, video, workflowId: definition.id }),
		audio,
		video,
		advanceTrackName: `Edited in ${definition.products[1] === 'framescaper' ? 'Framescaper' : 'Soundscaper'}`,
	});
}

function createProjectDocument({ projectId, title, audio, video, workflowId }) {
	return JSON.stringify({
		schemaVersion: 9,
		id: projectId,
		title,
		revision: 1,
		createdAt: '2026-08-08T12:00:00.000Z',
		updatedAt: '2026-08-08T12:00:00.000Z',
		sampleRate: 48_000,
		masterChannels: 2,
		tempo: { bpm: 120, timeSignature: { numerator: 4, denominator: 4 }, detected: false },
		snap: { enabled: false, unit: 'seconds', mode: 'nearest', triplets: false, division: 'seconds', opaqueType: 0 },
		timeDisplay: { format: 'hh:mm:ss+milliseconds' },
		metadata: {
			title, artist: '', album: '', trackNumber: '', year: '', comments: '', tags: {}, bext: null, adm: null,
		},
		selection: { startFrame: 0, endFrame: 0, trackIds: [], clipIds: [], frequencyRange: null },
		loop: { enabled: false, startFrame: 0, endFrame: 0 },
		view: {
			scrollFrame: 0, pixelsPerSecond: 100, playheadFrame: 0, zoom: 100,
			horizontalPosition: 0, verticalPosition: 0, selectedTrackIds: [], panelState: {},
		},
		sources: [
			{
				id: audio.sourceId, name: 'Packaged tone.wav', mimeType: 'audio/wav',
				storageKey: audio.storageKey, frameCount: audio.frameCount,
				channelCount: audio.channelCount, sampleRate: audio.sampleRate,
				originalSampleRate: audio.sampleRate, sampleFormat: 'float32',
				chunkFrames: audio.frameCount, opaqueExtensions: {}, kind: 'audio',
			},
			{
				kind: 'video', id: video.sourceId, name: 'Packaged picture.webm', mimeType: 'video/webm',
				storageKey: video.storageKey, frameCount: video.frameCount, sampleRate: video.sampleRate,
				width: video.width, height: video.height, frameRate: video.frameRate,
				videoCodec: 'vp8', audioCodec: null, hasAudio: false,
				posterStorageKey: null, thumbnailStorageKey: null, opaqueExtensions: {},
			},
		],
		clips: [
			{
				id: audio.clipId, sourceId: audio.sourceId, title: 'Exact packaged tone',
				timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: audio.frameCount,
				durationFrames: audio.frameCount, trimStartFrames: 0, trimEndFrames: 0,
				gain: 1, fadeInFrames: 0, fadeOutFrames: 0, reversed: false, envelope: [],
				groupId: null, color: 'auto', pitchCents: 0, speedRatio: 1,
				preserveFormants: false, stretchToTempo: false, renderCacheRevision: 0,
				opaqueExtensions: {}, kind: 'audio', avLinkId: null, binItemId: null,
			},
			videoClip(video, false),
		],
		tracks: [
			{
				type: 'audio', id: audio.trackId, name: 'Packaged sound', gain: 1, pan: 0,
				mute: false, solo: false, armed: false, displayMode: 'waveform', color: 'blue',
				spectrogram: {
					scale: 'mel', minimumFrequency: 0, maximumFrequency: 20_000,
					windowSize: 2_048, windowType: 'hann', gain: 20, range: 80,
				},
				envelope: [], effectsActive: true, effects: [], clipIds: [audio.clipId],
				collapsed: false, height: 160, opaqueExtensions: {}, laneGroupId: null,
			},
			{
				type: 'video', id: video.trackId, name: 'Packaged picture', clipIds: [video.clipId],
				mute: false, hidden: false, collapsed: false, height: 120,
				laneGroupId: null, opaqueExtensions: {},
			},
		],
		master: {
			gain: 1, pan: 0, mute: false, solo: false, envelope: [],
			collapsed: true, effectsActive: true, effects: [],
		},
		mixer: { groups: [], sends: [], routes: {} },
		opaqueExtensions: { roadmapWorkflow: workflowId },
		projectBin: { clips: [videoClip(video, true)] },
		featureRequirements: { schemaVersion: 2, requirements: [] },
	});
}

function videoClip(video, projectBin) {
	return {
		kind: 'video', id: projectBin ? video.binClipId : video.clipId, sourceId: video.sourceId,
		title: projectBin ? 'Packaged picture master' : 'Exact packaged picture',
		timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: video.frameCount,
		durationFrames: video.frameCount, trimStartFrames: 0, trimEndFrames: 0,
		groupId: null, color: 'auto', speedRatio: 1, avLinkId: null,
		binItemId: projectBin ? video.binItemId : null, opaqueExtensions: {}, videoEffects: [],
	};
}

function validatePrevious(value, workflow) {
	assertExactKeys(value, ['project', 'sources'], 'source-bearing previous result');
	assertExactKeys(value.project, ['id', 'title', 'revision', 'sha256'], 'source-bearing previous project');
	if (value.project.id !== workflow.seed.projectId
		|| typeof value.project.title !== 'string' || !value.project.title
		|| !Number.isSafeInteger(value.project.revision) || value.project.revision < 1
		|| typeof value.project.sha256 !== 'string' || !SHA256.test(value.project.sha256)) {
		throw new TypeError('Source-bearing previous project descriptor is invalid');
	}
	if (!Array.isArray(value.sources) || value.sources.length !== 2) {
		throw new TypeError('Source-bearing previous result requires exact audio and video descriptors');
	}
	const expected = [workflow.seed.audio, workflow.seed.video];
	const sources = value.sources.map((source, index) => validateManagedSource(source, expected[index], index));
	return deepFreeze({ project: { ...value.project }, sources });
}

function validateResultProject(value, plan) {
	assertExactKeys(value, ['id', 'title', 'revision', 'sha256'], 'source-bearing result project');
	const previous = plan.previous?.project ?? null;
	const expectedRevision = plan.stage === 'publish' ? 1
		: plan.stage === 'advance' ? previous.revision + 1 : previous.revision;
	if (value.id !== plan.seed.projectId || value.title !== plan.seed.title
		|| value.revision !== expectedRevision
		|| typeof value.sha256 !== 'string' || !SHA256.test(value.sha256)
		|| (plan.stage === 'advance' && value.sha256 === previous.sha256)
		|| (plan.stage === 'return' && canonicalJson(value) !== canonicalJson(previous))) {
		throw new TypeError('Source-bearing packaged handoff result project or revision is invalid');
	}
	return Object.freeze({ ...value });
}

function validateResultSources(value, plan) {
	const sources = validatePrevious({
		project: {
			id: plan.seed.projectId,
			title: plan.seed.title,
			revision: 1,
			sha256: '0'.repeat(64),
		},
		sources: value,
	}, workflowFor(plan.workflowId)).sources;
	if (plan.previous) {
		for (const [index, source] of sources.entries()) {
			const previous = plan.previous.sources[index];
			if (source.kind !== previous.kind || source.encoding !== previous.encoding
				|| source.sourceId !== previous.sourceId || source.storageKey !== previous.storageKey
				|| source.byteLength !== previous.byteLength || source.sha256 !== previous.sha256) {
				throw new TypeError('Source-bearing packaged handoff result media changed across products');
			}
			if (plan.stage === 'advance' && source.bindingId === previous.bindingId) {
				throw new TypeError('Source-bearing packaged advance result did not rebind managed media');
			}
		}
		if (plan.stage === 'return' && canonicalJson(sources) !== canonicalJson(plan.previous.sources)) {
			throw new TypeError('Source-bearing packaged return result changed its managed bindings');
		}
	}
	return sources;
}

function validateResultUi(value, plan, sources) {
	assertExactKeys(value, [
		'activeProjectId', 'audioTrackName', 'clipCount', 'handoffInvoked', 'playbackStarted',
		'playbackStopped', 'productId', 'projectBinSourceId', 'trackCount', 'videoSha256',
	], 'source-bearing packaged handoff UI result');
	const expectedTrackName = plan.stage === 'publish' ? 'Packaged sound' : plan.seed.advanceTrackName;
	if (value.activeProjectId !== plan.seed.projectId || value.productId !== plan.productId
		|| value.trackCount !== 2 || value.clipCount !== 2
		|| value.projectBinSourceId !== plan.seed.video.sourceId
		|| value.videoSha256 !== sources[1].sha256
		|| value.audioTrackName !== expectedTrackName
		|| value.playbackStarted !== true || value.playbackStopped !== true
		|| value.handoffInvoked !== (plan.stage !== 'return')) {
		throw new TypeError('Source-bearing packaged handoff UI playback, video, track, or handoff result is invalid');
	}
	return Object.freeze({ ...value });
}

function validateResultHost(value, plan) {
	assertExactKeys(
		value,
		['owner', 'fencingToken', 'tookOverStaleLease', 'recovery'],
		'source-bearing packaged handoff host result',
	);
	assertExactKeys(value.owner, ['product'], 'source-bearing packaged handoff host owner');
	assertExactKeys(value.recovery, ['outcome'], 'source-bearing packaged handoff recovery result');
	if (value.owner.product !== plan.productId
		|| !Number.isSafeInteger(value.fencingToken) || value.fencingToken < 1
		|| value.tookOverStaleLease !== false || value.recovery.outcome !== 'clean') {
		throw new TypeError('Source-bearing packaged handoff host result is invalid');
	}
	return Object.freeze({
		owner: Object.freeze({ product: value.owner.product }),
		fencingToken: value.fencingToken,
		tookOverStaleLease: false,
		recovery: Object.freeze({ outcome: 'clean' }),
	});
}

function validateManagedSource(value, expected, index) {
	assertExactKeys(
		value,
		['bindingId', 'byteLength', 'encoding', 'kind', 'sha256', 'sourceId', 'storageKey'],
		'source-bearing managed source',
	);
	const kind = index === 0 ? 'audio' : 'video';
	const encoding = kind === 'audio' ? 'audio-f32le-chunks-v1' : 'video-original-v1';
	const exactAudioBytes = 4 + expected.frameCount * expected.channelCount * Float32Array.BYTES_PER_ELEMENT;
	if (value.kind !== kind || value.encoding !== encoding
		|| value.sourceId !== expected.sourceId || value.storageKey !== expected.storageKey
		|| typeof value.bindingId !== 'string' || !BINDING_ID.test(value.bindingId)
		|| value.bindingId[0] !== (kind === 'audio' ? 'm' : 'v')
		|| !Number.isSafeInteger(value.byteLength) || value.byteLength < 1
		|| (kind === 'audio' && value.byteLength !== exactAudioBytes)
		|| typeof value.sha256 !== 'string' || !SHA256.test(value.sha256)) {
		throw new TypeError(`Source-bearing previous ${kind} descriptor is invalid`);
	}
	return Object.freeze({ ...value });
}

function workflowFor(id) {
	const workflow = WORKFLOWS.find((candidate) => candidate.id === id);
	if (!workflow) throw new TypeError('Source-bearing packaged handoff workflow is invalid');
	return workflow;
}

function assertExactKeys(value, expected, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype
		|| canonicalJson(Object.keys(value).sort()) !== canonicalJson([...expected].sort())) {
		throw new TypeError(`${label} must be a closed plain object`);
	}
}

function canonicalJson(value, active = new Set()) {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new TypeError('Source-bearing canonical JSON requires finite numbers');
		return JSON.stringify(value);
	}
	if (!value || typeof value !== 'object') throw new TypeError('Source-bearing canonical JSON contains an unsupported value');
	if (active.has(value)) throw new TypeError('Source-bearing canonical JSON cannot contain cycles');
	active.add(value);
	try {
		if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item, active)).join(',')}]`;
		if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
			throw new TypeError('Source-bearing canonical JSON requires plain objects');
		}
		return `{${Object.keys(value).sort().map((key) => (
			`${JSON.stringify(key)}:${canonicalJson(value[key], active)}`
		)).join(',')}}`;
	} finally {
		active.delete(value);
	}
}

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	Object.freeze(value);
	for (const child of Object.values(value)) deepFreeze(child);
	return value;
}
