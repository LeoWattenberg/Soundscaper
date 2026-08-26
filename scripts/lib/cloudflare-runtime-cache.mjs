/* SPDX-License-Identifier: AGPL-3.0-only */

const PHASE = 'http_request_cache_settings';
const API_ROOT = 'https://api.cloudflare.com/client/v4';

export function runtimeCacheRules(policy) {
	const pointerPath = `/${policy.publicPrefix}/${policy.pointer.name}`;
	const releasePrefix = `/${policy.publicPrefix}/${policy.releaseSegment}/`;
	return Object.freeze([
		Object.freeze({
			ref: policy.cloudflare.pointerRuleRef,
			description: 'Soundscaper FFmpeg mutable pointer: never cache',
			expression: `(http.host eq ${JSON.stringify(new URL(policy.publicOrigin).hostname)} and http.request.uri.path eq ${JSON.stringify(pointerPath)})`,
			action: 'set_cache_settings',
			action_parameters: Object.freeze({
				cache: false,
				browser_ttl: Object.freeze({ mode: 'respect_origin' }),
			}),
		}),
		Object.freeze({
			ref: policy.cloudflare.releaseRuleRef,
			description: 'Soundscaper FFmpeg content-addressed releases: respect immutable origin metadata',
			expression: `(http.host eq ${JSON.stringify(new URL(policy.publicOrigin).hostname)} and starts_with(http.request.uri.path, ${JSON.stringify(releasePrefix)}))`,
			action: 'set_cache_settings',
			action_parameters: Object.freeze({
				cache: true,
				edge_ttl: Object.freeze({ mode: 'respect_origin' }),
				browser_ttl: Object.freeze({ mode: 'respect_origin' }),
			}),
		}),
		Object.freeze({
			ref: policy.cloudflare.pagesRuleRef,
			description: 'Soundscaper Pages responses: preserve checked-in browser cache headers',
			expression: `(http.host eq ${JSON.stringify(new URL(policy.pages.origin).hostname)})`,
			action: 'set_cache_settings',
			action_parameters: Object.freeze({
				browser_ttl: Object.freeze({ mode: 'respect_origin' }),
			}),
		}),
	]);
}

export async function configureRuntimeCacheRules({
	policy,
	zoneId = process.env.CLOUDFLARE_ZONE_ID,
	apiToken = process.env.CLOUDFLARE_API_TOKEN,
	fetchImpl = fetch,
} = {}) {
	assert(policy, 'FFmpeg runtime publication policy is required');
	assert(typeof zoneId === 'string' && /^[a-f\d]{32}$/u.test(zoneId),
		'CLOUDFLARE_ZONE_ID must be a 32-character hexadecimal zone ID');
	assert(typeof apiToken === 'string' && apiToken.length >= 20,
		'CLOUDFLARE_API_TOKEN with Cache Settings Write permission is required');
	const headers = { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' };
	const entrypointUrl = `${API_ROOT}/zones/${zoneId}/rulesets/phases/${PHASE}/entrypoint`;
	const currentResponse = await fetchImpl(entrypointUrl, { method: 'GET', headers });
	const currentPayload = await parseApiResponse(currentResponse, [200, 404], 'read cache ruleset entrypoint');
	const desired = runtimeCacheRules(policy);
	if (currentResponse.status === 404) {
		const created = await fetchImpl(`${API_ROOT}/zones/${zoneId}/rulesets`, {
			method: 'POST',
			headers,
			body: JSON.stringify({
				name: 'Soundscaper runtime cache policy',
				kind: 'zone',
				phase: PHASE,
				rules: desired,
			}),
		});
		await parseApiResponse(created, [200], 'create cache ruleset entrypoint');
		return Object.freeze({ action: 'created', ruleCount: desired.length });
	}
	const ruleset = currentPayload.result;
	assert(typeof ruleset?.id === 'string' && Array.isArray(ruleset.rules),
		'Cloudflare cache ruleset entrypoint response is malformed');
	const refs = new Set();
	for (const rule of ruleset.rules) {
		if (!rule.ref) continue;
		assert(!refs.has(rule.ref), `Cloudflare cache ruleset contains duplicate ref ${rule.ref}`);
		refs.add(rule.ref);
	}
	const desiredByRef = new Map(desired.map((rule) => [rule.ref, rule]));
	const merged = ruleset.rules.map((rule) => desiredByRef.get(rule.ref) ?? writableRule(rule));
	for (const rule of desired) if (!refs.has(rule.ref)) merged.push(rule);
	const updated = await fetchImpl(`${API_ROOT}/zones/${zoneId}/rulesets/${ruleset.id}`, {
		method: 'PUT',
		headers,
		body: JSON.stringify({
			description: ruleset.description || '',
			rules: merged,
		}),
	});
	await parseApiResponse(updated, [200], 'update cache ruleset entrypoint');
	return Object.freeze({ action: 'updated', ruleCount: merged.length });
}

function writableRule(rule) {
	const { id: _id, version: _version, last_updated: _lastUpdated, ...writable } = rule;
	return writable;
}

async function parseApiResponse(response, statuses, label) {
	const payload = await response.json().catch(() => null);
	assert(statuses.includes(response.status) && (response.status === 404 || payload?.success === true),
		`Failed to ${label}: Cloudflare returned HTTP ${String(response.status)}`);
	return payload;
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}
