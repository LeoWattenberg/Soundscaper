/* SPDX-License-Identifier: AGPL-3.0-only */

export const M4_PARITY_VIDEO_CASES = Object.freeze([
	Object.freeze({ name: 'gradient-color-adjust', fixtureArtifactId: 'gradient' }),
	Object.freeze({ name: 'edge-gaussian-blur', fixtureArtifactId: 'edge' }),
	Object.freeze({ name: 'transparency-vignette', fixtureArtifactId: 'transparency' }),
	Object.freeze({ name: 'color-chart-baseline', fixtureArtifactId: 'color-chart' }),
	Object.freeze({ name: 'composition-blend-normal', fixtureArtifactId: 'transparency' }),
	Object.freeze({ name: 'composition-blend-multiply', fixtureArtifactId: 'transparency' }),
	Object.freeze({ name: 'composition-blend-screen', fixtureArtifactId: 'transparency' }),
	Object.freeze({ name: 'composition-blend-overlay', fixtureArtifactId: 'transparency' }),
	Object.freeze({ name: 'composition-blend-darken', fixtureArtifactId: 'transparency' }),
	Object.freeze({ name: 'composition-blend-lighten', fixtureArtifactId: 'transparency' }),
	Object.freeze({ name: 'composition-blend-difference', fixtureArtifactId: 'transparency' }),
	Object.freeze({ name: 'composition-blend-exclusion', fixtureArtifactId: 'transparency' }),
	Object.freeze({ name: 'composition-combined-transform-order', fixtureArtifactId: 'gradient' }),
]);

const ARTIFACT_IDS = Object.freeze(['gradient', 'color-chart', 'edge', 'transparency']);

/** Validate the exact registered 128x72 RGBA fixture inventory. */
export function validateM4ParityVideoFixture(value, width, height) {
	const fixture = requireRecord(value, 'video fixture');
	const specification = exactRecord(
		fixture.specification,
		['height', 'pixelFormat', 'width'],
		'video fixture specification',
	);
	if (specification.width !== width
		|| specification.height !== height
		|| specification.pixelFormat !== 'rgba') {
		throw new Error('Registered M4 video fixture geometry or pixel format is invalid.');
	}
	if (!Array.isArray(fixture.artifacts) || fixture.artifacts.length !== ARTIFACT_IDS.length) {
		throw new Error('Registered M4 video fixture must contain exactly four artifacts.');
	}
	const artifacts = new Map();
	for (const [index, candidate] of fixture.artifacts.entries()) {
		const artifact = exactRecord(
			candidate,
			['byteLength', 'id', 'sha256'],
			`video fixture artifact ${index}`,
		);
		if (!ARTIFACT_IDS.includes(artifact.id) || artifacts.has(artifact.id)) {
			throw new Error('Registered M4 video fixture artifact inventory is invalid.');
		}
		if (artifact.byteLength !== width * height * 4
			|| typeof artifact.sha256 !== 'string'
			|| !/^[a-f\d]{64}$/u.test(artifact.sha256)) {
			throw new Error(`Registered M4 video fixture artifact ${artifact.id} is not digest-pinned.`);
		}
		artifacts.set(artifact.id, Object.freeze({ ...artifact }));
	}
	if (ARTIFACT_IDS.some((id) => !artifacts.has(id))) {
		throw new Error('Registered M4 video fixture artifact inventory is incomplete.');
	}
	return Object.freeze({ artifacts, cases: M4_PARITY_VIDEO_CASES });
}

function exactRecord(value, fields, path) {
	const record = requireRecord(value, path);
	const actual = Object.keys(record).sort();
	const expected = [...fields].sort();
	if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
		throw new Error(`${path} must contain the exact fields.`);
	}
	return record;
}

function requireRecord(value, path) {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`${path} must be a record.`);
	}
	return value;
}
