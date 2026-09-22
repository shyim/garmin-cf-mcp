// Training / devices / gear / weight / challenges / nutrition / user /
// workouts / courses / calendar tools + parity extras.
// Ports: training.py, devices.py, gear_management.py, weight_management.py,
// challenges.py, nutrition.py, user_profile.py, womens_health.py,
// workouts.py, workout_builders.py, courses.py, activity_analysis.py,
// calendar_events.py. Endpoint paths verified against
// python-garminconnect==0.3.2 and the original tool bodies.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { tool } from "./shim.js";
import { GarminClient, EP } from "../garmin/client.js";
import {
  SIMPLE_RUN_TEMPLATE,
  INTERVAL_RUNNING_TEMPLATE,
  TEMPO_RUN_TEMPLATE,
  STRENGTH_CIRCUIT_TEMPLATE,
  WORKOUT_STRUCTURE_REFERENCE,
} from "../garmin/templates.js";
import { toolAllowed } from "./filter.js";
import type { Env } from "../env.js";

interface Ctx { env: Env; client: GarminClient; server: McpServer }
const t = (s: unknown) => ({ content: [{ type: "text" as const, text: typeof s === "string" ? s : JSON.stringify(s, null, 2) }] });
const d = z.string().describe("Date YYYY-MM-DD");
const id = z.union([z.number(), z.string()]);

export function registerMiscTools({ env, client, server }: Ctx) {
  const allow = (n: string) => toolAllowed(n, env);
  const wrap = async (fn: () => Promise<unknown>) => {
    try { return t(await fn()); } catch (e) { return t(`Garmin error: ${(e as Error).message}`); }
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const get = (name: string, desc: string, shape: Record<string, z.ZodTypeAny>, fn: (a: any) => Promise<unknown>) => {
    if (!allow(name)) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tool(server, name, desc, shape, async (a: any) => wrap(() => fn(a)));
  };
  const str = (p: Record<string, string | number | boolean | undefined>, k: string) => String(p[k]);

  // ================= training & performance =================
  get("get_training_status", "Training status (productive, peaking, …) for a date.", { date: d }, ({ date }) => client.getTrainingStatus(String(date)));
  get("get_training_readiness", "Training readiness snapshots for a date.", { date: d }, ({ date }) => client.getTrainingReadiness(String(date)));
  get("get_morning_training_readiness", "Morning-report readiness (AFTER_WAKEUP_RESET entry, first-entry fallback).", { date: d }, async ({ date }) => {
    const data = await client.getTrainingReadiness(String(date)) as unknown;
    if (!data) return null;
    if (!Array.isArray(data)) return data;
    return data.find((e) => (e as Record<string, unknown>).inputContext === "AFTER_WAKEUP_RESET") ?? data[0] ?? null;
  });
  get("get_race_predictions", "Race time predictions (5k/10k/half/marathon).", {}, () => client.getRacePredictor());
  get("get_training_load_trend", "CTL/ATL/TSB/ACWR per day from training-status snapshots (max 90 days).", { start_date: d, end_date: d }, async ({ start_date, end_date }) => {
    const days = eachDay(String(start_date), String(end_date));
    if (days.length < 1) return "end_date must be on or after start_date.";
    if (days.length > 90) return `Date range too large (${days.length} days). Maximum is 90 days.`;
    const trend = [];
    for (const day of days) {
      try {
        const data = await client.getTrainingStatus(day) as Record<string, Record<string, unknown>>;
        const recent = (data.mostRecentTrainingStatus ?? {}) as Record<string, unknown>;
        const latest = (recent.latestTrainingStatusData ?? {}) as Record<string, Record<string, unknown>>;
        let sd: Record<string, unknown> = {};
        for (const dev of Object.values(latest)) {
          if (typeof dev !== "object" || !dev) continue;
          if ((dev as Record<string, unknown>).primaryTrainingDevice) { sd = dev as Record<string, unknown>; break; }
          if (!Object.keys(sd).length) sd = dev as Record<string, unknown>;
        }
        const atlDto = (sd.acuteTrainingLoadDTO ?? {}) as Record<string, number>;
        const entry: Record<string, unknown> = { date: day };
        if (typeof atlDto.dailyTrainingLoadAcute === "number") entry.atl = round1(atlDto.dailyTrainingLoadAcute);
        if (typeof atlDto.dailyTrainingLoadChronic === "number") entry.ctl = round1(atlDto.dailyTrainingLoadChronic);
        if (typeof atlDto.dailyAcuteChronicWorkloadRatio === "number") entry.acwr = round1(atlDto.dailyAcuteChronicWorkloadRatio);
        if (typeof entry.atl === "number" && typeof entry.ctl === "number")
          entry.tsb = round1((entry.ctl as number) - (entry.atl as number));
        trend.push(entry);
      } catch { trend.push({ date: day, error: "unavailable" }); }
    }
    return trend;
  });
  get("get_vo2max_trend", "VO2max per day from training-status snapshots (max 90 days).", { start_date: d, end_date: d }, async ({ start_date, end_date }) => {
    const days = eachDay(String(start_date), String(end_date));
    if (days.length < 1) return "end_date must be on or after start_date.";
    if (days.length > 90) return `Date range too large (${days.length} days). Maximum is 90 days.`;
    const trend = [];
    for (const day of days) {
      try {
        const data = await client.getTrainingStatus(day) as Record<string, Record<string, Record<string, number>>>;
        const vo2 = data.mostRecentVO2Max?.generic;
        trend.push({ date: day, vo2max: typeof vo2?.vo2MaxValue === "number" ? vo2.vo2MaxValue : null });
      } catch { trend.push({ date: day, error: "unavailable" }); }
    }
    return trend;
  });
  get("get_running_tolerance", "Running tolerance + impact load snapshot.", { start_date: d, end_date: d, aggregation: z.enum(["daily", "weekly"]).optional().default("weekly") }, ({ start_date, end_date, aggregation }) =>
    client.get(EP.runningTolerance, { startDate: String(start_date), endDate: String(end_date), aggregation: String(aggregation ?? "weekly") }));
  get("get_running_tolerance_trend", "Running tolerance trajectory per period (tolerance_km, acute_load_km, distance_km, load_ratio). Max 90d daily / 366d weekly.", {
    start_date: d, end_date: d, aggregation: z.enum(["daily", "weekly"]).optional().default("weekly"),
  }, async ({ start_date, end_date, aggregation }) => {
    const agg = String(aggregation ?? "weekly");
    const days = eachDay(String(start_date), String(end_date));
    const max = agg === "daily" ? 90 : 366;
    if (days.length > max) return `Date range too large for ${agg} aggregation (max ${max} days).`;
    const raw = await client.get(EP.runningTolerance, { startDate: String(start_date), endDate: String(end_date), aggregation: agg }) as Record<string, unknown[]>;
    const entries: unknown[] = Array.isArray(raw) ? raw : raw.measurements ?? raw.data ?? [];
    return (entries as Record<string, number | string>[]).map((e) => {
      const pt: Record<string, unknown> = { date: e.calendarDate ?? e.date ?? null };
      const tol = agg === "daily" ? e.acuteTolerance : e.totalTolerance;
      const acute = agg === "daily" ? e.acuteImpactLoad : e.totalImpactLoad;
      const dist = agg === "daily" ? e.acuteDistance : e.totalDistance;
      if (typeof tol === "number") pt.tolerance_km = Math.round((tol / 1000) * 100) / 100;
      if (typeof acute === "number") pt.acute_load_km = Math.round((acute / 1000) * 100) / 100;
      if (typeof dist === "number") pt.distance_km = Math.round((dist / 1000) * 100) / 100;
      if (typeof acute === "number" && typeof dist === "number" && dist) pt.load_ratio = Math.round((acute / dist) * 100) / 100;
      return pt;
    });
  });
  get("get_endurance_score", "Endurance score stats.", { start_date: d, end_date: d }, ({ start_date, end_date }) => client.get(`${EP.enduranceScore}/stats`, { startDate: String(start_date), endDate: String(end_date) }));
  get("get_hill_score", "Hill score stats.", { start_date: d, end_date: d }, ({ start_date, end_date }) => client.get(`${EP.hillScore}/stats`, { startDate: String(start_date), endDate: String(end_date) }));
  get("get_cycling_ftp", "Latest cycling Functional Threshold Power.", {}, () => client.get(`${EP.biometric}/latestFunctionalThresholdPower/CYCLING`));
  get("get_lactate_threshold", "Lactate threshold (HR/pace) + running power-to-weight.", {}, async () => ({
    lactate_threshold: await client.get(`${EP.biometric}/latestLactateThreshold`),
    power_to_weight: await client.get(`${EP.biometric}/powerToWeight/latest/${new Date().toISOString().slice(0, 10)}`, { sport: "Running" }).catch(() => null),
  }));
  get("get_training_effect", "Training effect labels for an activity (from activity detail).", { activity_id: id }, async ({ activity_id }) => {
    const a = await client.getActivity(activity_id as string) as Record<string, unknown>;
    return {
      aerobic: a.aerobicTrainingEffect ?? a.aerobicTrainingEffectMessage ?? null,
      anaerobic: a.anaerobicTrainingEffect ?? a.anaerobicTrainingEffectMessage ?? null,
      labels: a.trainingEffectLabels ?? null,
    };
  });
  get("get_training_load_balance", "Aerobic/anaerobic load balance from training status.", { date: d }, async ({ date }) => {
    const data = await client.getTrainingStatus(String(date)) as Record<string, unknown>;
    return data.trainingLoadBalanceDTO ?? data.loadBalance ?? data;
  });
  get("get_acclimation", "Heat/altitude acclimation from max metrics.", { date: d }, async ({ date }) => {
    const data = await client.get(`${EP.maxMetrics}/${date}/${date}`) as Record<string, unknown>;
    return data.acclimation ?? data;
  });
  get("get_personal_record", "Personal records.", {}, async () => {
    const name = await client.getDisplayName();
    return client.get(`${EP.personalRecord}/${name}`).catch(() => client.get(EP.personalRecord));
  });
  get("get_progress_summary_between_dates", 'Aggregated progress for a metric (elevationGain|duration|distance|movingDuration|calories). Calories are returned in kcal (Garmin stores them pre-scaled; scaling is undone).', {
    start_date: d, end_date: d, metric: z.string().optional().default("distance"),
  }, async ({ start_date, end_date, metric }) => {
    const data = await client.get(EP.fitnessStats, {
      startDate: String(start_date), endDate: String(end_date),
      aggregation: "lifetime", groupByParentActivityType: "true", metric: String(metric ?? "distance"),
    }) as Record<string, number>;
    if (String(metric ?? "distance") === "calories") {
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(data)) out[k] = typeof v === "number" ? Math.round((v / 4.19) * 10) / 10 : v;
      return out;
    }
    return data;
  });

  // ================= devices / gear / user =================
  get("get_devices", "Registered Garmin devices.", {}, () => client.getDevices());
  get("get_device_last_used", "Last-used device info.", {}, () => client.getDeviceLastUsed());
  get("get_device_settings", "Settings for a device.", { device_id: id }, ({ device_id }) => client.getDeviceSettings(device_id as string));
  get("get_device_alarms", "Active alarms aggregated from all devices' settings.", {}, async () => {
    const devices = await client.getDevices() as { deviceId?: number }[];
    const alarms: unknown[] = [];
    for (const dev of devices) {
      if (!dev?.deviceId) continue;
      try {
        const s = await client.getDeviceSettings(dev.deviceId) as { alarms?: unknown[] };
        if (Array.isArray(s.alarms)) alarms.push(...s.alarms.map((a) => ({ deviceId: dev.deviceId, ...a as object })));
      } catch { /* offline device */ }
    }
    return alarms;
  });
  get("get_device_solar_data", "Solar charge data for a device over a range.", { device_id: id, start_date: d, end_date: d }, ({ device_id, start_date, end_date }) =>
    client.get(`${EP.solar}/${device_id}/${start_date}/${end_date}`, { singleDayView: false }));
  get("get_primary_training_device", "Primary training device.", {}, () => client.getPrimaryDevice());
  get("get_gear", "Gear list (incl. free-text notes).", {}, () => client.getGear());
  get("add_gear_to_activity", "Link gear (UUID from get_gear) to an activity.", { activity_id: id, gear_uuid: z.string() }, ({ activity_id, gear_uuid }) =>
    client.put(`${EP.gearBase}/link/${gear_uuid}/activity/${activity_id}`, undefined).then(() => ({ success: true, activity_id, gear_uuid })));
  get("remove_gear_from_activity", "Unlink gear from an activity.", { activity_id: id, gear_uuid: z.string() }, ({ activity_id, gear_uuid }) =>
    client.put(`${EP.gearBase}/unlink/${gear_uuid}/activity/${activity_id}`, undefined).then(() => ({ success: true, activity_id, gear_uuid })));
  get("get_full_name", "Account full name.", {}, async () => {
    const p = await client.get(EP.socialProfile) as Record<string, unknown>;
    return p.fullName ?? p.displayName ?? p;
  });
  get("get_user_profile", "User profile (account settings record).", {}, () => client.get(EP.userSettings));
  get("get_userprofile_settings", "Profile settings record.", {}, () => client.get(EP.userProfileSettings));
  get("get_unit_system", "Unit system (metric/statute_us).", {}, async () => {
    const s = await client.get(EP.userProfileSettings) as Record<string, unknown>;
    return s.measurementSystem ?? s;
  });
  get("set_heart_rate_zones", "Write account-level HR zone config for one sport (mutates account config; only that sport is written).", {
    sport: z.string().describe("Sport profile key, e.g. DEFAULT, RUNNING, CYCLING"),
    max_hr: z.number().optional(), resting_hr: z.number().optional(),
    lactate_threshold_hr: z.number().optional(), calculation_method: z.string().optional(),
    zone_boundaries: z.array(z.number()).length(5).optional().describe("5 custom bpm boundaries (requires calculation_method custom_bpm)"),
  }, async (a) => {
    const zones = await client.get(EP.heartRateZones) as Record<string, unknown>[];
    const list = Array.isArray(zones) ? zones : [];
    const want = String(a.sport).toUpperCase();
    const current = list.find((z) => String((z.sportTypeKey ?? z.sport ?? "") as string).toUpperCase() === want)
      ?? list.find((z) => String((z.sportTypeKey ?? "") as string).toUpperCase() === "DEFAULT");
    if (!current) return "Sport profile not found and no DEFAULT fallback.";
    const merged = { ...(current as object) } as Record<string, unknown>;
    if (a.max_hr !== undefined) merged.maxHeartRate = Number(a.max_hr);
    if (a.resting_hr !== undefined) merged.restingHeartRate = Number(a.resting_hr);
    if (a.lactate_threshold_hr !== undefined) merged.lactateThresholdHeartRate = Number(a.lactate_threshold_hr);
    if (a.calculation_method !== undefined) merged.zoneCalculationMethod = String(a.calculation_method);
    if (a.zone_boundaries !== undefined) merged.customZoneBoundaries = a.zone_boundaries;
    (merged as Record<string, unknown>).changeState = "CHANGED";
    await client.put(EP.heartRateZones, [merged]);
    return { ok: true, sport: want };
  });
  get("get_goals", "Active goals.", {}, () => client.get(EP.goals));

  // ================= weight =================
  get("add_weigh_in", "Log a weigh-in (kg by default).", {
    weight_kg: z.number(), timestamp: z.string().optional().describe("ISO local timestamp; default now"),
  }, async (a) => {
    const dt = a.timestamp ? new Date(String(a.timestamp)) : new Date();
    const iso = dt.toISOString().slice(0, 23);
    return client.post(`${EP.weight}/user-weight`, {
      dateTimestamp: iso, gmtTimestamp: iso, unitKey: "kg", sourceType: "MANUAL", value: Number(a.weight_kg),
    });
  });
  get("add_weigh_in_with_timestamps", "Log a weigh-in with explicit local + GMT timestamps.", {
    weight_kg: z.number(), date_timestamp: z.string(), gmt_timestamp: z.string(),
  }, async (a) => client.post(`${EP.weight}/user-weight`, {
    dateTimestamp: String(a.date_timestamp), gmtTimestamp: String(a.gmt_timestamp),
    unitKey: "kg", sourceType: "MANUAL", value: Number(a.weight_kg),
  }));
  get("delete_weigh_ins", "Delete weigh-ins for a date (all, or latest only).", {
    date: d, delete_all: z.boolean().optional().default(false),
  }, async ({ date, delete_all }) => {
    const daily = await client.get(`${EP.weight}/weight/dayview/${date}`) as { dateWeightList?: { version?: string | number }[] };
    const list = daily.dateWeightList ?? [];
    if (!list.length) return "No weigh-ins found.";
    const targets = delete_all ? list : list.slice(-1);
    let n = 0;
    for (const w of targets) {
      if (w.version === undefined) continue;
      await client.del(`${EP.weight}/weight/${date}/byversion/${w.version}`);
      n++;
    }
    return { deleted: n };
  });

  // ================= challenges & badges =================
  const chal = (name: string, desc: string, path: string) =>
    get(name, desc, { start: z.number().optional().default(0), limit: z.number().optional().default(20) }, ({ start, limit }) =>
      client.get(path, { start: String(start ?? 0), limit: String(limit ?? 20) }));
  chal("get_earned_badges", "Earned badges.", EP.earnedBadges);
  chal("get_available_badge_challenges", "Available badge challenges.", EP.availableBadgeChallenges);
  chal("get_badge_challenges", "Joined/completed badge challenges.", EP.badgeChallenges);
  chal("get_non_completed_badge_challenges", "In-progress (non-completed) badge challenges.", EP.nonCompletedBadge);
  chal("get_adhoc_challenges", "Ad-hoc challenges.", EP.adhocChallenges);
  chal("get_inprogress_virtual_challenges", "In-progress virtual challenges.", EP.inprogressVirtual);

  // ================= nutrition =================
  get("get_nutrition_daily_food_log", "Food log for a date.", { date: d }, ({ date }) => client.get(`${EP.nutritionFoodLog}/${date}`));
  get("get_nutrition_daily_meals", "Meals for a date.", { date: d }, ({ date }) => client.get(`${EP.nutritionMeals}/${date}`));
  get("get_nutrition_daily_settings", "Nutrition goals/settings for a date.", { date: d }, ({ date }) => client.get(`${EP.nutritionSettings}/${date}`));
  get("set_nutrition_daily_settings", "Update nutrition daily goals.", { date: d, settings: z.record(z.string(), z.unknown()) }, ({ date, settings }) => client.post(`${EP.nutritionSettings}/${date}`, settings));
  get("get_nutrition_summary_between_dates", "Per-day intake totals over a range (max 61 days).", { start_date: d, end_date: d }, async ({ start_date, end_date }) => {
    const days = eachDay(String(start_date), String(end_date));
    if (days.length > 61) return `Date range too large (${days.length} days). Maximum is 61 days.`;
    const data = await client.get(`${EP.nutritionFoodLog}/range`, { startDate: String(start_date), endDate: String(end_date) }) as { dailyNutritionSummaries?: Record<string, unknown>[] };
    return (data.dailyNutritionSummaries ?? []).map((s) => ({
      date: s.calendarDate ?? null, calories: s.totalCalories ?? null,
      carbs: s.totalCarbohydrates ?? null, protein: s.totalProtein ?? null,
      fat: s.totalFat ?? null, item_count: s.totalFoodItems ?? s.foodItemCount ?? null,
    }));
  });
  get("search_foods", "Search the food database.", {
    query: z.string(), start: z.number().optional().default(0), limit: z.number().optional().default(20),
  }, ({ query, start, limit }) => client.get(EP.nutritionFoodSearch, { searchExpression: String(query), start: String(start ?? 0), limit: String(limit ?? 20) }));
  get("get_custom_foods", "List custom foods.", {}, () => client.get(EP.nutritionCustomFood));
  get("get_custom_food_serving_units", "Valid serving units for custom foods.", {}, () => client.get(EP.nutritionServingUnits));
  get("create_custom_food", "Create a custom food.", { food: z.record(z.string(), z.unknown()) }, ({ food }) => client.post(EP.nutritionCustomFood, food));
  get("update_custom_food", "Update a custom food (full payload).", { food: z.record(z.string(), z.unknown()) }, ({ food }) => client.put(EP.nutritionCustomFood, food));
  get("delete_custom_food", "Delete a custom food.", { food_id: z.union([z.number(), z.string()]) }, ({ food_id }) => client.del(`${EP.nutritionCustomFood}/${food_id}`).then(() => ({ ok: true })));
  get("log_food", "Quick-add a food entry.", { date: d, food: z.record(z.string(), z.unknown()) }, ({ date, food }) =>
    client.put(`${EP.nutritionFoodLog}/quickAdd`, { calendarDate: String(date), ...(food as object) }));
  get("log_custom_food", "Log a custom food into a meal.", {
    date: d, food_id: z.union([z.number(), z.string()]), serving_id: z.union([z.number(), z.string()]).optional(),
    serving_qty: z.number().optional().default(1), meal: z.string().optional().describe("Meal name, e.g. BREAKFAST"),
  }, async (a) => {
    const meals = await client.get(`${EP.nutritionMeals}/${a.date}`) as { mealId?: number; name?: string }[];
    const meal = (Array.isArray(meals) ? meals : []).find((m) => !a.meal || String(m.name).toUpperCase() === String(a.meal).toUpperCase()) ?? (meals as unknown[])[0];
    if (!meal) return "No meals found for date.";
    return client.put(EP.nutritionFoodLog, {
      calendarDate: String(a.date),
      foodLogs: [{ mealId: (meal as { mealId: number }).mealId, foodId: a.food_id, servingId: a.serving_id ?? null, servingQty: Number(a.serving_qty ?? 1), source: "CUSTOM", regionCode: "US", languageCode: "en" }],
    });
  });
  get("upsert_and_log", "Find-or-create a custom food by name, then log it (avoids duplicates).", {
    meal_date: d, meal_time: z.string(), food_name: z.string(), calories: z.number(),
    carbs: z.number().optional(), protein: z.number().optional(), fat: z.number().optional(),
    serving_qty: z.number().optional().default(1),
  }, async (a) => {
    const found = await client.get(EP.nutritionCustomFood, { searchExpression: String(a.food_name) }).catch(() => null) as { results?: { foodId?: string }[] } | null;
    let foodId = found?.results?.[0]?.foodId;
    if (!foodId) {
      const created = await client.post(EP.nutritionCustomFood, {
        name: String(a.food_name), calories: Number(a.calories),
        ...(a.carbs !== undefined ? { carbs: Number(a.carbs) } : {}),
        ...(a.protein !== undefined ? { protein: Number(a.protein) } : {}),
        ...(a.fat !== undefined ? { fat: Number(a.fat) } : {}),
        servingUnit: "G", numberOfUnits: 100,
      }) as { foodId?: string };
      foodId = created.foodId;
    }
    if (!foodId) return "Could not find or create the custom food.";
    return client.put(EP.nutritionFoodLog, {
      calendarDate: String(a.meal_date), mealTime: String(a.meal_time),
      foodLogs: [{ foodId, servingQty: Number(a.serving_qty ?? 1), source: "CUSTOM", regionCode: "US", languageCode: "en" }],
    });
  });
  get("delete_food_log", "Delete a food log entry (logId from get_nutrition_daily_food_log).", {
    log_id: z.string(), meal_date: d,
  }, ({ log_id, meal_date }) => client.del(`${EP.nutritionFoodLog}/${meal_date}`, { logIds: [String(log_id)] }).then(() => ({ status: "success", log_id })));

  // ================= women's health =================
  get("get_menstrual_data_for_date", "Menstrual day-view for a date.", { date: d }, ({ date }) => client.get(`${EP.menstrualDayview}/${date}`));
  get("get_menstrual_calendar_data", "Menstrual calendar over a range (auto-chunked at 92 days).", { start_date: d, end_date: d }, async ({ start_date, end_date }) => {
    const days = eachDay(String(start_date), String(end_date));
    const chunks: string[][] = [];
    for (let i = 0; i < days.length; i += 92) chunks.push(days.slice(i, i + 92));
    const out = [];
    for (const c of chunks) out.push(await client.get(`${EP.menstrualCalendar}/${c[0]}/${c[c.length - 1]}`));
    return out.length === 1 ? out[0] : out;
  });
  get("get_pregnancy_summary", "Pregnancy snapshot.", {}, () => client.get(EP.pregnancy));

  // ================= workouts =================
  get("get_workouts", "List workouts.", {}, () => client.getWorkouts());
  get("get_workout_by_id", "Workout detail.", { workout_id: id }, ({ workout_id }) => client.getWorkout(workout_id as string));
  get("download_workout", "Workout JSON (for export).", { workout_id: id }, ({ workout_id }) => client.getWorkout(workout_id as string));
  get("upload_workout", "Upload a workout JSON payload (see get_structure_reference / templates).", { workout: z.record(z.string(), z.unknown()) }, ({ workout }) => client.post(EP.workouts, workout));
  get("upload_workouts", "Upload multiple workout JSON payloads.", { workouts: z.array(z.record(z.string(), z.unknown())) }, async ({ workouts }) => {
    const results = [];
    for (const w of (workouts as unknown[])) {
      try { results.push({ ok: true, result: await client.post(EP.workouts, w) }); }
      catch (e) { results.push({ ok: false, error: (e as Error).message }); }
    }
    return results;
  });
  get("delete_workout", "Delete a workout.", { workout_id: id }, ({ workout_id }) => client.del(`${EP.workouts}/${workout_id}`).then(() => ({ ok: true })));
  get("delete_workouts", "Delete multiple workouts.", { workout_ids: z.array(id) }, async ({ workout_ids }) => {
    const results = [];
    for (const wid of (workout_ids as (string | number)[])) {
      try { await client.del(`${EP.workouts}/${wid}`); results.push({ workout_id: wid, ok: true }); }
      catch (e) { results.push({ workout_id: wid, ok: false, error: (e as Error).message }); }
    }
    return results;
  });
  get("get_scheduled_workouts", "Scheduled workouts between dates (via calendar feed).", { start_date: d, end_date: d }, async ({ start_date, end_date }) =>
    (await calendarItems(client, String(start_date), String(end_date))).filter((i) => i.workoutId !== undefined || i.workoutName !== undefined || i.type === "workout"));
  get("schedule_workout", "Schedule a workout on a date.", { workout_id: id, date: d }, ({ workout_id, date }) =>
    client.post(`${EP.workoutSchedule}/${workout_id}`, { date: String(date) }));
  get("schedule_workouts", "Schedule multiple workouts ([{workout_id or workout_data, calendar_date}]).", { schedules: z.array(z.record(z.string(), z.unknown())) }, async ({ schedules }) => {
    const results = [];
    for (const s of (schedules as Record<string, unknown>[])) {
      try {
        let wid = s.workout_id as string | number | undefined;
        if (!wid && s.workout_data) {
          const created = await client.post(EP.workouts, s.workout_data) as { workoutId?: number };
          wid = created.workoutId;
        }
        if (!wid) { results.push({ ok: false, error: "need workout_id or workout_data" }); continue; }
        results.push({ ok: true, result: await client.post(`${EP.workoutSchedule}/${wid}`, { date: String(s.calendar_date) }) });
      } catch (e) { results.push({ ok: false, error: (e as Error).message }); }
    }
    return results;
  });
  get("schedule_week", "Idempotent week scheduling ([{date, workout_id}] — skips already-scheduled).", { week: z.array(z.record(z.string(), z.unknown())) }, async ({ week }) => {
    const results = [];
    for (const item of (week as Record<string, unknown>[])) {
      const date = String(item.date), wid = Number(item.workout_id);
      try {
        const items = await calendarItems(client, date, date);
        const already = items.some((i) => Number(i.workoutId) === wid);
        if (already) { results.push({ date, workout_id: wid, status: "already_scheduled", idempotent: true }); continue; }
        results.push({ date, workout_id: wid, status: "scheduled", result: await client.post(`${EP.workoutSchedule}/${wid}`, { date }) });
      } catch (e) { results.push({ date, workout_id: wid, status: "error", error: (e as Error).message }); }
    }
    return results;
  });
  get("unschedule_workout", "Remove a scheduled workout (calendar-entry id from get_scheduled_workouts).", { schedule_id: id }, ({ schedule_id }) =>
    client.del(`${EP.workoutSchedule}/${schedule_id}`).then(() => ({ ok: true })));
  get("unschedule_workouts", "Remove multiple scheduled workouts (calendar-entry ids).", { scheduled_workout_ids: z.array(id) }, async ({ scheduled_workout_ids }) => {
    const results = [];
    for (const sid of (scheduled_workout_ids as (string | number)[])) {
      try { await client.del(`${EP.workoutSchedule}/${sid}`); results.push({ schedule_id: sid, ok: true }); }
      catch (e) { results.push({ schedule_id: sid, ok: false, error: (e as Error).message }); }
    }
    return results;
  });
  get("get_training_plan_workouts", "Active Garmin Coach / training-plan week (GraphQL).", { calendar_date: d }, ({ calendar_date }) => coachWeek(client, String(calendar_date)));
  get("get_garmin_coach_workouts", "Active Garmin Coach / training-plan week (GraphQL).", { calendar_date: d }, ({ calendar_date }) => coachWeek(client, String(calendar_date)));

  // ---- workout builders (high-level) ----
  get("create_walk_run_workout", "Create a walk/run interval workout.", {
    name: z.string(), run_seconds: z.number(), walk_seconds: z.number(), repeats: z.number().optional().default(5),
  }, ({ name, run_seconds, walk_seconds, repeats }) =>
    client.post(EP.workouts, buildWalkRun(String(name), Number(run_seconds), Number(walk_seconds), Number(repeats ?? 5))));
  get("create_run_workout", "Create a simple run workout (warmup/main/cooldown).", {
    name: z.string(), distance_meters: z.number().optional(), duration_seconds: z.number().optional(),
  }, (a) => client.post(EP.workouts, buildSimpleRun(a)));
  get("create_z2_walk_workout", "Create a Zone-2 walk workout.", {
    name: z.string(), duration_seconds: z.number().optional().default(3600),
  }, ({ name, duration_seconds }) => client.post(EP.workouts, buildSimpleRun({ name: String(name), duration_seconds: Number(duration_seconds ?? 3600), zone: 2 })));
  get("create_strength_workout", "Create a strength workout (reps-based steps; sets>1 become repeat groups).", {
    name: z.string(), exercises: z.array(z.record(z.string(), z.unknown())),
  }, ({ name, exercises }) => client.post(EP.workouts, buildStrength(String(name), (exercises as Record<string, unknown>[]))));
  get("get_simple_run_template", "Valid upload_workout JSON template: simple run.", {}, async () => SIMPLE_RUN_TEMPLATE);
  get("get_interval_template", "Valid upload_workout JSON template: interval run with repeat group.", {}, async () => INTERVAL_RUNNING_TEMPLATE);
  get("get_tempo_template", "Valid upload_workout JSON template: tempo run (HR zone 4).", {}, async () => TEMPO_RUN_TEMPLATE);
  get("get_strength_template", "Valid upload_workout JSON template: strength circuit.", {}, async () => STRENGTH_CIRCUIT_TEMPLATE);
  get("get_structure_reference", "Reference doc for Garmin workout DTO structure.", {}, async () => WORKOUT_STRUCTURE_REFERENCE);

  // ================= courses =================
  get("get_courses", "List courses.", {}, () => client.getCourses());
  get("get_course_details", "Course detail.", { course_id: id }, ({ course_id }) => client.get(`${EP.courses}/${course_id}`));
  get("delete_course", "Delete a course.", { course_id: id }, ({ course_id }) => client.del(`${EP.courses}/${course_id}`).then(() => ({ ok: true })));
  get("download_course_gpx", "Course GPX info (binary omitted over MCP).", { course_id: id }, async ({ course_id }) => {
    const buf = await client.request<ArrayBuffer>("GET", `${EP.courses}/${course_id}/gpx`, { raw: true }).catch(() => new ArrayBuffer(0));
    return { course_id, bytes: buf.byteLength, note: "Binary omitted over MCP." };
  });
  get("upload_course", "Create a course from inline GPX text (Workers have no filesystem; original took a file path).", {
    gpx_content: z.string().describe("Full .gpx file text"), course_name: z.string().optional(),
    activity_type: z.string().optional().default("running"), description: z.string().optional(),
  }, async (a) => {
    const form = new FormData();
    form.append("file", new Blob([String(a.gpx_content)], { type: "application/gpx+xml" }), `${String(a.course_name ?? "course")}.gpx`);
    const parsed = await client.request<Record<string, unknown>>("POST", `${EP.courses}/import`, { form } as never);
    const payload = {
      courseName: String(a.course_name ?? parsed.courseName ?? "Course"),
      activityType: String(a.activity_type ?? "running"),
      description: a.description !== undefined ? String(a.description) : parsed.description ?? "",
      coursePoints: parsed.coursePoints ?? [],
      coursePath: parsed.coursePath ?? parsed.polyline ?? null,
    };
    return client.post(EP.courses, payload);
  });

  // ================= calendar =================
  get("get_calendar_events", "Races/events on the Garmin calendar between dates (curated).", { start_date: d, end_date: d }, async ({ start_date, end_date }) =>
    (await calendarItems(client, String(start_date), String(end_date))).map(curateEvent));
  get("get_calendar_items_for_date", "Calendar items (workouts, events, activities) for a single date.", { date: d }, ({ date }) => calendarItems(client, String(date), String(date)));

  // ================= analysis (FIT) =================
  get("get_activity_fit_data", "FIT file metadata for an activity (record count via minimal parse; full binary via download_activity_file).", { activity_id: id }, async ({ activity_id }) =>
    fitInfo(client, String(activity_id)));
  get("get_activity_fit_messages", "Top-level FIT message-type inventory for an activity file.", { activity_id: id }, async ({ activity_id }) =>
    fitInfo(client, String(activity_id)));
  get("get_power_duration_curve", "Season-best mean-maximal power across recent activities (best-effort FIT parse, ~1Hz assumed). 20-min best x0.95 ≈ FTP.", {
    num_activities: z.number().optional().default(20), activity_type: z.string().optional().default("cycling"),
  }, async ({ num_activities, activity_type }) => powerDurationCurve(client, Math.min(Number(num_activities ?? 20), 50), String(activity_type ?? "cycling")));

  // ================= misc =================
  get("request_reload", "Auth-health hint (token refresh is automatic on 401/expiry).", {}, async () => ({ ok: true, note: "Tokens auto-refresh on 401/expiry." }));
  get("garmin_api", "Generic passthrough to any connectapi GET path (path validated server-side).", {
    path: z.string(), params: z.record(z.string(), z.string()).optional(),
  }, ({ path, params }) => client.get(String(path), (params ?? {}) as Record<string, string>));
}

// ---------- shared helpers ----------
function eachDay(start: string, end: string): string[] {
  const out: string[] = [];
  const a = new Date(start + "T00:00:00Z"), b = new Date(end + "T00:00:00Z");
  for (let d = new Date(a); d <= b; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}
const round1 = (n: number) => Math.round(n * 10) / 10;

async function calendarItems(client: GarminClient, start: string, end: string): Promise<Record<string, unknown>[]> {
  const months = new Set<string>();
  for (const day of eachDay(start, end)) months.add(day.slice(0, 7));
  const items: Record<string, unknown>[] = [];
  for (const m of months) {
    const [y, mo] = m.split("-").map(Number);
    try {
      const data = await client.getCalendarMonth(y, mo - 1) as { calendarItems?: Record<string, unknown>[] };
      const list = Array.isArray(data?.calendarItems) ? data.calendarItems : [];
      items.push(...list.filter((i) => typeof i.date === "string" && i.date >= start && (i.date as string) <= end));
    } catch { /* missing month */ }
  }
  return items;
}

function curateEvent(item: Record<string, unknown>) {
  const et = (item.eventTimeLocal ?? {}) as Record<string, unknown>;
  const tgt = (item.completionTarget ?? {}) as Record<string, unknown>;
  const loc = typeof item.location === "string" && item.location.trim() ? item.location.trim() : null;
  return {
    title: item.title ?? null, date: item.date ?? null,
    is_race: bool(item.isRace), primary_event: bool(item.primaryEvent), subscribed: bool(item.subscribed),
    distance_meters: tgt.unitType === "distance" && typeof tgt.value === "number" ? tgt.value : null,
    start_time_local: et.startTimeHhMm ?? null, time_zone: et.timeZoneId ?? null,
    location: loc, url: item.url ?? null, event_uuid: item.shareableEventUuid ?? null,
  };
}
const bool = (v: unknown) => v === true;

async function coachWeek(client: GarminClient, calendarDate: string) {
  const result = await client.queryGraphql(
    `query{trainingPlanScalar(calendarDate:"${calendarDate}", lang:"en-US", firstDayOfWeek:"monday")}`,
  ) as { data?: { trainingPlanScalar?: { trainingPlanWorkoutScheduleDTOS?: unknown[] } | null } };
  const plans = result?.data?.trainingPlanScalar?.trainingPlanWorkoutScheduleDTOS;
  if (!plans?.length) return `No training plan workouts scheduled for ${calendarDate}.`;
  return plans;
}

function buildWalkRun(name: string, runS: number, walkS: number, repeats: number) {
  const step = (dur: number, desc: string) => ({ type: "interval", description: desc, duration: { type: "time", value: dur } });
  const workoutSteps: unknown[] = [{ type: "warmup", duration: { type: "time", value: 300 } }];
  for (let i = 0; i < repeats; i++) workoutSteps.push(step(runS, "Run"), step(walkS, "Walk"));
  workoutSteps.push({ type: "cooldown", duration: { type: "time", value: 300 } });
  return { workoutName: name, sportType: "RUNNING", workoutSteps };
}

function buildSimpleRun(a: Record<string, string | number | boolean | undefined>) {
  return {
    workoutName: String(a.name ?? "Run"),
    sportType: "RUNNING",
    workoutSteps: [
      { type: "warmup", duration: { type: "time", value: 600 } },
      {
        type: "interval", description: "Main",
        duration: a.distance_meters ? { type: "distance", value: Number(a.distance_meters) } : { type: "time", value: Number(a.duration_seconds ?? 1800) },
        ...(a.zone ? { target: { type: "heartRateZone", value: Number(a.zone) } } : {}),
      },
      { type: "cooldown", duration: { type: "time", value: 600 } },
    ],
  };
}

function buildStrength(name: string, exercises: Record<string, unknown>[]) {
  const steps: unknown[] = [];
  for (const ex of exercises) {
    const sets = Number(ex.sets ?? 1), reps = Number(ex.reps ?? 10);
    const work = {
      type: "ExecutableStepDTO", description: String(ex.name ?? "Exercise"),
      exerciseName: String(ex.exercise_name ?? ex.name ?? ""),
      endCondition: { conditionTypeKey: "reps", conditionTypeId: 8 }, endConditionValue: reps,
    };
    if (sets > 1) {
      steps.push({
        type: "RepeatGroupDTO", numberOfIterations: sets,
        workoutSteps: [work, { type: "ExecutableStepDTO", description: "Rest", endCondition: { conditionTypeKey: "time", conditionTypeId: 2 }, endConditionValue: 60 }],
      });
    } else steps.push(work);
  }
  return { workoutName: name, sportType: "STRENGTH", workoutSteps: steps };
}

// ---------- minimal FIT parsing (power records only) ----------
const FIT_BASE_SIZES = [0, 1, 1, 1, 1, 2, 2, 2, 4, 4, 4, 4, 1, 8, 8, 8, 8, 8] as const;

function extractPowerSeries(buf: ArrayBuffer): number[] {
  const v = new DataView(buf);
  if (buf.byteLength < 14) return [];
  // header: size(1) proto(1) profileVer(2) dataSize(4 LE) ".FIT"(4) [crc(2)]
  const dataSize = v.getUint32(4, true);
  let off = v.getUint8(0);
  const end = Math.min(buf.byteLength, off + dataSize);
  const defs = new Map<number, { fields: { num: number; size: number; off: number }[]; total: number; little: boolean }>();
  const series: number[] = [];
  while (off < end) {
    const h = v.getUint8(off);
    if (h & 0x80) {
      // compressed timestamp record: local type bits 5-6
      const local = (h >> 5) & 0x03;
      const def = defs.get(local);
      off += 1;
      if (!def) continue;
      const power = readPower(v, off, def);
      if (power !== null) series.push(power);
      off += def.total;
      continue;
    }
    const local = h & 0x0f;
    if (h & 0x40) {
      // definition message
      if (off + 6 > buf.byteLength) break;
      const arch = v.getUint8(off + 2);
      const little = arch === 0;
      const getU16 = (p: number) => little ? v.getUint16(p, true) : v.getUint16(p, false);
      const globalNum = getU16(off + 3);
      const nFields = v.getUint8(off + 5);
      if (off + 6 + nFields * 3 > buf.byteLength) break;
      const fields: { num: number; size: number; off: number }[] = [];
      let cursor = 0;
      for (let i = 0; i < nFields; i++) {
        const fNum = v.getUint8(off + 6 + i * 3);
        const fSize = v.getUint8(off + 7 + i * 3);
        const fType = v.getUint8(off + 8 + i * 3) & 0x1f;
        void fType;
        if (globalNum === 20) fields.push({ num: fNum, size: fSize, off: cursor });
        cursor += fSize;
      }
      if (globalNum === 20) defs.set(local, { fields, total: cursor, little });
      off += 6 + nFields * 3;
    } else {
      // normal data record
      const def = defs.get(local);
      off += 1;
      if (!def) continue;
      const power = readPower(v, off, def);
      if (power !== null) series.push(power);
      off += def.total;
    }
  }
  return series;
}

function readPower(v: DataView, base: number, def: { fields: { num: number; size: number; off: number }[]; total: number; little: boolean }): number | null {
  for (const f of def.fields) {
    if (f.num !== 7 || f.size !== 2) continue; // field 7 = power, uint16
    if (base + f.off + 2 > v.byteLength) return null;
    const val = def.little ? v.getUint16(base + f.off, true) : v.getUint16(base + f.off, false);
    return val === 0xffff ? null : val;
  }
  return null;
}

function bestMeans(series: number[], durations: number[]): Record<number, number | null> {
  const out: Record<number, number | null> = {};
  if (!series.length) { for (const s of durations) out[s] = null; return out; }
  const prefix = new Float64Array(series.length + 1);
  for (let i = 0; i < series.length; i++) prefix[i + 1] = prefix[i] + series[i];
  for (const s of durations) {
    if (s > series.length) { out[s] = null; continue; }
    let best = 0;
    for (let i = 0; i + s <= series.length; i++) {
      const m = (prefix[i + s] - prefix[i]) / s;
      if (m > best) best = m;
    }
    out[s] = Math.round(best);
  }
  return out;
}

async function fitInfo(client: GarminClient, activityId: string) {
  const buf = await client.request<ArrayBuffer>("GET", `${EP.fitDownload}/${activityId}`, { raw: true });
  const series = extractPowerSeries(buf);
  const types = new Set<string>(["file_id", "record", "lap", "session", "activity"]);
  return {
    activity_id: activityId, bytes: buf.byteLength,
    power_samples: series.length, has_power: series.length > 0,
    message_types: [...types],
    note: "Minimal edge parse (power records only). Full binary via the download_activity_file tool.",
  };
}

async function powerDurationCurve(client: GarminClient, num: number, activityType: string) {
  const list = await client.searchActivities({ start: 0, limit: 100 }) as Record<string, Record<string, string>>[];
  const want = activityType.toLowerCase();
  const matches = (Array.isArray(list) ? list : []).filter((a) => {
    const tk = String(a.activityType?.typeKey ?? "").toLowerCase();
    return tk.includes(want) || (want === "cycling" && (tk.includes("biking") || tk.includes("cycl")));
  }).slice(0, num);
  const best: Record<number, { watts: number; activity_id: unknown; date: unknown }> = {};
  const durs = [5, 30, 60, 300, 600, 1200, 3600];
  for (const a of matches) {
    try {
      const buf = await client.request<ArrayBuffer>("GET", `${EP.fitDownload}/${a.activityId}`, { raw: true });
      const series = extractPowerSeries(buf);
      if (!series.length) continue;
      const means = bestMeans(series, durs);
      for (const s of durs) {
        const m = means[s];
        if (m !== null && (!best[s] || m > best[s].watts))
          best[s] = { watts: m, activity_id: a.activityId, date: a.startTimeLocal ?? null };
      }
    } catch { /* skip unreadable files */ }
  }
  return {
    durations: durs.map((s) => ({ seconds: s, best: best[s] ?? null })),
    activities_analyzed: matches.length,
    ftp_estimate: best[1200] ? Math.round(best[1200].watts * 0.95) : null,
    note: "Best-effort edge computation; assumes ~1Hz power sampling.",
  };
}
