import { nodeEnv } from '../envNode';
import { runScheduled } from '../services/scheduled';

// Local equivalent of the Cron Trigger: `npm run digest` (weekly digest + pending instant mails).
runScheduled(nodeEnv(), '0 4 * * 1').then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
