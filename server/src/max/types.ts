// Подмножество типов MAX Bot API (https://dev.max.ru/docs-api), нужное боту.

export interface MaxUser {
  user_id: number;
  first_name?: string;
  last_name?: string | null;
  name?: string;
  username?: string | null;
  is_bot?: boolean;
  last_activity_time?: number;
}

export interface MaxMessage {
  sender?: MaxUser | null;
  recipient: { chat_id: number | null; chat_type: string; user_id: number | null };
  timestamp: number;
  body: { mid: string; seq: number; text: string | null; attachments?: unknown[] | null };
}

export type MaxUpdate =
  | { update_type: 'message_created'; timestamp: number; message: MaxMessage; user_locale?: string | null }
  | {
      update_type: 'message_callback';
      timestamp: number;
      callback: { timestamp: number; callback_id: string; payload?: string; user: MaxUser };
      message?: MaxMessage | null;
      user_locale?: string | null;
    }
  | { update_type: 'bot_started'; timestamp: number; chat_id: number; user: MaxUser; payload?: string | null; user_locale?: string | null }
  | { update_type: string; timestamp: number; [key: string]: unknown };

export type Button =
  | { type: 'callback'; text: string; payload: string; intent?: 'default' | 'positive' | 'negative' }
  | { type: 'link'; text: string; url: string }
  | { type: 'open_app'; text: string; web_app: string; contact_id?: number; payload?: string }
  | { type: 'message'; text: string };

export interface InlineKeyboard {
  type: 'inline_keyboard';
  payload: { buttons: Button[][] };
}

export interface NewMessageBody {
  text: string;
  attachments?: InlineKeyboard[] | null;
  format?: 'markdown' | 'html';
  notify?: boolean;
}

export interface BotInfo {
  user_id: number;
  first_name: string;
  username?: string | null;
  is_bot: boolean;
}
