import {
  cancelPendingSendQueue,
  countOutboundToday,
  DAILY_OUTBOUND_LIMIT,
  pauseAllActiveAutomations,
  setAutoReplyEnabled,
} from "../src/db.js";
import { sql } from "../src/pg.js";

const cancelledQueue = await cancelPendingSendQueue();
const pausedAutomations = await pauseAllActiveAutomations();
await setAutoReplyEnabled(false);

console.log(
  JSON.stringify(
    {
      cancelledQueue,
      pausedAutomations,
      outboundToday: await countOutboundToday(),
      limit: DAILY_OUTBOUND_LIMIT,
      autoReplyEnabled: false,
    },
    null,
    2
  )
);

await sql.end();
