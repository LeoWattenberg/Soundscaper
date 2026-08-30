/* SPDX-License-Identifier: AGPL-3.0-only */

/** Product-only rewrites applied to the compiled Soundscaper desktop closure. */

export function soundscaperNativeTierControlsSource(sourceValue) {
	const source = textSource(sourceValue, 'compiled desktop native-tier controls');
	if (!source.includes("'set-probe-helper-enabled'")
		|| !source.includes('export function registerDesktopNativeTierControls')) {
		throw new Error('Cannot isolate desktop video probe controls.');
	}
	return `/* SPDX-License-Identifier: AGPL-3.0-only */
export const DESKTOP_NATIVE_TIER_CONTROL_ACTIONS = Object.freeze([
\t'set-audio-helper-enabled', 'clear-audio-helper-quarantine',
\t'set-native-effect-discovery-enabled',
]);
export function readDesktopNativeTierControls(settings, tier) {
\tconst durable = settings.snapshot();
\tconst audio = tier.audio.controlSnapshot();
\treturn Object.freeze({
\t\tprobeHelperEnabled: false, probeHelperQuarantined: false,
\t\taudioHelperEnabled: durable.nativeAudioHelperEnabled === true,
\t\taudioHelperQuarantined: audio.quarantined === true,
\t\tnativeEffectDiscoveryEnabled: durable.nativePluginDiscoveryEnabled === true,
\t});
}

export async function applyDesktopNativeTierControl(value, settings, tier) {
\tconst request = desktopNativeTierControlRequest(value);
\tif (request.action === 'set-audio-helper-enabled') await tier.audio.setEnabled(request.enabled);
\telse if (request.action === 'clear-audio-helper-quarantine') tier.audio.clearQuarantine();
\telse if (request.action === 'set-native-effect-discovery-enabled') await tier.plugins.setEnabled(request.enabled);
\treturn readDesktopNativeTierControls(settings, tier);
}
export function registerDesktopNativeTierControls(options) {
\tconst channels = controlChannels(options.channels);
\toptions.handle(channels.nativeTierControls, () => readDesktopNativeTierControls(options.settings, options.tier));
\toptions.handle(channels.nativeTierApply, (event, value) => {
\t\tvoid options.ownerFor(event);
\t\treturn applyDesktopNativeTierControl(value, options.settings, options.tier);
\t});
}
function desktopNativeTierControlRequest(value) {
\tif (!isRecord(value) || typeof value.action !== 'string'
\t\t|| !DESKTOP_NATIVE_TIER_CONTROL_ACTIONS.includes(value.action)) {
\t\tthrow new TypeError('A valid native-tier control request is required.');
\t}
\tconst setsEnabled = value.action !== 'clear-audio-helper-quarantine';
\tconst expected = setsEnabled ? ['action', 'enabled'] : ['action'];
\tif (!sameFields(value, expected) || setsEnabled && typeof value.enabled !== 'boolean') {
\t\tthrow new TypeError('The native-tier control request has invalid fields.');
\t}
\treturn value;
}
function controlChannels(value) {
\tif (!isRecord(value) || typeof value.nativeTierControls !== 'string'
\t\t|| typeof value.nativeTierApply !== 'string'
\t\t|| !value.nativeTierControls || !value.nativeTierApply
\t\t|| value.nativeTierControls === value.nativeTierApply) {
\t\tthrow new TypeError('Distinct native-tier control channels are required.');
\t}
\treturn Object.freeze({ nativeTierControls: value.nativeTierControls, nativeTierApply: value.nativeTierApply });
}
function sameFields(value, expected) {
\tconst fields = Object.keys(value).sort();
\treturn fields.length === expected.length && expected.every((field, index) => fields[index] === field);
}
function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
`;
}

export function soundscaperHelperWireSource(sourceValue) {
	let source = textSource(sourceValue, 'compiled desktop helper wire');
	source = replaceOnce(source,
		/import \{ VIDEO_TIMING_ASSET_MAXIMUM_BYTES \} from ['"][^'"]+['"];\n/u,
		'const SOUNDSCAPER_HELPER_BINARY_MAXIMUM_BYTES = 16_000_032;\n',
		'video timing helper-wire dependency');
	return source.replaceAll(
		'VIDEO_TIMING_ASSET_MAXIMUM_BYTES', 'SOUNDSCAPER_HELPER_BINARY_MAXIMUM_BYTES',
	);
}

export function soundscaperHelperOutputGrantSource(sourceValue) {
	let source = textSource(sourceValue, 'compiled helper output grant');
	source = replaceOnce(source,
		/import \{ admitNativeMediaOutputTreeIdentity, \} from ['"][^'"]+['"];\n/u,
		'', 'native-media output-tree import');
	source = replaceOnce(source,
		/const DIRECTORY_KEYS = Object\.freeze\(\[\.\.\.FILE_KEYS, ['"]kind['"], ['"]treeIdentity['"]\]\);\n/u,
		'', 'native-media directory grant fields');
	source = replaceRange(source,
		"        const directory = Object.hasOwn(record, 'kind');",
		"        const rootPath = absolutePath(record.rootPath, 'output root');",
		"        if (Object.hasOwn(record, 'kind')) unsafe('Directory output grants are unavailable in Soundscaper.');\n        exactKeys(record, FILE_KEYS);\n        const rootPath = absolutePath(record.rootPath, 'output root');",
		'native-media directory grant admission');
	source = replaceRange(source,
		'        if (!directory)\n            return base;',
		"        return Object.freeze({ kind: 'directory', ...base, treeIdentity });",
		'        return base;', 'native-media directory grant result');
	return replaceRange(source,
		'export function isHelperOutputDirectoryGrant(value) {',
		'}\nfunction identity(value) {',
		'export function isHelperOutputDirectoryGrant() { return false; }\nfunction identity(value) {',
		'native-media directory grant predicate');
}

export function soundscaperHelperJobSubcontractSource(sourceValue) {
	const source = textSource(sourceValue, 'compiled helper job subcontract');
	if (!source.includes("'probe-video-source'") || !source.includes("'ofx-host'")) {
		throw new Error('Cannot isolate deferred helper job subcontracts.');
	}
	return `/* SPDX-License-Identifier: AGPL-3.0-only */
export const HELPER_JOB_KINDS = Object.freeze([
\t'audio-device', 'plugin-scan', 'plugin-host', 'assistance-speech',
]);
export const HELPER_JOB_SUBCONTRACT_VERSIONS = Object.freeze({
\t'audio-device': 1, 'plugin-scan': 1, 'plugin-host': 1, 'assistance-speech': 1,
});
export function helperJobSubcontractVersion(kind) {
\tif (!Object.hasOwn(HELPER_JOB_SUBCONTRACT_VERSIONS, kind)) {
\t\tthrow new RangeError('A helper job subcontract requires a known negotiated kind.');
\t}
\treturn HELPER_JOB_SUBCONTRACT_VERSIONS[kind];
}
export function admitsHelperJobSubcontract(kind, version) {
\treturn version === helperJobSubcontractVersion(kind);
}
`;
}

export function soundscaperHelperJobGrantSource(sourceValue) {
	let source = textSource(sourceValue, 'compiled helper job grants');
	source = replaceOnce(source,
		/import \{ HELPER_NATIVE_JOB_KINDS,[\s\S]*?\} from ['"]\.\/helper-native-job-contract\.js['"];\n/u,
		'', 'native media helper grant import');
	source = replaceOnce(source,
		/export \{ HELPER_EXECUTABLE_ROLES,[\s\S]*?\} from ['"]\.\/helper-native-job-contract\.js['"];\n/u,
		'', 'native media helper grant exports');
	source = replaceRange(source,
		'export const HELPER_PROBE_JOB_KINDS = Object.freeze([',
		']);',
		'export const HELPER_PROBE_JOB_KINDS = Object.freeze([]);',
		'video probe helper kinds');
	source = replaceOnce(source,
		/const PROBE_KEYS = Object\.freeze\(\[[^\n]+\n/u,
		'', 'video probe grant keys');
	source = replaceOnce(source,
		/\s+if \(kind === ['"]probe-video-source['"]\)\s+return validateProbeGrant\(value\);\n/u,
		'\n', 'video probe grant admission');
	source = replaceRange(source,
		'    return validateHelperNativeJobGrant(kind, value);',
		'\n}',
		"    throw new HelperContractViolationError('unknown-kind', 'The helper grant job kind is unavailable in Soundscaper.');\n}",
		'native media helper grant fallback');
	source = replaceRange(source,
		'    if (HELPER_NATIVE_JOB_KINDS.includes(kind)) {',
		"\n    if (kind === 'assistance-speech') {",
		"\n    if (kind === 'assistance-speech') {",
		'native media helper resource usage');
	source = replaceRange(source,
		'    if (HELPER_NATIVE_JOB_KINDS.includes(kind)) {',
		"\n    if (kind === 'assistance-speech') {",
		"\n    if (kind === 'assistance-speech') {",
		'native media helper result admission');
	return replaceRange(source,
		'function validateProbeGrant(',
		'function validateAudioDeviceGrant(',
		'function validateAudioDeviceGrant(',
		'video probe helper grant validator');
}

export function soundscaperHelperContractSource(sourceValue) {
	let source = textSource(sourceValue, 'compiled helper contract');
	source = replaceOnce(source,
		/import \{ VIDEO_TIMING_ASSET_HEADER_BYTES,[^\n]+\n/u,
		'', 'video timing helper contract import');
	source = replaceOnce(source,
		/import \{ isHelperOutputDirectoryGrant, \} from ['"][^'"]+['"];\n/u,
		'', 'native output helper contract import');
	source = replaceOnce(source,
		/export \{ HELPER_AUDIO_BACKENDS,[^\n]+\n/u,
		"export { HELPER_AUDIO_BACKENDS, HELPER_JOB_KINDS, HELPER_PLUGIN_FORMATS, helperJobGrantExceedsResourcePolicy, helperJobGrantInputBytes, helperJobGrantResourceUsage, validateHelperJobGrant, validateHelperJobResult, } from './helper-job-grant.js';\n",
		'native and video helper contract exports');
	source = replaceOnce(source,
		/export \{ HELPER_EXECUTABLE_ROLES,[^\n]+\n/u,
		'', 'native helper role exports');
	source = replaceOnce(source,
		/\s+assertNativeOutputJobIdentity\(kind, jobId, admittedGrant\);\n/u,
		'\n', 'native output helper identity admission');
	source = replaceRange(source,
		'function assertNativeOutputJobIdentity(',
		'export function validateHelperProcessMessage(',
		'export function validateHelperProcessMessage(',
		'native output helper identity validator');
	return replaceRange(source,
		'const PROBE_RESULT_KEYS =',
		'function wireRecord(',
		'function wireRecord(',
		'video probe helper result validator');
}

export function soundscaperHelperDataPlaneTransferSource(sourceValue) {
	let source = textSource(sourceValue, 'compiled helper data-plane transfer');
	source = replaceOnce(source,
		/import \{ isHelperOfxInteractJobGrantV1 \} from ['"][^'"]+['"];\n/u,
		'', 'OpenFX helper transfer import');
	return replaceRange(source,
		'function nativeBindings(',
		'function streamBindings(',
		`function nativeBindings(kind, grant) {
\tif (kind === 'audio-device' || kind === 'plugin-host') {
\t\tconst binding = grant.persistentPort;
\t\treturn binding ? [binding] : [];
\t}
\treturn [];
}
function streamBindings(`,
		'deferred product helper transfer bindings');
}

export function soundscaperHelperResourcePolicySource(sourceValue) {
	let source = textSource(sourceValue, 'compiled helper resource policy');
	for (const kind of [
		'probe-video-source', 'media-decode', 'media-encode', 'media-render', 'media-proxy',
		'ofx-scan', 'ofx-host',
	]) {
		source = replaceCount(source,
			new RegExp(`^    '${kind}': [^\\n]+\\n`, 'gmu'),
			'', 2, kind + ' helper resource policy');
	}
	source = replaceRange(source,
		'const MAXIMUM_NATIVE_FILE_BYTES =',
		'export const HELPER_JOB_RESOURCE_HARD_LIMITS = Object.freeze({',
		'export const HELPER_JOB_RESOURCE_HARD_LIMITS = Object.freeze({',
		'native media helper resource ceilings');
	source = replaceRange(source,
		'function nativeLimits(kind) {',
		'function lowerOnlyLimit(',
		'function lowerOnlyLimit(',
		'native media helper resource builders');
	return source.replace(
		"export function normalizeHelperResourcePolicy(value, kind = 'probe-video-source')",
		"export function normalizeHelperResourcePolicy(value, kind = 'audio-device')",
	);
}

export function soundscaperProjectCurrentRuntimeSource(sourceValue) {
	let source = textSource(sourceValue, 'compiled current project runtime');
	source = replaceOnce(source,
		/import \{ reconcileVideoKeyframeCarriersAfterCommand \} from ['"][^'"]+['"];\n/u,
		'', 'video keyframe command reconciliation import');
	source = replaceOnce(source,
		/\s+reconcileVideoKeyframeCarriersAfterCommand\(draft, persistedBase\);\n/u,
		'\n', 'video keyframe command reconciliation');
	return source;
}

export function soundscaperOwnedAudioCutTransformTypesSource(sourceValue) {
	return replaceOnce(textSource(sourceValue, 'owned audio/cut transform types'),
		/^\s*['"]normalize-cuts['"],\n/mu, '', 'deferred normalize-cuts transform identity');
}

export function soundscaperOwnedAudioCutTransformResultsSource(sourceValue) {
	let source = textSource(sourceValue, 'owned audio/cut transform result review');
	source = replaceOnce(source,
		/import \{ reviewAssistanceShotBoundariesV1 \} from ['"][^'"]+['"];\n/u,
		'', 'deferred shot-boundary result import');
	source = replaceOnce(source,
		/^\s*case ['"]normalize-cuts['"]:[^\n]+\n/mu,
		'', 'deferred normalize-cuts result dispatch');
	return replaceRange(source, 'function reviewCuts(', 'function exactKind(',
		'function exactKind(', 'deferred normalize-cuts result review');
}

export function soundscaperOwnedAudioCutTransformRegistrySource(sourceValue) {
	let source = textSource(sourceValue, 'owned audio/cut transform registry');
	source = replaceOnce(source,
		/import \{ normalizeOwnedCutsV1 \} from ['"][^'"]+['"];\n/u,
		'', 'deferred normalize-cuts registry import');
	source = replaceOnce(source,
		/^\s*['"]normalize-cuts['"]:\s*['"]mark-cuts['"],\n/mu,
		'', 'deferred normalize-cuts workflow registration');
	source = replaceOnce(source,
		/^\s*case ['"]normalize-cuts['"]: return result\(transformId, \{\n\s*['"]cut-proposals['"]: normalizeOwnedCutsV1\([^\n]+\n\s*\}\);\n/mu,
		'', 'deferred normalize-cuts registry dispatch');
	return source;
}

function textSource(value, label) {
	if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} source is invalid.`);
	return value;
}

function replaceRange(source, start, end, replacement, label) {
	const startIndex = source.indexOf(start);
	const endIndex = source.indexOf(end, startIndex + start.length);
	if (startIndex < 0 || endIndex < 0) throw new Error(`Cannot isolate ${label}.`);
	return `${source.slice(0, startIndex)}${replacement}${source.slice(endIndex + end.length)}`;
}

function replaceOnce(source, pattern, replacement, label) {
	const matches = source.match(new RegExp(pattern.source,
		pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`));
	if (matches?.length !== 1) throw new Error(`Cannot isolate ${label}.`);
	return source.replace(pattern, replacement);
}

function replaceCount(source, pattern, replacement, expected, label) {
	const matches = source.match(pattern);
	if (matches?.length !== expected) throw new Error(`Cannot isolate ${label}.`);
	return source.replace(pattern, replacement);
}
