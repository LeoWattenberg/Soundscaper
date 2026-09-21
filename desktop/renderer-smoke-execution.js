/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';

const PRODUCT_IDS = new Set(['soundscaper', 'framescaper']);
const OPERATIONS = Object.freeze({
	soundscaper: new Set([
		'artifact-chrome', 'artifact-soundscaper', 'direct-wav', 'project-library-lease',
		'scape-open', 'scape-reopen', 'video-timing',
	]),
	framescaper: new Set([
		'artifact-baseline', 'artifact-capture', 'artifact-chrome', 'direct-wav',
		'project-library-lease', 'scape-open', 'scape-reopen', 'video-timing',
		'web-vcr-dormant', 'web-vcr-packaged',
	]),
});
const STALL_STAGE_KEYS = Object.freeze({
	__scapeDirectWavSmokeStage: new Set(['soundscaper', 'framescaper']),
	__framescaperWebVcrSmokeStageV1: new Set(['framescaper']),
});

/**
 * The only executable strings the packaged smoke harness may create. Each
 * recipe has a fixed marker and app-origin path prefix. A SHA-256 suffix makes
 * parameterized invocations unique in Chromium's URL-keyed source cache.
 */
export const DESKTOP_RENDERER_DYNAMIC_EXCLUSIONS = Object.freeze({
	runner: Object.freeze({
		marker: 'soundscaper-e2e-recipe:runner-v1',
		pathPrefix: '__e2e-excluded__/renderer-smoke-launcher-v1-',
		maximumBytes: 96 * 1024,
		products: Object.freeze(['framescaper', 'soundscaper']),
	}),
	stallWitness: Object.freeze({
		marker: 'soundscaper-e2e-recipe:stall-witness-v1',
		pathPrefix: '__e2e-excluded__/renderer-smoke-stall-witness-v1-',
		maximumBytes: 4 * 1024,
		products: Object.freeze(['framescaper', 'soundscaper']),
	}),
	webVcrStage: Object.freeze({
		marker: 'soundscaper-e2e-recipe:web-vcr-stage-v1',
		pathPrefix: '__e2e-excluded__/web-vcr-stage-v1-',
		maximumBytes: 1024,
		products: Object.freeze(['framescaper']),
	}),
	webVcrGesture: Object.freeze({
		marker: 'soundscaper-e2e-recipe:web-vcr-gesture-v1',
		pathPrefix: '__e2e-excluded__/web-vcr-gesture-v1-',
		maximumBytes: 2 * 1024,
		products: Object.freeze(['framescaper']),
	}),
});

export function executeDesktopRendererSmoke(webContents, options) {
	const configuration = closedOptions(options, [
		'arguments', 'operation', 'productId', 'userGesture',
	], 'renderer smoke invocation');
	const productId = product(configuration.productId);
	const operation = configuration.operation;
	if (typeof operation !== 'string' || !OPERATIONS[productId].has(operation)) {
		throw new TypeError('Renderer smoke operation is invalid.');
	}
	const values = configuration.arguments ?? [];
	if (!Array.isArray(values)) throw new TypeError('Renderer smoke arguments must be an array.');
	const request = canonicalJson({ operation, arguments: values });
	const body = runnerBody(productId, request);
	const { source } = recipeSource(productId, 'runner', body);
	const execution = executeRecipe(webContents, productId, 'runner', source, configuration.userGesture);
	return Promise.resolve(execution).then(rendererEnvelope);
}

export function readDesktopRendererSmokeStallWitness(webContents, options) {
	const configuration = closedOptions(options, [
		'productId', 'stageKey', 'userGesture',
	], 'renderer smoke stall witness');
	const productId = product(configuration.productId);
	const products = STALL_STAGE_KEYS[configuration.stageKey];
	if (!products?.has(productId)) throw new TypeError('Renderer smoke stage key is invalid.');
	const body = stallWitnessBody(configuration.stageKey);
	const { source } = recipeSource(productId, 'stallWitness', body);
	return executeRecipe(webContents, productId, 'stallWitness', source, configuration.userGesture);
}

export function readFramescaperWebVcrSmokeStage(webContents) {
	const productId = 'framescaper';
	const { source } = recipeSource(productId, 'webVcrStage', webVcrStageBody());
	return executeRecipe(webContents, productId, 'webVcrStage', source, false);
}

export function invokeFramescaperWebVcrSmokeGesture(webContents) {
	const productId = 'framescaper';
	const { source } = recipeSource(productId, 'webVcrGesture', webVcrGestureBody());
	return executeRecipe(webContents, productId, 'webVcrGesture', source, true);
}

/** Authenticate an actually executed app-origin recipe before excluding it. */
export function validateDesktopRendererDynamicSource({ productId: productValue, path, source }) {
	const productId = product(productValue);
	if (typeof path !== 'string' || typeof source !== 'string') {
		throw new TypeError('Renderer dynamic source attestation is invalid.');
	}
	const matches = Object.entries(DESKTOP_RENDERER_DYNAMIC_EXCLUSIONS).filter(([, recipe]) => (
		path.startsWith(recipe.pathPrefix)
	));
	if (matches.length !== 1) throw new Error('Renderer dynamic source path is not allowlisted.');
	const [recipeId, recipe] = matches[0];
	if (!recipe.products.includes(productId)) {
		throw new Error('Renderer dynamic source recipe is not admitted for this product.');
	}
	const digest = path.slice(recipe.pathPrefix.length, -'.js'.length);
	if (!path.endsWith('.js') || !/^[a-f\d]{64}$/u.test(digest)) {
		throw new Error('Renderer dynamic source path has no canonical recipe digest.');
	}
	if (Buffer.byteLength(source, 'utf8') > recipe.maximumBytes) {
		throw new Error('Renderer dynamic source exceeds its admitted byte limit.');
	}
	const suffix = `\n//# sourceURL=${productId}-app://bundle/${path}`;
	if (!source.endsWith(suffix) || source.slice(0, -suffix.length).includes('sourceURL=')) {
		throw new Error('Renderer dynamic source has a non-canonical source URL.');
	}
	const body = source.slice(0, -suffix.length);
	if (digestText(body) !== digest) throw new Error('Renderer dynamic source digest does not match its path.');
	let expectedBody;
	if (recipeId === 'runner') {
		expectedBody = validatedRunnerBody(productId, body);
	} else if (recipeId === 'stallWitness') {
		expectedBody = validatedStallWitnessBody(productId, body);
	} else if (recipeId === 'webVcrStage') {
		expectedBody = webVcrStageBody();
	} else {
		expectedBody = webVcrGestureBody();
	}
	if (body !== expectedBody) throw new Error('Renderer dynamic source is not the canonical recipe.');
	return Object.freeze({ digest, path, productId, recipeId });
}

function executeRecipe(webContents, productId, recipeId, source, userGesture) {
	if (!webContents || typeof webContents.executeJavaScript !== 'function') {
		throw new TypeError('Renderer smoke requires executable web contents.');
	}
	if (userGesture !== undefined && typeof userGesture !== 'boolean') {
		throw new TypeError('Renderer smoke user-gesture flag must be boolean.');
	}
	const path = sourceUrlPath(source);
	const attestation = validateDesktopRendererDynamicSource({ productId, path, source });
	if (attestation.recipeId !== recipeId) throw new Error('Renderer smoke recipe attestation disagrees.');
	return webContents.executeJavaScript(source, userGesture === true);
}

function recipeSource(productId, recipeId, body) {
	const recipe = DESKTOP_RENDERER_DYNAMIC_EXCLUSIONS[recipeId];
	const path = `${recipe.pathPrefix}${digestText(body)}.js`;
	return Object.freeze({ path, source: `${body}\n//# sourceURL=${productId}-app://bundle/${path}` });
}

function runnerBody(productId, request) {
	return `/* ${DESKTOP_RENDERER_DYNAMIC_EXCLUSIONS.runner.marker} */\nimport(${JSON.stringify(`${productId}-app://bundle/desktop-renderer-smoke.js`)}).then(({ runDesktopRendererSmokeEnvelope }) => runDesktopRendererSmokeEnvelope(globalThis, ${request}))`;
}

function validatedRunnerBody(productId, body) {
	const placeholder = '__REQUEST__';
	const template = runnerBody(productId, placeholder);
	const [prefix, suffix] = template.split(placeholder);
	if (!body.startsWith(prefix) || !body.endsWith(suffix)) {
		throw new Error('Renderer runner source does not match its canonical template.');
	}
	const encoded = body.slice(prefix.length, -suffix.length);
	let request;
	try { request = JSON.parse(encoded); } catch {
		throw new Error('Renderer runner source has malformed request data.');
	}
	if (!request || typeof request !== 'object' || Array.isArray(request)
		|| JSON.stringify(Object.keys(request).sort()) !== '["arguments","operation"]'
		|| !Array.isArray(request.arguments) || !OPERATIONS[productId].has(request.operation)) {
		throw new Error('Renderer runner source has an invalid request.');
	}
	return runnerBody(productId, canonicalJson({
		operation: request.operation,
		arguments: request.arguments,
	}));
}

function stallWitnessBody(stageKey) {
	return `/* ${DESKTOP_RENDERER_DYNAMIC_EXCLUSIONS.stallWitness.marker} */\n(() => {
	const stage = globalThis[${JSON.stringify(stageKey)}] ?? null;
	if (typeof stage !== 'string' || !stage) return null;
	const status = String(document.querySelector('[data-status]')?.textContent || '').replace(/\\s+/gu, ' ').trim();
	const progress = document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow') ?? null;
	return stage + (status ? ' (status: ' + status.slice(0, 160) + ')' : '') + (progress !== null ? ' (progress: ' + progress + ')' : '');
})()`;
}

function validatedStallWitnessBody(productId, body) {
	for (const [stageKey, products] of Object.entries(STALL_STAGE_KEYS)) {
		if (products.has(productId) && body === stallWitnessBody(stageKey)) return body;
	}
	throw new Error('Renderer stall witness is not a canonical admitted recipe.');
}

function webVcrStageBody() {
	return `/* ${DESKTOP_RENDERER_DYNAMIC_EXCLUSIONS.webVcrStage.marker} */\nglobalThis.__framescaperWebVcrSmokeStageV1 ?? null`;
}

function webVcrGestureBody() {
	return `/* ${DESKTOP_RENDERER_DYNAMIC_EXCLUSIONS.webVcrGesture.marker} */\n(() => {
	const invoke = globalThis.__framescaperWebVcrSmokeCaptureGestureV1;
	return typeof invoke === 'function' && invoke() === true;
})()`;
}

function rendererEnvelope(envelope) {
	if (envelope?.status === 'rejected') {
		throw new Error(typeof envelope.message === 'string' && envelope.message
			? envelope.message : 'Renderer smoke failed without diagnostic detail.');
	}
	if (envelope?.status !== 'fulfilled') {
		throw new TypeError('Renderer smoke returned a malformed diagnostic envelope.');
	}
	return envelope.value;
}

function sourceUrlPath(source) {
	const match = /\n\/\/# sourceURL=[a-z]+-app:\/\/bundle\/(.+)$/u.exec(source);
	if (match === null) throw new Error('Renderer smoke recipe has no final app-origin source URL.');
	return match[1];
}

function closedOptions(value, fields, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Reflect.ownKeys(value).some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`${label} options are invalid.`);
	}
	return value;
}

function product(value) {
	if (!PRODUCT_IDS.has(value)) throw new TypeError('Renderer smoke product is invalid.');
	return value;
}

function canonicalJson(value) {
	let encoded;
	try { encoded = JSON.stringify(value); } catch {
		throw new TypeError('Renderer smoke request is not JSON-serializable.');
	}
	if (encoded === undefined) throw new TypeError('Renderer smoke request is not JSON-serializable.');
	return encoded.replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
}

function digestText(value) {
	return createHash('sha256').update(value, 'utf8').digest('hex');
}
