import assert from 'node:assert/strict';
import test from 'node:test';
import initSqlJs from 'sql.js';

import { decodeAudacityProjectTree } from '../src/common/editor/aup4-conversion.js';
import {
	prepareAudacitySerializedDatabase,
	readAup4SampleBlock,
	upgradeAudacityProjectDatabase,
	validateAudacityProjectDatabase,
} from '../src/common/editor/aup4-database.js';
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
