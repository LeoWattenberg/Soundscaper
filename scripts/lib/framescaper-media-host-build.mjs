/* SPDX-License-Identifier: AGPL-3.0-only */

/** Source, build-recipe and runtime-payload audit for the 5B media host. */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import {
	collectBoostHeaderClosure,
	verifyBoostHeaderClosureManifest,
} from './boost-header-closure.mjs';

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
	const actual = listFiles(hostRoot)
		.map((path) => relative(hostRoot, path).split('\\').join('/'))
		.filter((path) => !SOURCE_EXCLUSIONS.has(path) && !path.startsWith('prebuilt/') && !path.startsWith('out/'))
		.sort();
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
	findings.push(...auditClosedAdapters(hostRoot));
	for (const target of FRAMESCAPER_MEDIA_HOST_TARGETS) {
		const record = manifest.targets[target.id];
		if (record.runtime !== target.runtime) findings.push(`${target.id}: runtime identity mismatch.`);
		if (record.status === 'pending-external') {
			if (record.payload !== null || record.toolchainIdentity !== null) {
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
			'--plan-sha256', '--source-sha256', '--source-byte-length', '--source-role',
			'--sequence-profile', '--sequence-rate-num', '--decode-output', '--destination-root',
			'--maximum-output-bytes', 'framescaper-native-prores-proxy-mov-v1',
		]],
		['src/ffmpeg_media_engine.cpp', [
			'avformat_open_input', 'avcodec_send_packet', 'avcodec_receive_frame',
			'sws_scale', 'avformat_alloc_output_context2', 'avcodec_send_frame',
			'av_interleaved_write_frame', 'framescaper-rgba-frame-pack-v1', 'prores_ks',
			'execute_image_sequence_decode',
			'backend-policy-unavailable',
		]],
		['src/image_sequence_pack.cpp', [
			'FSISPK01', 'source-pack frame index', 'sha256_file_ranges_match',
			'image_sequence_maximum_frames', 'inventory_reader',
		]],
		['src/ffmpeg_image_sequence_decode.cpp', [
			'AV_CODEC_ID_PNG', 'AV_CODEC_ID_TIFF', 'AV_CODEC_ID_EXR',
			'avcodec_send_packet', 'avcodec_receive_frame', 'image-sequence-licensing-unavailable',
			'FRAMESCAPER_MEDIA_HOST_CONFORMANCE_IMAGE_SEQUENCE',
		]],
		['src/ffmpeg_simple_render.cpp', [
			'single-full-frame-clip-v1', 'libx264', 'libvpx-vp9',
			'codec-policy-unavailable', 'unsupported-rate-conversion',
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
			'static-composition-graph', 'unsupported-v8-video-effects',
		]],
		['src/legacy_plan_v8_filter_semantics.cpp', [
			'layered-composition', 'V8 filter clip authority', 'maximum_burn_in_cues',
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
	const cmake = readFileSync(join(hostRoot, 'CMakeLists.txt'), 'utf8');
	for (const path of [
		'src/ffmpeg_media_engine.cpp', 'src/ffmpeg_image_sequence_decode.cpp',
		'src/ffmpeg_selected_v20_adapter.cpp', 'src/ffmpeg_selected_v20_render.cpp',
		'src/ffmpeg_simple_render.cpp', 'src/image_sequence_pack.cpp',
		'src/legacy_plan_semantics.cpp', 'src/legacy_plan_v8_filter_semantics.cpp',
		'src/media_file_grants.cpp', 'src/media_plan.cpp', 'src/professional_source_probe.cpp',
		'src/sha256.cpp', 'src/strict_json.cpp',
		'src/selected_v20_frame_executor.cpp', 'src/selected_v20_frame_pack.cpp',
		'src/selected_v20_plan_capture.cpp',
	]) {
		if (!cmake.includes(path)) findings.push(`The CMake target omits ${path}.`);
	}
	if (cmake.includes('FRAMESCAPER_MEDIA_HOST_CONFORMANCE_IMAGE_SEQUENCE')) {
		findings.push('The production CMake target must not enable the image-sequence licensing fixture.');
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
			}
			: {
				id: target.id,
				runtime: target.runtime,
				status: 'pending-external',
				blockedBy: record.blockedBy,
				payload: null,
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
			.map(({ id, runtime, payload }) => ({ id, runtime, ...payload })),
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
		const target = audited.manifest.targets[entry.id];
		const bytes = readFileSync(resolve(root, target.payload.path));
		assert(bytes.byteLength === entry.byteLength && digest(bytes) === entry.sha256,
			`The Framescaper media-host payload ${entry.id} does not match its digest.`);
	}
	return Object.freeze({ source: audited.manifest, payload });
}

export function framescaperMediaHostTargetForRuntime(platform, architecture) {
	return FRAMESCAPER_MEDIA_HOST_TARGETS.find(
		({ runtime }) => runtime === `${platform}-${architecture}`,
	) ?? null;
}

export function canonicalJson(value) {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	if (value !== null && typeof value === 'object') {
		return `{${Object.keys(value).sort().map(
			(key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
		).join(',')}}`;
	}
	return JSON.stringify(value);
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
	return findings;
}

function listFiles(directory) {
	const files = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) files.push(...listFiles(path));
		else if (entry.isFile() && !entry.isSymbolicLink() && statSync(path).isFile()) files.push(path);
	}
	return files;
}

function digest(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}
