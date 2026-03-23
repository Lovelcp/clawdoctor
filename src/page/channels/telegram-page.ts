// ===============================================
//  Telegram Page Channel
//  Sends alert messages via Telegram Bot API.
//  Uses HTML parse mode for rich formatting.
// ===============================================

import type { PageChannel } from "../page-channel.js";
import type { PageMessage, PagePriority, SendResult } from "../../types/monitor.js";

const PRIORITY_EMOJI: Readonly<Record<PagePriority, string>> = {
  info: "ℹ️",
  warning: "⚠️",
  critical: "🔴",
  emergency: "🚨",
};

function formatMessage(msg: PageMessage): string {
  const emoji = PRIORITY_EMOJI[msg.priority];
  const title = msg.title.en;
  const body = msg.body.en;
  const ts = new Date(msg.timestamp).toISOString();

  const lines: string[] = [
    `${emoji} <b>[${msg.priority.toUpperCase()}]</b> ${title}`,
    "",
    body,
  ];

  if (msg.diseaseId) {
    lines.push(`\n<b>Disease:</b> ${msg.diseaseId}`);
  }
  if (msg.agentId) {
    lines.push(`<b>Agent:</b> ${msg.agentId}`);
  }
  if (msg.probeId) {
    lines.push(`<b>Probe:</b> ${msg.probeId}`);
  }
  lines.push(`<b>Time:</b> ${ts}`);

  return lines.join("\n");
}

/**
 * Create a Telegram page channel that sends alerts via Bot API.
 *
 * @param botToken - Telegram bot token (from BotFather)
 * @param chatId - Target chat ID (user, group, or channel)
 */
export function createTelegramPageChannel(
  botToken: string,
  chatId: string,
): PageChannel {
  const baseUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;

  return {
    type: "telegram",

    async send(msg: PageMessage): Promise<SendResult> {
      const text = formatMessage(msg);

      try {
        const response = await fetch(baseUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: "HTML",
          }),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          return { success: false, error: `Telegram API ${response.status}: ${errorBody}` };
        }

        return { success: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: message };
      }
    },
  };
}
