import { openNodeSqliteDb } from '../support/nodeSqliteDb';
import { runDbContract } from '../support/dbContract';

runDbContract('Node sqlite', async () => openNodeSqliteDb());
