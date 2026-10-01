// Row shapes used across the app (kept in step with supabase/migrations).

export type PostingRules = {
  amTime: string; // "08:00"
  deadlineTime: string; // "20:30"
  defaults: PillarTimes;
  pillars: ({ pillar: string } & PillarTimes)[];
};
export type PillarTimes = { weekday: string; weekend: string; evening: string };

/** A social account at whichever provider the client publishes through. */
export type ChannelMapping = {
  platform: string; // instagram | facebook | linkedin | tiktok | ...
  channelId: string;
  channelName: string;
  calendarName?: string; // how the calendar's Platform column names it, e.g. "IG"
};
/** @deprecated kept so older imports keep compiling */
export type BufferChannel = ChannelMapping;

export type PushProvider = "buffer" | "contentstudio";
export const PROVIDER_LABEL: Record<PushProvider, string> = {
  buffer: "Buffer",
  contentstudio: "ContentStudio",
};

export type Client = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  drive_folder_id: string | null;
  push_provider: PushProvider;
  buffer_api_key_enc: string | null;
  buffer_channels: ChannelMapping[];
  contentstudio_api_key_enc: string | null;
  contentstudio_workspace_id: string | null;
  contentstudio_workspace_tz: string | null;
  contentstudio_channels: ChannelMapping[];
  klaviyo_api_key_enc: string | null;
  posting_rules: Partial<PostingRules>;
  import_mapping: Partial<Record<"social" | "email", Record<string, string>>>;
  placeholder_image_url: string | null;
  reuse_window_days: number;
  created_at: string;
};

export type BrandProfile = {
  client_id: string;
  voice_notes: string;
  words_to_avoid: string[];
  compliance_notes: string;
  colours: Record<string, string>;
  fonts: Record<string, string>;
  logo_url: string | null;
  email_footer: Record<string, string>;
  standing_hashtags: string[];
  standing_ctas: string[];
};

export type Calendar = {
  id: string;
  client_id: string;
  month: string;
  source_filename: string | null;
  source_path: string | null;
  column_mapping: Record<string, Record<string, string>>;
  imported_at: string | null;
  created_at: string;
};

export type ContentType = "social" | "email" | "blog";
export type Format = "feed" | "carousel" | "reel" | "story" | "text" | "square";
export type ItemStatus = "draft" | "ready" | "approved" | "pushed";

export type ContentItem = {
  id: string;
  client_id: string;
  calendar_id: string | null;
  type: ContentType;
  row_number: number | null;
  post_date: string | null;
  post_time: string | null;
  day: string | null;
  phase: string | null;
  slot: string | null;
  channels: string[];
  format: Format | null;
  pillar: string | null;
  moment_offer: string | null;
  hook: string | null;
  caption: string | null;
  caption_status: string | null;
  caption_suggestion: string | null;
  cta: string | null;
  hashtags: string | null;
  first_comment: string | null;
  asset_brief: string | null;
  asset_group: string | null;
  asset_status: string | null;
  asset_ref: string | null;
  owner: string | null;
  scheduled: string | null;
  live: string | null;
  compliance_note: string | null;
  status: ItemStatus;
  email_subject: string | null;
  email_preview: string | null;
  source_row: Record<string, unknown>;
  /** provider post id per platform, e.g. {"instagram": "68f0..."} */
  external_posts: Record<string, string>;
  // Images designed in the Chrome extension; when present they replace matched Drive images.
  custom_media: CustomMedia[];
};

export type CustomMedia = { url: string; kind: "image" | "video"; altText?: string; source?: string };

export type Asset = {
  id: string;
  client_id: string;
  drive_file_id: string;
  folder_path: string;
  name: string;
  mime_type: string;
  kind: "image" | "video";
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  size_bytes: number | null;
  thumbnail_path: string | null;
  ai_description: string | null;
  ai_tags: (Record<string, unknown> & { keywords?: string[]; orientation?: string }) | null;
  removed_at: string | null;
};
