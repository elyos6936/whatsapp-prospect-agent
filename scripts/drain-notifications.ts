import { getGreenApiCredentials } from "../src/greenapi.js";

const creds = getGreenApiCredentials()!;
function url(method: string, suffix = "") {
  return `${creds.baseUrl}/waInstance${creds.idInstance}/${method}/${creds.apiToken}${suffix}`;
}

const types: Record<string, number> = {};
for (let i = 0; i < 25; i++) {
  const res = await fetch(url("receiveNotification") + "?receiveTimeout=1");
  const text = await res.text();
  if (!text || text === "null") {
    console.log(`[${i + 1}] null`);
    continue;
  }
  const data = JSON.parse(text);
  const tw = data.body?.typeWebhook ?? "unknown";
  types[tw] = (types[tw] ?? 0) + 1;
  console.log(`[${i + 1}] receiptId=${data.receiptId} type=${tw}`);
  if (tw === "incomingMessageReceived") {
    const chat = data.body?.senderData?.chatId;
    const msg = data.body?.messageData?.textMessageData?.textMessage
      ?? data.body?.messageData?.extendedTextMessageData?.text
      ?? data.body?.messageData?.typeMessage;
    console.log("    INCOMING:", chat, msg);
  }
  if (data.receiptId) {
    await fetch(url("deleteNotification", `/${data.receiptId}`), { method: "DELETE" });
  }
}
console.log("\nSummary:", types);
