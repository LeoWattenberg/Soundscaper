import { docsAiRuntimeOptions, resolveOllamaUrl, resolveRoleModel } from './config.mjs';
import { InvalidModelOutputError } from './generation.mjs';

function modelCandidates(models, requested) {
	const exact = models.filter((entry) => entry.name === requested || entry.model === requested);
	if (exact.length) return exact;
	if (!requested.includes(':')) {
		return models.filter((entry) => entry.name === `${requested}:latest` || entry.model === `${requested}:latest`);
	}
	return [];
}

function assertJsonObject(value, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be a JSON object.`);
	return value;
}

export function createOllamaClient(options) {
	const fetchImpl = options.fetchImpl ?? fetch;
	const runtime = docsAiRuntimeOptions({ env: options.env });
	const requestedModel = resolveRoleModel(options.role, {
		env: options.env,
		override: options.model,
	});
	let endpointPromise;
	let identityPromise;

	async function endpoint() {
		endpointPromise ??= options.url
			? Promise.resolve(options.url.replace(/\/$/u, ''))
			: resolveOllamaUrl({ env: options.env, fetchImpl });
		return endpointPromise;
	}

	async function identity() {
		identityPromise ??= (async () => {
			const baseUrl = await endpoint();
			const response = await fetchImpl(`${baseUrl}/api/tags`, {
				signal: AbortSignal.timeout(Math.min(runtime.timeoutMs, 10_000)),
			});
			if (!response.ok) throw new Error(`Ollama model inventory returned HTTP ${response.status}.`);
			const payload = assertJsonObject(await response.json(), 'Ollama model inventory');
			const models = Array.isArray(payload.models) ? payload.models : [];
			const matches = modelCandidates(models, requestedModel);
			if (matches.length !== 1) {
				throw new Error(matches.length === 0
					? `Ollama model is not installed: ${requestedModel}`
					: `Ollama model name is ambiguous: ${requestedModel}`);
			}
			const match = matches[0];
			if (typeof match.digest !== 'string' || match.digest.length < 12) {
				throw new Error(`Ollama did not report an exact digest for ${requestedModel}.`);
			}
			return { model: match.name ?? match.model, digest: match.digest };
		})();
		return identityPromise;
	}

	async function generateJson({ system, prompt }) {
		const [baseUrl, modelIdentity] = await Promise.all([endpoint(), identity()]);
		const response = await fetchImpl(`${baseUrl}/api/generate`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				model: modelIdentity.model,
				system,
				prompt,
				stream: false,
				format: 'json',
				keep_alive: '5m',
				options: {
					temperature: runtime.temperature,
					seed: 0,
					num_predict: 4_096,
				},
			}),
			signal: AbortSignal.timeout(runtime.timeoutMs),
		});
		if (!response.ok) throw new Error(`Ollama generation returned HTTP ${response.status}.`);
		const payload = assertJsonObject(await response.json(), 'Ollama generation response');
		if (typeof payload.response !== 'string') throw new Error('Ollama generation response is missing response text.');
		try {
			return assertJsonObject(JSON.parse(payload.response), 'Model response');
		} catch (error) {
			throw new InvalidModelOutputError('The model did not return a valid JSON object.', { cause: error });
		}
	}

	return { identity, generateJson, runtime };
}
