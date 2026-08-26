/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import policy from '../config/ffmpeg-runtime-publication-policy.json' with { type: 'json' };
import {
	configureRuntimeCacheRules,
	runtimeCacheRules,
} from '../scripts/lib/cloudflare-runtime-cache.mjs';

const ZONE = 'a'.repeat(32);
const TOKEN = 'token-with-cache-settings-write';

test('stable-ref cache rules bypass the pointer and respect runtime and Pages origin metadata', () => {
	const [pointer, releases, pages] = runtimeCacheRules(policy);
	assert.equal(pointer.ref, 'soundscaper-ffmpeg-runtime-pointer-v1');
	assert.deepEqual(pointer.action_parameters, {
		cache: false,
		browser_ttl: { mode: 'respect_origin' },
	});
	assert.match(pointer.expression, /latest\.json/u);
	assert.equal(releases.ref, 'soundscaper-ffmpeg-runtime-releases-v1');
	assert.deepEqual(releases.action_parameters, {
		cache: true,
		edge_ttl: { mode: 'respect_origin' },
		browser_ttl: { mode: 'respect_origin' },
	});
	assert.match(releases.expression, /\/releases\//u);
	assert.equal(pages.ref, 'soundscaper-pages-browser-origin-v1');
	assert.equal(pages.expression, '(http.host eq "soundscaper.org")');
	assert.deepEqual(pages.action_parameters, {
		browser_ttl: { mode: 'respect_origin' },
	});
});

test('configuration replaces owned refs while preserving unrelated cache rules', async () => {
	const requests = [];
	const unrelated = {
		id: 'server-rule-id',
		ref: 'unrelated-rule-v3',
		description: 'keep me',
		expression: '(http.host eq "example.org")',
		action: 'set_cache_settings',
		action_parameters: {
			cache: true,
			cache_key: { custom_key: { query_string: { include: ['*'] } } },
		},
		version: '7',
		last_updated: '2026-01-01T00:00:00Z',
	};
	const broadUnrelated = {
		ref: 'unrelated-broad-rule-v1',
		description: 'broad rule must stay before the owned safety rules',
		expression: '(http.host contains "soundscaper.org")',
		action: 'set_cache_settings',
		action_parameters: { cache: true },
	};
	const fetchImpl = async (url, options) => {
		requests.push({ url, options });
		if (options.method === 'GET') return apiResponse(200, {
			id: 'ruleset-id', name: 'Existing', description: 'Existing rules', kind: 'zone',
			rules: [
				unrelated,
				{ ...runtimeCacheRules(policy)[0], action_parameters: { cache: true } },
				broadUnrelated,
			],
		});
		return apiResponse(200, { id: 'ruleset-id' });
	};
	const result = await configureRuntimeCacheRules({
		policy, zoneId: ZONE, apiToken: TOKEN, fetchImpl,
	});
	assert.deepEqual(result, { action: 'updated', ruleCount: 5 });
	const body = JSON.parse(requests[1].options.body);
	assert.deepEqual(Object.keys(body).sort(), ['description', 'rules'],
		'Cloudflare ruleset updates may include only writable properties');
	assert.equal(body.rules[0].ref, unrelated.ref);
	assert.equal(body.rules[0].id, undefined);
	assert.equal(body.rules[0].description, 'keep me');
	assert.deepEqual(body.rules[0].action_parameters, unrelated.action_parameters,
		'a custom cache key proven disjoint from the runtime host is preserved');
	assert.equal(body.rules[1].ref, broadUnrelated.ref,
		'unrelated rules retain their relative order ahead of owned terminal rules');
	assert.deepEqual(body.rules[2].action_parameters, {
		cache: false,
		browser_ttl: { mode: 'respect_origin' },
	});
	assert.equal(body.rules[3].ref, policy.cloudflare.releaseRuleRef);
	assert.equal(body.rules[4].ref, policy.cloudflare.pagesRuleRef);
	assert.deepEqual(
		body.rules.slice(-3).map(({ ref }) => ref),
		runtimeCacheRules(policy).map(({ ref }) => ref),
		'owned cache rules must run last so a broad pre-existing rule cannot override them',
	);
});

test('configuration refuses a preserved custom cache key that could shard exact runtime purges', async () => {
	const requests = [];
	const broadCustomKey = {
		ref: 'unrelated-runtime-cache-key-v1',
		description: 'broad custom key would survive the owned TTL rule',
		expression: '(http.host contains "soundscaper.org")',
		action: 'set_cache_settings',
		action_parameters: {
			cache: true,
			cache_key: {
				custom_key: {
					header: { include: ['accept-language'] },
				},
			},
		},
	};
	const fetchImpl = async (_url, options) => {
		requests.push(options.method);
		if (options.method !== 'GET') throw new Error('ruleset mutation must not occur');
		return apiResponse(200, {
			id: 'ruleset-id', name: 'Existing', description: 'Existing rules', kind: 'zone',
			rules: [broadCustomKey],
		});
	};

	await assert.rejects(
		() => configureRuntimeCacheRules({
			policy, zoneId: ZONE, apiToken: TOKEN, fetchImpl,
		}),
		/custom cache key.*unrelated-runtime-cache-key-v1.*exact URL purges/iu,
	);
	assert.deepEqual(requests, ['GET']);
});

test('the CLI checks publication authorization before constructing a Cloudflare request', async () => {
	const source = await readFile('scripts/configure-ffmpeg-runtime-cache.mjs', 'utf8');
	assert.ok(
		source.indexOf("purpose: 'runtime-publication'") < source.indexOf('const result = await configureRuntimeCacheRules'),
		'authorization verification must precede cache configuration',
	);
});

function apiResponse(status, result) {
	return new Response(JSON.stringify({ success: status === 200, result }), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}
