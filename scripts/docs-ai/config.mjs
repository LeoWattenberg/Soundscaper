import { readFileSync } from 'node:fs';

const DEFAULT_MODEL = 'qwen3.8:latest';
const DEFAULT_PORT = 11434;

function normalizeOllamaUrl(value) {
	const url = new URL(value);
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error(`OLLAMA_URL must use http or https: ${value}`);
	}
	if (url.username || url.password || url.search || url.hash) {
		throw new Error('OLLAMA_URL must not include credentials, a query, or a fragment.');
	}
	return url.toString().replace(/\/$/u, '');
}

function currentWslState() {
	try {
		return /microsoft|wsl/iu.test(readFileSync('/proc/version', 'utf8'));
	} catch {
		return false;
	}
}

function currentResolvConf() {
	try {
		return readFileSync('/etc/resolv.conf', 'utf8');
	} catch {
		return '';
	}
}

function currentRouteTable() {
	try {
		return readFileSync('/proc/net/route', 'utf8');
	} catch {
		return '';
	}
}

function gatewayFromRouteTable(contents) {
	for (const line of contents.split(/\r?\n/u).slice(1)) {
		const fields = line.trim().split(/\s+/u);
		if (fields.length < 4 || fields[1] !== '00000000' || !/^[0-9a-f]{8}$/iu.test(fields[2])) continue;
		const flags = Number.parseInt(fields[3], 16);
		if ((flags & 0x2) === 0 || fields[2] === '00000000') continue;
		return fields[2]
			.match(/.{2}/gu)
			.reverse()
			.map((octet) => Number.parseInt(octet, 16))
			.join('.');
	}
	return null;
}

function nameserverFromResolvConf(contents) {
	for (const line of contents.split(/\r?\n/u)) {
		const match = line.match(/^\s*nameserver\s+([^\s#]+)/u);
		if (!match) continue;
		try {
			const url = new URL(`http://${match[1]}:${DEFAULT_PORT}`);
			if (url.hostname) return url.hostname;
		} catch {
			// Ignore malformed resolver entries and retain the localhost fallback.
		}
	}
	return null;
}

export function ollamaUrlCandidates(options = {}) {
	const env = options.env ?? process.env;
	const configured = env.OLLAMA_DOCS_URL ?? env.OLLAMA_URL;
	if (configured) return [normalizeOllamaUrl(configured)];

	const isWsl = options.isWsl ?? currentWslState();
	const candidates = [];
	if (isWsl) {
		const routeGateway = gatewayFromRouteTable(options.routeTable ?? currentRouteTable());
		if (routeGateway) candidates.push(normalizeOllamaUrl(`http://${routeGateway}:${DEFAULT_PORT}`));
		const gateway = nameserverFromResolvConf(options.resolvConf ?? currentResolvConf());
		if (gateway) candidates.push(normalizeOllamaUrl(`http://${gateway}:${DEFAULT_PORT}`));
	}
	candidates.push(`http://127.0.0.1:${DEFAULT_PORT}`);
	return [...new Set(candidates)];
}

export async function resolveOllamaUrl(options = {}) {
	const candidates = options.candidates ?? ollamaUrlCandidates(options);
	const fetchImpl = options.fetchImpl ?? fetch;
	const timeoutMs = options.probeTimeoutMs ?? 1_500;
	const failures = [];

	for (const candidate of candidates) {
		try {
			const response = await fetchImpl(`${candidate}/api/version`, {
				signal: AbortSignal.timeout(timeoutMs),
			});
			if (response.ok) return candidate;
			failures.push(`${candidate} returned HTTP ${response.status}`);
		} catch (error) {
			failures.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	throw new Error(`Ollama is not reachable. Tried ${failures.join('; ')}. Set OLLAMA_URL explicitly if needed.`);
}

export function resolveRoleModel(role, options = {}) {
	if (options.override) return options.override;
	const env = options.env ?? process.env;
	const roleVariable = `OLLAMA_DOCS_${role.toUpperCase()}_MODEL`;
	return env[roleVariable] ?? env.OLLAMA_MODEL ?? DEFAULT_MODEL;
}

export function docsAiRuntimeOptions(options = {}) {
	const env = options.env ?? process.env;
	const temperature = Number(env.OLLAMA_DOCS_TEMPERATURE ?? 0.1);
	const timeoutMs = Number(env.OLLAMA_DOCS_TIMEOUT_MS ?? 120_000);
	const maxChunkChars = Number(env.OLLAMA_DOCS_CHUNK_CHARS ?? 6_000);

	if (!Number.isFinite(temperature) || temperature < 0 || temperature > 0.3) {
		throw new Error('OLLAMA_DOCS_TEMPERATURE must be between 0 and 0.3.');
	}
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 600_000) {
		throw new Error('OLLAMA_DOCS_TIMEOUT_MS must be an integer from 1000 through 600000.');
	}
	if (!Number.isSafeInteger(maxChunkChars) || maxChunkChars < 1_000 || maxChunkChars > 20_000) {
		throw new Error('OLLAMA_DOCS_CHUNK_CHARS must be an integer from 1000 through 20000.');
	}

	return { temperature, timeoutMs, maxChunkChars };
}
