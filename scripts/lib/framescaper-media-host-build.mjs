/* SPDX-License-Identifier: AGPL-3.0-only */

/** Source, build-recipe and runtime-payload audit for the 5B media host. */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import {
	collectBoostHeaderClosure,
	verifyBoostHeaderClosureManifest,
} from './boost-header-closure.mjs';
import { lineEndingPolicyFindings } from './line-ending-policy.mjs';
import { listNativeSourceTree } from './native-source-tree.mjs';
import { canonicalJson } from './canonical-json.mjs';

export { canonicalJson };

export const FRAMESCAPER_MEDIA_HOST_ROOT = 'native/framescaper-media-host';
export const FRAMESCAPER_MEDIA_HOST_SOURCE_MANIFEST =
	`${FRAMESCAPER_MEDIA_HOST_ROOT}/source-manifest.json`;
export const FRAMESCAPER_MEDIA_HOST_PAYLOAD_MANIFEST =
	'config/framescaper-media-host-payload-manifest.json';

export const FRAMESCAPER_MEDIA_HOST_TARGETS = Object.freeze([
	Object.freeze({ id: 'linux-x64', runtime: 'linux-x64' }),
	Object.freeze({ id: 'linux-arm64', runtime: 'linux-arm64' }),
	Object.freeze({ id: 'mac-arm64', runtime: 'darwin-arm64' }),
	Object.freeze({ id: 'win-x64', runtime: 'win32-x64' }),
	Object.freeze({ id: 'win-arm64', runtime: 'win32-arm64' }),
]);

const SOURCE_EXCLUSIONS = new Set(['source-manifest.json']);
const SHA256 = /^[a-f\d]{64}$/u;
const TARGET_FIELDS = Object.freeze([
	'runtime', 'status', 'blockedBy', 'toolchainIdentity', 'payload',
	'isolationPayload', 'productionReadiness',
]);

export function readFramescaperMediaHostSourceManifest(repositoryRoot) {
	const manifest = JSON.parse(readFileSync(
		resolve(repositoryRoot, FRAMESCAPER_MEDIA_HOST_SOURCE_MANIFEST), 'utf8',
	));
	assert(manifest.schemaVersion === 1, 'The Framescaper media host source schema is unsupported.');
	assert(manifest.hostVersion === '1.0.0', 'The Framescaper media host version is unsupported.');
	assert(manifest.helperContractVersion === 1, 'The media host must retain helper contract version 1.');
	assert(manifest.license === 'AGPL-3.0-only', 'The media host source licence is invalid.');
	assert(manifest.ffmpeg?.version === '9.0.1', 'The native host must pin FFmpeg 9.0.1.');
	assert(manifest.ffmpeg.url === 'https://ffmpeg.org/releases/ffmpeg-9.0.1.tar.xz',
		'The native host FFmpeg source URL is not the official release archive.');
	assert(manifest.ffmpeg.byteLength === 12_036_420 && SHA256.test(manifest.ffmpeg.sha256),
		'The native host FFmpeg source identity is incomplete.');
	assert(canonicalJson(manifest.ffmpeg.extractedTree) === canonicalJson({
		algorithm: 'framescaper-portable-source-tree-sha256-v1',
		fileCount: 10_397,
		sha256: 'dc709cc7d80424f45aab44ac94e59f7c8669fe18b877e9e5f1319006bfa622b4',
	}), 'The native host FFmpeg extracted-tree identity is unsupported.');
	assert(manifest.ffmpeg.signingKeyFingerprint === 'FCF986EA15E6E293A5644F10B4322F04D67658D8',
		'The native host FFmpeg signing key is not pinned.');
	assertBoostBuildInputs(repositoryRoot, manifest);
	assert(Array.isArray(manifest.sourceFiles), 'The native host source manifest has no source closure.');
	const targets = Object.keys(manifest.targets ?? {}).sort();
	const expected = FRAMESCAPER_MEDIA_HOST_TARGETS.map(({ id }) => id).sort();
	assert(canonicalJson(targets) === canonicalJson(expected),
		`The native host must record exactly ${expected.join(', ')}.`);
	return manifest;
}

function assertBoostBuildInputs(repositoryRoot, manifest) {
	const sourceManifest = 'config/boost-multiprecision-source-manifest.json';
	assert(manifest.boost?.sourceManifest === sourceManifest,
		'The media host must bind the maintained Boost source manifest.');
	const boost = JSON.parse(readFileSync(resolve(repositoryRoot, sourceManifest), 'utf8'));
	assert(boost.schemaVersion === 1
		&& boost.component?.name === 'Boost.Multiprecision'
		&& boost.component.version === '1.92.0'
		&& boost.component.runtimePayload === false,
	'The media host Boost build-only source identity is unsupported.');
	assert(boost.source?.sha256 === '5c1d40cb8e19adbf740a4ec2da35b3e58f3f5804b1dce44deb53df72193cbc6c',
		'The media host Boost 1.92.0 archive identity is unsupported.');
	const expected = {
		version: boost.component.version,
		sourceManifest,
		archiveSha256: boost.source.sha256,
		headerClosure: {
			algorithm: boost.headerClosure?.algorithm,
			roots: boost.headerClosure?.roots,
			fileCount: boost.headerClosure?.fileCount,
			sha256: boost.headerClosure?.sha256,
		},
	};
	assert(canonicalJson(manifest.boost) === canonicalJson(expected),
		'The media host Boost build input disagrees with the pinned header closure.');
	const cmake = readFileSync(resolve(
		repositoryRoot, FRAMESCAPER_MEDIA_HOST_ROOT, 'CMakeLists.txt',
	), 'utf8');
	assert(/find_package\(Boost\s+1\.92\.0\s+EXACT\s+REQUIRED\)/u.test(cmake),
		'The media host CMake recipe must require Boost 1.92.0 exactly.');
}

export function auditFramescaperMediaHost({ repositoryRoot }) {
	const root = resolve(repositoryRoot);
	const manifest = readFramescaperMediaHostSourceManifest(root);
	const findings = [];
	const hostRoot = resolve(root, FRAMESCAPER_MEDIA_HOST_ROOT);
	const tree = listNativeSourceTree(hostRoot);
	const audited = (path) => !SOURCE_EXCLUSIONS.has(path)
		&& !path.startsWith('prebuilt/') && !path.startsWith('out/');
	const hostPath = (path) => relative(hostRoot, path).split('\\').join('/');
	const actual = tree.files.map(hostPath).filter(audited).sort();
	for (const path of tree.irregular.map(hostPath).filter(audited).sort()) {
		findings.push(`Irregular media-host source entry: ${path}`);
	}
	const pins = new Map(manifest.sourceFiles.map((entry) => [entry.path, entry]));
	for (const path of actual) if (!pins.has(path)) findings.push(`Unpinned media-host source: ${path}`);
	for (const [path, pin] of pins) {
		if (!actual.includes(path)) {
			findings.push(`Missing media-host source: ${path}`);
			continue;
		}
		const bytes = readFileSync(join(hostRoot, path));
		if (bytes.byteLength !== pin.byteLength) findings.push(`Media-host source byte length mismatch: ${path}`);
		if (!SHA256.test(String(pin.sha256)) || digest(bytes) !== pin.sha256) {
			findings.push(`Media-host source digest mismatch: ${path}`);
		}
	}
	findings.push(...lineEndingPolicyFindings(root, [
		`/${FRAMESCAPER_MEDIA_HOST_ROOT}/**`,
		`/${FRAMESCAPER_MEDIA_HOST_PAYLOAD_MANIFEST}`,
	]));
	findings.push(...auditClosedAdapters(hostRoot));
	for (const target of FRAMESCAPER_MEDIA_HOST_TARGETS) {
		const record = manifest.targets[target.id];
		if (!sameFields(record, TARGET_FIELDS)) {
			findings.push(`${target.id}: media-host target row is not an exact record.`);
			continue;
		}
		if (record.runtime !== target.runtime) findings.push(`${target.id}: runtime identity mismatch.`);
		if (record.status === 'pending-external') {
			if (record.payload !== null || record.toolchainIdentity !== null
				|| record.isolationPayload !== null || record.productionReadiness !== null) {
				findings.push(`${target.id}: pending-external targets cannot carry payload claims.`);
			}
			if (typeof record.blockedBy !== 'string' || record.blockedBy.length < 16) {
				findings.push(`${target.id}: pending-external target has no concrete blocker.`);
			}
		} else if (record.status === 'built') {
			findings.push(...auditBuiltTarget(root, manifest, target, record));
		} else {
			findings.push(`${target.id}: unsupported target status ${String(record.status)}.`);
		}
	}
	return Object.freeze({ manifest, findings: Object.freeze(findings) });
}

function auditClosedAdapters(hostRoot) {
	const findings = [];
	const required = new Map([
		['src/media_host.cpp', [
			'framescaper-native-prores-proxy-mov-v1',
		]],
		['src/media_host_arguments.cpp', [
			'--plan-sha256', '--source-sha256', '--source-byte-length', '--source-role',
			'--video-timing-asset', '--video-timing-sha256', '--video-timing-byte-length',
			'--sequence-profile', '--sequence-rate-num', '--decode-output', '--destination-root',
			'--maximum-output-bytes',
		]],
		['src/ffmpeg_media_engine.cpp', [
			'sws_scale', 'avformat_alloc_output_context2', 'avcodec_send_frame',
			'av_interleaved_write_frame', 'framescaper-rgba-frame-pack-v1', 'prores_ks',
			'execute_image_sequence_decode',
		]],
		['src/ffmpeg_decode_session.cpp', [
			'avformat_open_input', 'avcodec_send_packet', 'avcodec_receive_frame',
		]],
		['src/image_sequence_pack.cpp', [
			'FSISPK01', 'source-pack frame index', 'sha256_file_ranges_match',
			'image_sequence_maximum_frames', 'inventory_reader',
		]],
		['src/ffmpeg_image_sequence_decode.cpp', [
			'AV_CODEC_ID_PNG', 'AV_CODEC_ID_TIFF', 'AV_CODEC_ID_EXR',
			'avcodec_send_packet', 'avcodec_receive_frame',
			'return decode(job, *job.image_sequence)',
		]],
		['src/ffmpeg_simple_render.cpp', [
			'single-full-frame-clip-v1', 'avformat_alloc_output_context2',
			'avcodec_send_frame', 'av_interleaved_write_frame', 'unsupported-rate-conversion',
		]],
		['src/ffmpeg_hardware_encode.cpp', [
			'libx264', 'libvpx-vp9', 'codec-policy-unavailable',
			'hardware-encoder-unavailable', 'sws_scale',
		]],
		['src/ffmpeg_selected_v20_adapter.cpp', [
			'execute_selected_v20_frames', 'avcodec_get_supported_config', 'swr_convert',
			'avcodec_send_frame', 'av_interleaved_write_frame', 'reauthenticate_sources',
			'selected-v20-v7-keyed-rgba',
		]],
		['src/selected_v20_frame_pack.cpp', [
			'framescaper-rgba-frame-pack-v1', 'require_output_cadence',
		]],
		['src/media_file_grants.cpp', [
			'authenticate_regular_file', 'authenticate_new_direct_child', 'must not exist',
		]],
		['src/legacy_plan_semantics.cpp', [
			'framescaper-keyframed-rgba-v1', 'keyed-rgba-data-plane',
			'static-composition-graph', 'capture_v8_static_visual_semantics',
		]],
		['src/legacy_plan_v8_filter_semantics.cpp', [
			'layered-composition', 'V8 filter clip authority', 'maximum_burn_in_cues',
			'V8 filter effect authority',
		]],
		['src/legacy_plan_v8_visual_semantics_impl.hpp', [
			'V8 source presentation must state a residual stretch',
			'V8 display matrix contains unsupported shear',
			'V8 transition render descriptions must share blend and order',
		]],
		['src/media_plan.cpp', [
			'unsupported-plan-version', 'framescaper-unified-exact-v1',
			'timing_grants', 'require_all_used',
		]],
		['src/media_plan.hpp', [
			'simple_full_frame_clip', 'image_sequence_inventory_sha256',
			'video_timing_asset_grant',
		]],
		['src/professional_source_probe.cpp', [
			'AV_PKT_DATA_MASTERING_DISPLAY_METADATA', 'AV_PKT_DATA_CONTENT_LIGHT_LEVEL',
			'AV_PIX_FMT_FLAG_ALPHA', 'professional_source_characteristics_self_test',
			'framescaper-media-host', 'alphaInterpretation',
		]],
		['src/unified_plan_semantics.hpp', ['simple_full_frame_clip']],
		['src/unified_plan_v9_intent_authority.hpp', [
			'intent_source_boundary', 'boundary_ticks',
		]],
		['src/unified_plan_v11_v12_semantics.hpp', ['image_sequence_inventory_sha256']],
		['src/unified_plan_video_timing.hpp', [
			'soundscaper-video-timing-v1', 'video-timing-sha256:', 'timing_assets.require',
		]],
		['src/video_timing_asset.hpp', [
			'video_timing_asset_maximum_grants', 'authenticate_regular_file',
			'sha256_bytes', 'boundary_ticks', 'require_all_used',
		]],
	]);
	for (const [path, tokens] of required) {
		let source;
		try { source = readFileSync(join(hostRoot, path), 'utf8'); }
		catch { findings.push(`The closed media adapter source is missing: ${path}`); continue; }
		for (const token of tokens) {
			if (!source.includes(token)) findings.push(`The closed media adapter ${path} omits ${token}.`);
		}
	}
	const implementationFiles = [...required.keys()].filter((path) => path.endsWith('.cpp'));
	const implementation = implementationFiles.map((path) => readFileSync(join(hostRoot, path), 'utf8')).join('\n');
	for (const forbidden of [
		/avfilter_graph_parse/u, /\bsystem\s*\(/u, /\bpopen\s*\(/u, /\bexecv/u,
		/-filter_complex/u, /(?:^|\s)-vf(?:\s|$)/u,
	]) {
		if (forbidden.test(implementation)) findings.push('The media host exposes a raw process or filter-string seam.');
	}
	if (/FRAMESCAPER_MEDIA_HOST_CONFORMANCE_IMAGE_SEQUENCE|image_sequence_policy_enabled/u.test(implementation)) {
		findings.push('The media host must not compile-gate image-sequence execution on manual qualification.');
	}
	if (/image-sequence-(?:licensing|policy)-unavailable/u.test(implementation)) {
		findings.push('The media host must not refuse authenticated image sequences on manual policy status.');
	}
	const cmake = readFileSync(join(hostRoot, 'CMakeLists.txt'), 'utf8');
	for (const path of [
		'src/ffmpeg_media_engine.cpp', 'src/ffmpeg_image_sequence_decode.cpp',
		'src/ffmpeg_selected_v20_adapter.cpp', 'src/ffmpeg_selected_v20_render.cpp',
		'src/ffmpeg_simple_render.cpp', 'src/image_sequence_pack.cpp',
		'src/legacy_plan_semantics.cpp', 'src/legacy_plan_v8_filter_semantics.cpp',
		'src/media_file_grants.cpp', 'src/media_host_arguments.cpp', 'src/media_plan.cpp',
		'src/professional_source_probe.cpp',
		'src/sha256.cpp', 'src/strict_json.cpp',
		'src/selected_v20_frame_executor.cpp', 'src/selected_v20_frame_pack.cpp',
		'src/selected_v20_plan_capture.cpp',
	]) {
		if (!cmake.includes(path)) findings.push(`The CMake target omits ${path}.`);
	}
	if (cmake.includes('FRAMESCAPER_MEDIA_HOST_CONFORMANCE_IMAGE_SEQUENCE')) {
		findings.push('The CMake target must not restore the image-sequence manual-qualification gate.');
	}
	for (const path of listFiles(join(hostRoot, 'src'))) {
		const source = readFileSync(path, 'utf8');
		if (source.split(/\r?\n/u).length - 1 > 600) {
			findings.push(`The maintained media-host source exceeds 600 lines: ${relative(hostRoot, path)}`);
		}
	}
	return findings;
}

/** Recompute the pinned Boost closure when an extracted 1.92.0 tree is provisioned. */
export async function verifyFramescaperMediaHostBoostClosure({
	repositoryRoot,
	boostSourceRoot,
}) {
	const manifest = readFramescaperMediaHostSourceManifest(repositoryRoot);
	const closure = await collectBoostHeaderClosure(
		boostSourceRoot,
		manifest.boost.headerClosure.roots,
	);
	verifyBoostHeaderClosureManifest(manifest.boost.headerClosure, closure);
	return closure;
}

export function deriveFramescaperMediaHostPayloadManifest(sourceManifest) {
	const targets = FRAMESCAPER_MEDIA_HOST_TARGETS.map((target) => {
		const record = sourceManifest.targets[target.id];
		return record.status === 'built'
			? {
				id: target.id,
				runtime: target.runtime,
				status: 'built',
				blockedBy: null,
				payload: { ...record.payload },
				isolationPayload: cloneIsolationPayload(record.isolationPayload),
				productionReadiness: record.productionReadiness === null
					? null : { ...record.productionReadiness },
			}
			: {
				id: target.id,
				runtime: target.runtime,
				status: 'pending-external',
				blockedBy: record.blockedBy,
				payload: null,
				isolationPayload: null,
				productionReadiness: null,
			};
	});
	return {
		schemaVersion: 1,
		id: `framescaper-media-host-${sourceManifest.hostVersion}`,
		sourceManifestPath: FRAMESCAPER_MEDIA_HOST_SOURCE_MANIFEST,
		ffmpeg: { version: sourceManifest.ffmpeg.version, sha256: sourceManifest.ffmpeg.sha256 },
		runtimePrefix: 'native/framescaper-media-host',
		payloads: targets
			.filter(({ status }) => status === 'built')
			.map(({ id, runtime, payload, isolationPayload }) => ({
				id, runtime, ...payload, isolationPayload: cloneIsolationPayload(isolationPayload),
			})),
		targets,
	};
}

export function verifyFramescaperMediaHostPayloadManifest({ repositoryRoot }) {
	const root = resolve(repositoryRoot);
	const audited = auditFramescaperMediaHost({ repositoryRoot: root });
	assert(audited.findings.length === 0, audited.findings.join('\n'));
	const payload = JSON.parse(readFileSync(resolve(root, FRAMESCAPER_MEDIA_HOST_PAYLOAD_MANIFEST), 'utf8'));
	const derived = deriveFramescaperMediaHostPayloadManifest(audited.manifest);
	assert(canonicalJson(payload) === canonicalJson(derived),
		'The Framescaper media-host payload manifest disagrees with its source manifest.');
	for (const entry of payload.payloads) {
		for (const [label, descriptor] of payloadDescriptors(entry)) {
			const bytes = readFileSync(resolve(root, descriptor.path));
			assert(bytes.byteLength === descriptor.byteLength && digest(bytes) === descriptor.sha256,
				`The Framescaper media-host payload ${entry.id} ${label} does not match its digest.`);
		}
	}
	return Object.freeze({ source: audited.manifest, payload });
}

export function framescaperMediaHostTargetForRuntime(platform, architecture) {
	return FRAMESCAPER_MEDIA_HOST_TARGETS.find(
		({ runtime }) => runtime === `${platform}-${architecture}`,
	) ?? null;
}


function auditBuiltTarget(root, manifest, target, record) {
	const findings = [];
	if (record.blockedBy !== null || typeof record.toolchainIdentity !== 'string') {
		findings.push(`${target.id}: a built target requires a toolchain and no blocker.`);
	}
	const payload = record.payload;
	if (!payload || typeof payload.path !== 'string' || !SHA256.test(String(payload.sha256))) {
		return [...findings, `${target.id}: a built target requires an exact payload identity.`];
	}
	const expectedPrefix = `${FRAMESCAPER_MEDIA_HOST_ROOT}/prebuilt/${target.id}/`;
	if (!payload.path.startsWith(expectedPrefix)) findings.push(`${target.id}: payload path leaves its target root.`);
	let bytes;
	try { bytes = readFileSync(resolve(root, payload.path)); }
	catch { return [...findings, `${target.id}: built payload is missing.`]; }
	if (bytes.byteLength !== payload.byteLength || digest(bytes) !== payload.sha256) {
		findings.push(`${target.id}: built payload bytes disagree with the pin.`);
	}
	findings.push(...auditIsolationPayload(root, target.id, record.isolationPayload));
	return findings;
}

function auditIsolationPayload(root, targetId, value) {
	const findings = [];
	if (!sameFields(value, [
		'launcherPayload', 'sandboxProfilePayload', 'brokerPolicyPayload', 'runtimeLibraryPayloads',
	]) || !Array.isArray(value.runtimeLibraryPayloads) || value.runtimeLibraryPayloads.length > 32) {
		return [`${targetId}: invalid media-host isolation payload identity.`];
	}
	const suffix = targetId.startsWith('win-') ? '.exe' : '';
	const prefix = `${FRAMESCAPER_MEDIA_HOST_ROOT}/prebuilt/${targetId}`;
	const declarations = [
		[value.launcherPayload, `${prefix}/isolation/milestone5-native-isolation-launcher${suffix}`],
		[value.sandboxProfilePayload, `${prefix}/isolation/milestone5-native-isolation-profile.json`],
		[value.brokerPolicyPayload, `${prefix}/isolation/milestone5-native-isolation-broker.json`],
		...value.runtimeLibraryPayloads.map((descriptor) => [
			descriptor, `${prefix}/lib/${descriptor?.path?.split('/').at(-1) ?? ''}`,
		]),
	];
	const libraryPaths = value.runtimeLibraryPayloads.map(({ path }) => path);
	if (libraryPaths.some((path, index) => index > 0
		&& libraryPaths[index - 1].localeCompare(path, 'en') >= 0)) {
		findings.push(`${targetId}: media-host runtime libraries are not uniquely ordered.`);
	}
	for (const [descriptor, expectedPath] of declarations) {
		if (!sameFields(descriptor, ['path', 'byteLength', 'sha256'])
			|| descriptor.path !== expectedPath || !Number.isSafeInteger(descriptor.byteLength)
			|| descriptor.byteLength <= 0 || !SHA256.test(String(descriptor.sha256))) {
			findings.push(`${targetId}: invalid media-host isolation payload descriptor.`);
			continue;
		}
		try {
			const bytes = readFileSync(resolve(root, descriptor.path));
			if (bytes.byteLength !== descriptor.byteLength || digest(bytes) !== descriptor.sha256) {
				findings.push(`${targetId}: media-host isolation payload bytes disagree with the pin.`);
			}
		} catch { findings.push(`${targetId}: media-host isolation payload is missing.`); }
	}
	return findings;
}

function cloneIsolationPayload(value) {
	return {
		launcherPayload: { ...value.launcherPayload },
		sandboxProfilePayload: { ...value.sandboxProfilePayload },
		brokerPolicyPayload: { ...value.brokerPolicyPayload },
		runtimeLibraryPayloads: value.runtimeLibraryPayloads.map((entry) => ({ ...entry })),
	};
}

function payloadDescriptors(entry) {
	return [
		['executable', entry],
		['isolation launcher', entry.isolationPayload.launcherPayload],
		['isolation profile', entry.isolationPayload.sandboxProfilePayload],
		['isolation broker', entry.isolationPayload.brokerPolicyPayload],
		...entry.isolationPayload.runtimeLibraryPayloads.map((descriptor) => ['runtime library', descriptor]),
	];
}

function listFiles(directory) {
	return listNativeSourceTree(directory).files;
}

function digest(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function sameFields(value, fields) {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		&& canonicalJson(Object.keys(value).sort()) === canonicalJson([...fields].sort());
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}
