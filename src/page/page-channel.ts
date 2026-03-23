// ===============================================
//  Page Channel Interface
//  Each channel implementation knows how to deliver
//  a PageMessage to a specific backend (Telegram,
//  Webhook, etc.).
// ===============================================

import type { PageMessage, SendResult } from "../types/monitor.js";

export type PageChannel = {
  readonly type: "telegram" | "webhook";
  readonly send: (msg: PageMessage) => Promise<SendResult>;
};
