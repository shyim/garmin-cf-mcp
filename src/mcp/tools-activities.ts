// Activity tools — port of activity_management.py (original: 20 tools).
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { tool } from "./shim.js";
import { GarminClient } from "../garmin/client.js";
import { toolAllowed } from "./filter.js";
import { mintDownload } from "../store/downloads.js";
import type { Env } from "../env.js";

interface Ctx {
  env: Env;
  client: GarminClient;
  server: McpServer;
  /** Public origin of this worker, for minted download links. */
  origin: string;
  userId: string;
}
const t = (s: unknown) => ({ content: [{ type: "text" as const, text: typeof s === "string" ? s : JSON.stringify(s, null, 2) }] });
const id = z.union([z.number(), z.string()]).describe("Garmin activity ID");

export function registerActivityTools({ env, client, server, origin, userId }: Ctx) {
  const allow = (n: string) => toolAllowed(n, env);
  const wrap = async (fn: () => Promise<unknown>) => {
    try {
      return t(await fn());
    } catch (e) {
      return t(`Garmin error: ${(e as Error).message}`);
    }
  };

  if (allow("get_activities_by_date"))
    tool(server, "get_activities_by_date", "Get activities between dates with pagination (newest-first). Pass page/page_size; has_more + next_page walk the full set.",
      { start_date: z.string(), end_date: z.string(), activity_type: z.string().optional().default(""), page: z.number().optional().default(0), page_size: z.number().optional().default(100) },
      async ({ start_date, end_date, activity_type, page = 0, page_size = 100 }) => wrap(async () => {
        const ps = Math.min(Math.max(1, page_size), 200);
        const params: Record<string, string> = { startDate: start_date, endDate: end_date, start: String(page * ps), limit: String(ps) };
        if (activity_type) params.activityType = activity_type;
        const data = await client.searchActivities(params) as unknown[];
        const arr = Array.isArray(data) ? data : [];
        return { count: arr.length, page, page_size: ps, has_more: arr.length === ps, next_page: arr.length === ps ? page + 1 : null, activities: arr };
      }));

  if (allow("get_activities"))
    tool(server, "get_activities", "List recent activities (newest-first). Complement to get_activities_by_date.",
      { start: z.number().optional().default(0), limit: z.number().optional().default(20) },
      async ({ start = 0, limit = 20 }) => wrap(() => client.listActivities(start, Math.min(Math.max(1, limit), 100))));
  if (allow("get_activities_fordate"))
    tool(server, "get_activities_fordate", "Get activities for a specific date (YYYY-MM-DD).",
      { date: z.string() }, async ({ date }) => wrap(() => client.getActivitiesForDate(date)));

  if (allow("get_activity"))
    tool(server, "get_activity", "Detailed summary for one activity (timing, distance, HR, elevation, training effect, event_type).",
      { activity_id: id }, async ({ activity_id }) => wrap(() => client.getActivity(activity_id as string)));

  if (allow("count_activities"))
    tool(server, "count_activities", "Total number of activities in the account.",
      {}, async () => wrap(async () => ({ total_activities: await client.getActivitiesCount() })));

  if (allow("get_activity_types"))
    tool(server, "get_activity_types", "List all valid activity type keys (for set_activity_type).",
      {}, async () => wrap(() => client.getActivityTypes()));

  if (allow("set_activity_name"))
    tool(server, "set_activity_name", "Rename an activity.",
      { activity_id: id, activity_name: z.string() },
      async ({ activity_id, activity_name }) => wrap(async () => {
        if (!activity_name.trim()) return "Activity name cannot be empty";
        await client.updateActivity(activity_id as string, { activityId: Number(activity_id), activityName: activity_name.trim() });
        return { ok: true };
      }));

  if (allow("set_activity_type"))
    tool(server, "set_activity_type", "Change an activity's sport type (e.g. running, trail_running, cycling). See get_activity_types.",
      { activity_id: id, type_key: z.string() },
      async ({ activity_id, type_key }) => wrap(async () => {
        await client.updateActivity(activity_id as string, { activityId: Number(activity_id), activityTypeDTO: { typeKey: type_key } });
        return { ok: true };
      }));

  if (allow("set_activity_description"))
    tool(server, "set_activity_description", "Set/clear the free-text description (notes) of an activity.",
      { activity_id: id, description: z.string() },
      async ({ activity_id, description }) => wrap(async () => {
        await client.updateActivity(activity_id as string, { activityId: Number(activity_id), description });
        return { ok: true };
      }));

  if (allow("set_activity_event_type"))
    tool(server, "set_activity_event_type", "Set event type: race|recreation|specialEvent|training|transportation|touring|geocaching|fitness|uncategorized.",
      { activity_id: id, event_type: z.string() },
      async ({ activity_id, event_type }) => wrap(async () => {
        await client.updateActivity(activity_id as string, { activityId: Number(activity_id), eventTypeDTO: { typeKey: event_type } });
        return { ok: true };
      }));

  if (allow("set_perceived_effort"))
    tool(server, "set_perceived_effort", "Set perceived effort RPE 0-10 (0 clears). Stored x10 by Garmin; conversion handled.",
      { activity_id: id, rpe: z.number().min(0).max(10) },
      async ({ activity_id, rpe }) => wrap(async () => {
        await client.updateActivity(activity_id as string, { activityId: Number(activity_id), summaryDTO: { perceivedEffort: Math.round(rpe * 10) } });
        return { ok: true };
      }));

  if (allow("set_activity_feel"))
    tool(server, "set_activity_feel", "Set feel rating: 0|25|50|75|100 (higher = better).",
      { activity_id: id, feel: z.number() },
      async ({ activity_id, feel }) => wrap(async () => {
        await client.updateActivity(activity_id as string, { activityId: Number(activity_id), summaryDTO: { feel } });
        return { ok: true };
      }));

  const split = (name: string, desc: string, ep: string) => {
    if (!allow(name)) return;
    tool(server, name, desc, { activity_id: id }, async ({ activity_id }) => wrap(() => client.get(`/activity-service/activity/${activity_id}/${ep}`)));
  };
  split("get_activity_splits", "Splits for an activity.", "splits");
  split("get_activity_typed_splits", "Typed splits for an activity.", "typedSplits");
  split("get_activity_split_summaries", "Split summaries for an activity.", "splitSummaries");
  split("get_activity_weather", "Weather for an activity (temps converted to account unit).", "weather");
  split("get_activity_hr_in_timezones", "HR time-in-zones for an activity.", "hrTimeInZones");
  split("get_activity_power_in_timezones", "Power time-in-zones for an activity (needs power meter).", "powerTimeInZones");
  split("get_activity_gear", "Gear used for an activity.", "gear");
  split("get_activity_exercise_sets", "Exercise sets (strength activities).", "exerciseSets");

  if (allow("create_manual_activity"))
    tool(server, "create_manual_activity", "Manually log an activity (type, date, duration, distance).",
      { activity_type: z.string(), start_date: z.string(), duration_seconds: z.number(), distance_meters: z.number().optional() },
      async (a) => wrap(() => client.post("/activity-service/activity/manual", {
        activityTypeDTO: { typeKey: (a as Record<string, string>).activity_type },
        startTimeLocal: (a as Record<string, string>).start_date,
        duration: (a as Record<string, number>).duration_seconds,
        distance: (a as Record<string, number | undefined>).distance_meters ?? 0,
      })));

  if (allow("download_activity_file"))
    tool(server, "download_activity_file", "Get a temporary download link (valid 10 minutes) for an activity file in FIT/GPX/TCX/CSV. Workers cannot write to disk, so this returns a URL plus the byte size instead of saving a file.",
      { activity_id: id, format: z.enum(["fit", "gpx", "tcx", "csv"]).optional().default("fit") },
      async ({ activity_id, format = "fit" }) => wrap(async () => {
        const map: Record<string, string> = { fit: "files/activity", gpx: "export/gpx/activity", tcx: "export/tcx/activity", csv: "export/csv/activity" };
        const kind = map[format] ?? map.fit;
        const buf = await client.request<ArrayBuffer>("GET", `/download-service/${kind}/${activity_id}`, { raw: true });
        const { nonce, expiresAt } = await mintDownload(env.GARMIN_KV, { userId, activityId: String(activity_id), format });
        return { activity_id, format, bytes: buf.byteLength, download_url: `${origin}/api/download/${nonce}`, expires_at: expiresAt };
      }));
}
