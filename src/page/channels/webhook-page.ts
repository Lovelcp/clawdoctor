// ===============================================
//  Webhook Page Channel
//  Sends alert messages as JSON POST requests.
//  Optionally signs payloads with HMAC-SHA256.
// ===============================================

import { createHmac } from "node:crypto";
import type { PageChannel } from "../page-channel.js";
import type { PageMessage, SendResult } from "../../types/monitor.js";

/**
 * Create a webhook page channel that POSTs JSON payloads.
 *
 * @param url - Target webhook URL
 * @param secret - Optional HMAC-SHA256 signing secret.
 *   When provided, requests include an `X-ClawDoc-Signature: sha256=<hex>` header.
 */
export function createWebhookPageChannel(
  url: string,
  secret?: string,
): PageChannel {
  return {
    type: "webhook",

    async send(msg: PageMessage): Promise<SendResult> {
      const payload = JSON.stringify({
        priority: msg.priority,
        title: msg.title,
        body: msg.body,
        diseaseId: msg.diseaseId,
        probeId: msg.probeId,
        agentId: msg.agentId,
        timestamp: msg.timestamp,
      });

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (secret) {
        const hmac = createHmac("sha256", secret)
          .update(payload)
          .digest("hex");
        headers["X-ClawDoc-Signature"] = `sha256=${hmac}`;
      }

      try {
        const response = await fetch(url, {
          method: "POST",
          headers,
          body: payload,
        });

        if (!response.ok) {
          return {
            success: false,
            error: `Webhook ${response.status}: ${response.statusText}`,
          };
        }

        return { success: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: message };
      }
    },
  };
}
