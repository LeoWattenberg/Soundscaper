const RELEASES_API = 'https://api.github.com/repos/LeoWattenberg/Soundscaper/releases?per_page=20';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export class ReleaseChecker {
	#currentVersion;
	#fetch;
	#now;
	#settings;

	constructor({ currentVersion, settings, fetchImpl = fetch, now = Date.now }) {
		this.#currentVersion = currentVersion;
		this.#settings = settings;
		this.#fetch = fetchImpl;
		this.#now = now;
	}

	async check({ manual = false } = {}) {
		const settings = this.#settings.snapshot();
		if (!settings.updatesEnabled && !manual) return Object.freeze({ status: 'disabled' });
		const lastCheck = Date.parse(settings.lastUpdateCheck);
		if (!manual && Number.isFinite(lastCheck) && this.#now() - lastCheck < CHECK_INTERVAL_MS) {
			return Object.freeze({ status: 'throttled' });
		}
		try {
			await this.#settings.recordUpdateCheck(this.#now());
			const response = await this.#fetch(RELEASES_API, {
				headers: {
					Accept: 'application/vnd.github+json',
					'X-GitHub-Api-Version': '2022-11-28',
				},
				signal: AbortSignal.timeout(10_000),
			});
			if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
			const releases = await response.json();
			const release = selectUpdate(releases, this.#currentVersion);
			return release
				? Object.freeze({ status: 'available', version: normalizeVersion(release.tag_name), prerelease: release.prerelease === true })
				: Object.freeze({ status: 'current' });
		} catch {
			return manual
				? Object.freeze({ status: 'error', message: 'Could not check for updates.' })
				: Object.freeze({ status: 'offline' });
		}
	}
}

export function selectUpdate(releases, currentVersion) {
	const current = parseVersion(currentVersion);
	if (!current) return null;
	const includePrereleases = current.prerelease.length > 0;
	return (Array.isArray(releases) ? releases : [])
		.filter((release) => release && !release.draft && (!release.prerelease || includePrereleases))
		.map((release) => ({ release, version: parseVersion(release.tag_name) }))
		.filter(({ version }) => version && compareVersions(version, current) > 0)
		.sort((left, right) => compareVersions(right.version, left.version))[0]?.release || null;
}

export function compareVersions(leftValue, rightValue) {
	const left = typeof leftValue === 'string' ? parseVersion(leftValue) : leftValue;
	const right = typeof rightValue === 'string' ? parseVersion(rightValue) : rightValue;
	if (!left || !right) throw new TypeError('Invalid semantic version');
	for (const key of ['major', 'minor', 'patch']) {
		if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
	}
	if (!left.prerelease.length && !right.prerelease.length) return 0;
	if (!left.prerelease.length) return 1;
	if (!right.prerelease.length) return -1;
	const length = Math.max(left.prerelease.length, right.prerelease.length);
	for (let index = 0; index < length; index += 1) {
		const leftPart = left.prerelease[index];
		const rightPart = right.prerelease[index];
		if (leftPart === undefined) return -1;
		if (rightPart === undefined) return 1;
		if (leftPart === rightPart) continue;
		const leftNumber = /^\d+$/u.test(leftPart) ? Number(leftPart) : null;
		const rightNumber = /^\d+$/u.test(rightPart) ? Number(rightPart) : null;
		if (leftNumber !== null && rightNumber !== null) return leftNumber < rightNumber ? -1 : 1;
		if (leftNumber !== null) return -1;
		if (rightNumber !== null) return 1;
		return leftPart < rightPart ? -1 : 1;
	}
	return 0;
}

function parseVersion(value) {
	const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(String(value || '').trim());
	if (!match) return null;
	return {
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
		prerelease: match[4] ? match[4].split('.') : [],
	};
}

function normalizeVersion(value) {
	return String(value || '').trim().replace(/^v/u, '');
}
