/* SPDX-License-Identifier: AGPL-3.0-only */

export const FRAMESCAPER_WEB_VCR_DORMANT_SMOKE_MODE =
	'framescaper-web-vcr-dormant-v1';
export const FRAMESCAPER_WEB_VCR_PACKAGED_SMOKE_MODE =
	'framescaper-web-vcr-packaged-v1';
export const FRAMESCAPER_WEB_VCR_DORMANT_SMOKE_PREFIX =
	'FRAMESCAPER_WEB_VCR_DORMANT_SMOKE ';
export const FRAMESCAPER_WEB_VCR_PACKAGED_SMOKE_PREFIX =
	'FRAMESCAPER_WEB_VCR_PACKAGED_SMOKE ';
export const FRAMESCAPER_WEB_VCR_FIXTURE_CERTIFICATE_SHA256 =
	'338b8e455fa680fbb281823d0d334e58e632f68ecf69c628b2a5583664402f61';

const MODES = Object.freeze([
	FRAMESCAPER_WEB_VCR_DORMANT_SMOKE_MODE,
	FRAMESCAPER_WEB_VCR_PACKAGED_SMOKE_MODE,
]);
const PLAN_FIELDS = Object.freeze([
	'certificateSha256', 'mode', 'origin', 'productId', 'schemaVersion', 'token',
]);
const SMOKE_ARGUMENT = '--soundscaper-smoke';
const MODE_PREFIX = '--soundscaper-smoke-mode=';
const PLAN_PREFIX = '--soundscaper-smoke-plan=';
const MAXIMUM_PLAN_BYTES = 4_096;
const TOKEN = /^[a-f\d]{32}$/u;

export function encodeFramescaperWebVcrSmokePlan(value) {
	const plan = validatePlan(value);
	return Buffer.from(canonicalJson(plan), 'utf8').toString('base64url');
}

export function decodeFramescaperWebVcrSmokePlan(value) {
	if (typeof value !== 'string' || !/^[A-Za-z\d_-]+$/u.test(value)) {
		throw new TypeError('Framescaper Web VCR smoke plan must use unpadded base64url.');
	}
	const bytes = Buffer.from(value, 'base64url');
	if (bytes.toString('base64url') !== value || bytes.byteLength > MAXIMUM_PLAN_BYTES) {
		throw new TypeError('Framescaper Web VCR smoke plan is noncanonical or exceeds its byte limit.');
	}
	let text;
	try {
		text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch (error) {
		throw new TypeError('Framescaper Web VCR smoke plan must contain UTF-8.', { cause: error });
	}
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		throw new TypeError('Framescaper Web VCR smoke plan must contain JSON.', { cause: error });
	}
	if (canonicalJson(parsed) !== text) {
		throw new TypeError('Framescaper Web VCR smoke plan JSON must be canonical.');
	}
	return validatePlan(parsed);
}

export function parseFramescaperWebVcrSmokeConfiguration(argv) {
	if (!Array.isArray(argv) || argv.some((argument) => typeof argument !== 'string')) {
		throw new TypeError('Framescaper Web VCR smoke arguments must be strings.');
	}
	const modes = valuesForPrefix(argv, MODE_PREFIX);
	const dedicatedModes = modes.filter((mode) => MODES.includes(mode));
	if (dedicatedModes.length === 0) return Object.freeze({ mode: 'disabled', plan: null });
	if (argv.filter((argument) => argument === SMOKE_ARGUMENT).length !== 1
		|| modes.length !== 1 || dedicatedModes.length !== 1) {
		throw new TypeError('Framescaper Web VCR smoke requires exactly one matching smoke mode.');
	}
	const plans = valuesForPrefix(argv, PLAN_PREFIX);
	if (plans.length !== 1) {
		throw new TypeError('Framescaper Web VCR smoke requires exactly one smoke plan.');
	}
	const plan = decodeFramescaperWebVcrSmokePlan(plans[0]);
	if (plan.mode !== dedicatedModes[0]) {
		throw new TypeError('Framescaper Web VCR smoke mode does not match its plan.');
	}
	return deepFreeze({ mode: plan.mode, plan });
}

/** Main-process activation is packaged-only and yields null for the dormant witness. */
export function framescaperWebVcrSmokeQualification(argv, options) {
	const configuration = parseFramescaperWebVcrSmokeConfiguration(argv);
	if (configuration.mode === 'disabled'
		|| configuration.mode === FRAMESCAPER_WEB_VCR_DORMANT_SMOKE_MODE) return null;
	if (!options || typeof options !== 'object' || options.packaged !== true
		|| options.productId !== 'framescaper') {
		throw new Error('Framescaper Web VCR smoke qualification requires a packaged Framescaper process.');
	}
	return deepFreeze({
		kind: 'packaged-smoke-v1',
		certificate: {
			enabled: true,
			origin: configuration.plan.origin,
			fingerprint: colonFingerprint(configuration.plan.certificateSha256),
		},
	});
}

function validatePlan(value) {
	const plan = closedRecord(value, PLAN_FIELDS, 'Framescaper Web VCR smoke plan');
	if (plan.schemaVersion !== 1 || !MODES.includes(plan.mode)) {
		throw new TypeError('Framescaper Web VCR smoke plan has an unsupported schema or mode.');
	}
	if (plan.productId !== 'framescaper' || typeof plan.token !== 'string'
		|| !TOKEN.test(plan.token)) {
		throw new TypeError('Framescaper Web VCR smoke plan has an invalid product or token.');
	}
	if (plan.certificateSha256 !== FRAMESCAPER_WEB_VCR_FIXTURE_CERTIFICATE_SHA256) {
		throw new TypeError('Framescaper Web VCR smoke plan certificate pin is not the exact fixture pin.');
	}
	const origin = loopbackOrigin(plan.origin);
	return deepFreeze({
		schemaVersion: 1,
		mode: plan.mode,
		productId: 'framescaper',
		token: plan.token,
		origin,
		certificateSha256: FRAMESCAPER_WEB_VCR_FIXTURE_CERTIFICATE_SHA256,
	});
}

function loopbackOrigin(value) {
	if (typeof value !== 'string') throw new TypeError('Framescaper Web VCR smoke origin is invalid.');
	let origin;
	try { origin = new URL(value); } catch (error) {
		throw new TypeError('Framescaper Web VCR smoke origin is invalid.', { cause: error });
	}
	const port = Number(origin.port);
	if (origin.protocol !== 'https:' || origin.hostname !== '127.0.0.1'
		|| origin.username || origin.password || origin.pathname !== '/'
		|| origin.search || origin.hash || origin.origin !== value
		|| !Number.isSafeInteger(port) || port < 1_024 || port > 65_535) {
		throw new TypeError('Framescaper Web VCR smoke requires a canonical HTTPS loopback origin.');
	}
	return origin.origin;
}

function closedRecord(value, fields, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...fields].sort())) {
		throw new TypeError(`${label} must be a closed plain record.`);
	}
	return value;
}

function canonicalJson(value) {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	if (value && typeof value === 'object') {
		return `{${Object.keys(value).sort().map((key) => (
			`${JSON.stringify(key)}:${canonicalJson(value[key])}`
		)).join(',')}}`;
	}
	return JSON.stringify(value);
}

function colonFingerprint(value) {
	return value.toUpperCase().match(/.{2}/gu).join(':');
}

function valuesForPrefix(argv, prefix) {
	return argv.filter((argument) => argument.startsWith(prefix))
		.map((argument) => argument.slice(prefix.length));
}

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const member of Object.values(value)) deepFreeze(member);
	return Object.freeze(value);
}
