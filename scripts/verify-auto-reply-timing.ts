/**
 * Vérifie: auto_reply n'attend pas le slot campagne ; coalesce par chat.
 * Run: npx tsx scripts/verify-auto-reply-timing.ts
 */
import {
  waitOutboundSpacingForUser,
  markOutboundSentForUser,
} from "../src/anti-ban.js";
import { enqueueAutoReply, getAutoReplyQueueSize } from "../src/auto-reply-queue.js";

async function testSpacing() {
  const userId = 999001;
  await waitOutboundSpacingForUser(userId);
  markOutboundSentForUser(userId); // réserve 40–80 s campagne

  const start = Date.now();
  await waitOutboundSpacingForUser(userId, { profile: "auto_reply" });
  const waited = Date.now() - start;
  markOutboundSentForUser(userId, { profile: "auto_reply" });

  if (waited > 6_000) {
    throw new Error(`FAIL: auto_reply a attendu la campagne (${waited}ms)`);
  }
  console.log(`OK spacing auto_reply après campagne: wait=${waited}ms (<6s)`);
}

function testCoalesce() {
  enqueueAutoReply(
    { userId: 1, chatId: "a@c.us", senderName: "A", text: "1" },
    async () => undefined
  );
  enqueueAutoReply(
    { userId: 1, chatId: "b@c.us", senderName: "B", text: "1" },
    async () => undefined
  );
  enqueueAutoReply(
    { userId: 1, chatId: "a@c.us", senderName: "A", text: "2" },
    async () => undefined
  );
  const size = getAutoReplyQueueSize(1);
  if (size !== 2) {
    throw new Error(`FAIL coalesce size=${size} (attendu 2)`);
  }
  console.log(`OK coalesce: 2 chats programmés (A écrasé), size=${size}`);
}

await testSpacing();
testCoalesce();
console.log("ALL CHECKS PASSED");
process.exit(0);
