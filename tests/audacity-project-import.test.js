import assert from 'node:assert/strict';
import test from 'node:test';
import initSqlJs from 'sql.js';

import {
	audacityXmlAttribute,
	audacityXmlAttributes,
	audacityXmlChildren,
} from '../src/common/editor/audacity-binary-xml.js';
import { decodeAudacityProjectTree } from '../src/common/editor/aup4-conversion.js';
import {
	prepareAudacitySerializedDatabase,
	readAup4SampleBlock,
	upgradeAudacityProjectDatabase,
	validateAudacityProjectDatabase,
} from '../src/common/editor/aup4-database.js';
import { createAup4ProjectTree } from '../src/common/editor/aup4-profile.js';
import { createAup3Fixture } from './aup3-fixture.js';

const SQL = await initSqlJs();

test('AUP3 uses the shared private-copy migration and Audacity tree decoder', async () => {
	const sourceBytes = await createAup3Fixture({ SQL });
	const database = new SQL.Database(prepareAudacitySerializedDatabase(sourceBytes));
	try {
		const migration = upgradeAudacityProjectDatabase(database);
		assert.equal(migration.upgraded, true);
		assert.equal(migration.fromVersion, 0);
		const validation = validateAudacityProjectDatabase(database);
		let sequence = 0;
		const decoded = await decodeAudacityProjectTree(
			validation.document.root,
			async (blockId) => readAup4SampleBlock(database, blockId),
			{ sourceGeneration: 'aup3', idFactory: (prefix) => `${prefix}-${++sequence}` },
		);
		assert.equal(decoded.compatibilityReport.format, 'audacity-project');
		assert.equal(decoded.compatibilityReport.sourceGeneration, 'aup3');
		assert.deepEqual([...decoded.sources[0].channels[0]], [0.25, -0.5, 0.75, 0]);
	} finally {
		database.close();
	}

	const unchanged = new SQL.Database(sourceBytes);
	try {
		assert.equal(unchanged.exec('PRAGMA user_version')[0].values[0][0], 0);
		assert.equal(unchanged.exec("SELECT count(*) FROM sqlite_master WHERE name='project_history'")[0].values[0][0], 0);
	} finally {
		unchanged.close();
	}
});

test('AUP3 inherited project tempo keeps legacy clip timing through AUP4 export', async () => {
	const sourceBytes = await createAup3Fixture({
		SQL,
		projectTempo: 188,
		tracks: [{
			rate: 48_000,
			clips: [{
				blocks: [{ id: -48_000 }],
				stretchRatio: 188 / 130,
				rawAudioTempo: 130,
				trimLeft: 0.2,
				trimRight: 0.3,
			}],
		}],
	});
	const database = new SQL.Database(prepareAudacitySerializedDatabase(sourceBytes));
	try {
		upgradeAudacityProjectDatabase(database);
		const validation = validateAudacityProjectDatabase(database);
		let sequence = 0;
		const decoded = await decodeAudacityProjectTree(
			validation.document.root,
			async (blockId) => readAup4SampleBlock(database, blockId),
			{ sourceGeneration: 'aup3', idFactory: (prefix) => `${prefix}-${++sequence}` },
		);
		const [clip] = decoded.project.clips;
		assert.equal(clip.speedRatio, 1);
		assert.equal(clip.stretchToTempo, true);
		assert.equal(clip.sourceStartFrame, 9_600);
		assert.equal(clip.trimEndFrames, 14_400);
		assert.equal(clip.sourceDurationFrames, 24_000);
		assert.equal(clip.timelineStartFrame, 9_600);
		assert.equal(clip.durationFrames, 24_000);

		const blockMap = new Map([[
			`${clip.sourceId}:0`,
			[{ blockId: -48_000, start: 0, sampleCount: 48_000 }],
		]]);
		const exported = createAup4ProjectTree(decoded.project, blockMap);
		const exportedClip = audacityXmlChildren(audacityXmlChildren(exported, 'wavetrack')[0], 'waveclip')[0];
		assert.ok(Math.abs(audacityXmlAttribute(exportedClip, 'clipStretchRatio') - 188 / 130) < 1e-8);
		assert.equal(audacityXmlAttribute(exportedClip, 'clipStretchToMatchTempo'), true);
		assert.equal(audacityXmlAttribute(exportedClip, 'rawAudioTempo'), 130);
		assert.equal(audacityXmlAttributes(exportedClip, 'clipTempo').length, 0);
		assert.equal(audacityXmlAttribute(exportedClip, 'trimLeft'), 0.2);
		assert.equal(audacityXmlAttribute(exportedClip, 'trimRight'), 0.3);
		assert.equal(audacityXmlAttribute(exportedClip, 'offset'), 0);

		sequence = 0;
		const reopened = await decodeAudacityProjectTree(exported, async () => null, {
			idFactory: (prefix) => `${prefix}-${++sequence}`,
		});
		assert.equal(reopened.project.clips[0].speedRatio, 1);
		assert.equal(reopened.project.clips[0].durationFrames, 24_000);
	} finally {
		database.close();
	}
});
