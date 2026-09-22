// Health & wellness tools — port of health_wellness.py / data_management.py.
// Endpoint paths verified against python-garminconnect==0.3.2.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { tool } from "./shim.js";
import { GarminClient, EP } from "../garmin/client.js";
import { toolAllowed } from "./filter.js";
import type { Env } from "../env.js";

interface Ctx { env: Env; client: GarminClient; server: McpServer }
const t = (s: unknown) => ({ content: [{ type: "text" as const, text: typeof s === "string" ? s : JSON.stringify(s, null, 2) }] });
const d = z.string().describe("Date YYYY-MM-DD");

export function registerHealthTools({ env, client, server }: Ctx) {
  const allow = (n: string) => toolAllowed(n, env);
  const wrap = async (fn: () => Promise<unknown>) => {
    try { return t(await fn()); } catch (e) { return t(`Garmin error: ${(e as Error).message}`); }
  };
  const get = (name: string, desc: string, shape: Record<string, z.ZodTypeAny>, fn: (a: Record<string, string>) => Promise<unknown>) => {
    if (!allow(name)) return;
    tool(server, name, desc, shape, async (a) => wrap(() => fn(a as Record<string, string>)));
  };

  const dn = () => client.getDisplayName();

  get("get_sleep_data", "Raw sleep payload for a date.", { date: d }, async ({ date }) => client.getSleep(date));
  get("get_sleep_summary", "Curated sleep summary (duration, score, phases, SpO2, HRV).", { date: d }, async ({ date }) => summarizeSleep(await client.getSleep(date)));
  get("get_sleep_summary_range", "Curated sleep summaries over a date range (max 31 days/call).", { start_date: d, end_date: d }, async ({ start_date, end_date }) => {
    const out = [];
    for (const day of eachDay(start_date, end_date).slice(0, 31)) {
      try { out.push({ date: day, ...(summarizeSleep(await client.getSleep(day)) as object) }); }
      catch { out.push({ date: day, error: "unavailable" }); }
    }
    return out;
  });
  get("get_stress_data", "All-day stress detail for a date.", { date: d }, async ({ date }) => client.getStress(date));
  get("get_stress_summary", "Curated stress summary (avg/max).", { date: d }, async ({ date }) => summarizeStress(await client.getStress(date)));
  get("get_all_day_stress", "All-day stress (alias of get_stress_data).", { date: d }, async ({ date }) => client.getStress(date));
  get("get_heart_rates", "Heart-rate time series for a date.", { date: d }, async ({ date }) => client.getHeartRates(await dn(), date));
  get("get_heart_rates_summary", "Curated HR summary (resting/max).", { date: d }, async ({ date }) => {
    const hr = await client.getHeartRates(await dn(), date) as Record<string, unknown>;
    return { date, resting: hr.restingHeartRate ?? null, max: hr.maxHeartRate ?? null };
  });
  get("get_heart_rate_zones", "Configured HR zones for all sport profiles.", {}, async () => client.get(EP.heartRateZones));
  get("get_steps_data", "Step chart data for a date.", { date: d }, async ({ date }) => client.getStepsData(await dn(), date));
  get("get_daily_steps", "Daily step totals between dates (inclusive).", { start_date: d, end_date: d }, async ({ start_date, end_date }) => client.get(`${EP.dailyStatsSteps}/${start_date}/${end_date}`));
  get("get_weekly_steps", "Weekly step totals ending at date.", { end_date: d, weeks: z.number().optional().default(4) }, async ({ end_date, weeks }) => client.get(`${EP.weeklySteps}/${end_date}/${weeks ?? 4}`));
  get("get_weekly_stress", "Weekly stress averages ending at date.", { end_date: d, weeks: z.number().optional().default(4) }, async ({ end_date, weeks }) => client.get(`${EP.weeklyStress}/${end_date}/${weeks ?? 4}`));
  get("get_weekly_intensity_minutes", "Weekly intensity minutes between dates.", { start_date: d, end_date: d }, async ({ start_date, end_date }) => client.get(`${EP.weeklyIntensity}/${start_date}/${end_date}`));
  get("get_floors", "Floors climbed for a date.", { date: d }, async ({ date }) => client.get(`${EP.floorsDaily}/${date}`));
  get("get_body_battery", "Body Battery values per day over a date range.", { start_date: d, end_date: d }, async ({ start_date, end_date }) => client.getBodyBattery(start_date, end_date));
  get("get_body_battery_events", "Body Battery events (sleep, activities, naps) for a date.", { date: d }, async ({ date }) => client.get(`${EP.bodyBatteryEvents}/${date}`));
  get("get_hrv_data", "HRV summary for a date.", { date: d }, async ({ date }) => client.getHrv(date));
  get("get_hrv_trend", "HRV daily values over a range (for trend charts).", { start_date: d, end_date: d }, async ({ start_date, end_date }) => client.getHrvRange(start_date, end_date));
  get("get_respiration_data", "Respiration (breaths/min time series) for a date.", { date: d }, async ({ date }) => client.getRespiration(date));
  get("get_respiration_summary", "Curated respiration summary.", { date: d }, async ({ date }) => {
    const r = await client.getRespiration(date) as Record<string, unknown>;
    return { date, avg: r.avgRespiration ?? r.averageRespiration ?? null, raw: r };
  });
  get("get_respiration_trend", "Respiration payloads over a range (max 31 days/call).", { start_date: d, end_date: d }, async ({ start_date, end_date }) => {
    const out = [];
    for (const day of eachDay(start_date, end_date).slice(0, 31)) {
      try { out.push({ date: day, data: await client.getRespiration(day) }); }
      catch { out.push({ date: day, error: "unavailable" }); }
    }
    return out;
  });
  get("get_spo2_data", "SpO2 for a date.", { date: d }, async ({ date }) => client.getSpo2(date));
  get("get_hydration_data", "Hydration log for a date.", { date: d }, async ({ date }) => client.getHydration(date));
  get("add_hydration_data", "Log water intake for a date (ml + timestamp).", {
    value_in_ml: z.number().describe("Milliliters"), date: d, timestamp: z.string().describe("Timestamp YYYY-MM-DDThh:mm:ss.sss"),
  }, async (a) => client.post(EP.hydrationSet, {
    calendarDate: String(a.date), valueInML: Number(a.value_in_ml), timestampLocal: String(a.timestamp),
  }));
  get("get_blood_pressure", "Blood pressure readings between dates.", { start_date: d, end_date: d }, async ({ start_date, end_date }) => client.get(`${EP.bloodPressureRange}/${start_date}/${end_date}`));
  get("set_blood_pressure", "Log a blood pressure reading.", {
    date: d, systolic: z.number(), diastolic: z.number(), pulse: z.number().optional(),
  }, async (a) => client.post(EP.bloodPressure, {
    calendarDate: String(a.date), systolic: Number(a.systolic), diastolic: Number(a.diastolic),
    ...(a.pulse !== undefined ? { pulse: Number(a.pulse) } : {}),
  }));
  get("get_body_composition", "Body composition (weight etc.) between dates.", { start_date: d, end_date: d }, async ({ start_date, end_date }) => client.get(`${EP.weight}/weight/dateRange`, { startDate: start_date, endDate: end_date }));
  get("add_body_composition", "Log a weigh-in: weight + optional body-fat/muscle metrics.", {
    date: d, weight_kg: z.number(), body_fat_pct: z.number().optional(), muscle_mass_kg: z.number().optional(),
  }, async (a) => client.post(`${EP.weight}/user-weight`, {
    dateTimestamp: `${String(a.date)}T07:00:00.0`, unitKey: "kg", sourceType: "MANUAL", value: Number(a.weight_kg),
    ...(a.body_fat_pct !== undefined ? { bodyFat: Number(a.body_fat_pct) } : {}),
    ...(a.muscle_mass_kg !== undefined ? { muscleMass: Number(a.muscle_mass_kg) } : {}),
  }));
  get("get_weigh_ins", "Weigh-ins between dates.", { start_date: d, end_date: d }, async ({ start_date, end_date }) => client.getWeighIns(start_date, end_date));
  get("get_daily_weigh_ins", "Weigh-ins for one date.", { date: d }, async ({ date }) => client.get(`${EP.weight}/weight/dayview/${date}`));
  get("get_rhr_day", "Resting HR + wellness daily rollup for a date.", { date: d }, async ({ date }) => client.get(`${EP.rhr}/${await dn()}`, { calendarDate: date }));
  get("get_stats", "Daily stats rollup for a date (alias of get_user_summary).", { date: d }, async ({ date }) => client.getDailySummary(await dn(), date));
  get("get_stats_and_body", "Stats + body composition for a date.", { date: d }, async ({ date }) => ({
    stats: await client.getDailySummary(await dn(), date),
    weigh_ins: await client.get(`${EP.weight}/weight/dayview/${date}`).catch(() => null),
  }));
  get("get_user_summary", "User summary for a date (steps, calories, distance…).", { date: d }, async ({ date }) => client.getDailySummary(await dn(), date));
  get("get_stats_range", "Daily stats for each day in range (max 31 days/call).", { start_date: d, end_date: d }, async ({ start_date, end_date }) => {
    const name = await dn();
    const out = [];
    for (const day of eachDay(String(start_date), String(end_date)).slice(0, 31)) {
      try { out.push({ date: day, stats: await client.getDailySummary(name, day) }); }
      catch { out.push({ date: day, error: "unavailable" }); }
    }
    return out;
  });
  get("get_lifestyle_logging_data", "Lifestyle log for a date.", { date: d }, async ({ date }) => client.get(`${EP.lifestyle}/${date}`));
  get("get_fitnessage_data", "Fitnessage (fitness age) for a date.", { date: d }, async ({ date }) => client.get(`${EP.fitnessage}/${date}`));
  get("get_all_day_events", "Wellness day events for a date.", { date: d }, async ({ date }) => client.get(EP.dailyEvents, { calendarDate: date }));
  get("get_energy_balance", "Composition-derived TDEE estimate over a range (intake + expenditure + weight trend). Rough estimate, not a lab measurement.", { start_date: d, end_date: d }, async ({ start_date, end_date }) => energyBalance(client, String(start_date), String(end_date)));
}

// --- helpers (ported curation logic) ---
function summarizeSleep(sleep: unknown) {
  const s = (sleep ?? {}) as Record<string, Record<string, unknown> | null>;
  const dto = (s.dailySleepDTO ?? {}) as Record<string, unknown>;
  const scores = (dto.sleepScores ?? {}) as Record<string, Record<string, unknown> | null>;
  const overall = (scores.overall ?? {}) as Record<string, unknown>;
  const total = dto.sleepTimeSeconds as number | undefined;
  const pct = (v: unknown) => typeof v === "number" && total ? Math.round((v / total) * 100) : null;
  return {
    sleep_seconds: dto.sleepTimeSeconds ?? null,
    sleep_score: overall.value ?? null,
    sleep_score_qualifier: overall.qualifierKey ?? null,
    deep_sleep_seconds: dto.deepSleepSeconds ?? null,
    light_sleep_seconds: dto.lightSleepSeconds ?? null,
    rem_sleep_seconds: dto.remSleepSeconds ?? null,
    awake_seconds: dto.awakeSleepSeconds ?? null,
    deep_sleep_percent: pct(dto.deepSleepSeconds),
    light_sleep_percent: pct(dto.lightSleepSeconds),
    rem_sleep_percent: pct(dto.remSleepSeconds),
    avg_spo2_percent: (s.wellnessSpO2SleepSummaryDTO as Record<string, unknown> | undefined)?.averageSpo2 ?? null,
    avg_overnight_hrv: s.avgOvernightHrv ?? null,
  };
}
function summarizeStress(stress: unknown) {
  const s = (stress ?? {}) as Record<string, unknown>;
  return { avg: s.averageStressLevel ?? s.avgStress ?? null, max: s.maxStressLevel ?? null, raw: s };
}
function eachDay(start: string, end: string): string[] {
  const out: string[] = [];
  const a = new Date(start + "T00:00:00Z"), b = new Date(end + "T00:00:00Z");
  for (let d = new Date(a); d <= b; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}

/** Simplified port of get_energy_balance: mean intake vs Garmin expenditure + weight-trend implied deficit. */
async function energyBalance(client: GarminClient, start: string, end: string) {
  const days = eachDay(start, end).slice(0, 61);
  const name = await client.getDisplayName();
  let intakeSum = 0, intakeDays = 0, expendSum = 0, expendDays = 0;
  for (const day of days) {
    try {
      const log = await client.get(`${EP.nutritionFoodLog}/${day}`) as Record<string, number>;
      if (typeof log.totalCalories === "number") { intakeSum += log.totalCalories; intakeDays++; }
    } catch { /* unlogged day */ }
    try {
      const st = await client.getDailySummary(name, day) as Record<string, number>;
      if (typeof st.totalKilocalories === "number") { expendSum += st.totalKilocalories; expendDays++; }
      else if (typeof st.totalCalories === "number") { expendSum += st.totalCalories; expendDays++; }
    } catch { /* missing day */ }
  }
  let weightDeltaKg: number | null = null;
  try {
    const w = await client.getWeighIns(start, end) as { dateWeightList?: { weight?: number; calendarDate?: string }[] };
    const list = (w.dateWeightList ?? []).filter((e) => typeof e.weight === "number");
    if (list.length >= 2) {
      const kg = (g: number) => g / 1000;
      weightDeltaKg = Math.round((kg(list[list.length - 1].weight as number) - kg(list[0].weight as number)) * 100) / 100;
    }
  } catch { /* no scale data */ }
  const meanIntake = intakeDays ? Math.round(intakeSum / intakeDays) : null;
  const meanExpenditure = expendDays ? Math.round(expendSum / expendDays) : null;
  const impliedDeficit = weightDeltaKg !== null && days.length > 0
    ? Math.round((-weightDeltaKg * 7700) / days.length)
    : null;
  return {
    days: days.length, intake_days: intakeDays, expenditure_days: expendDays,
    mean_intake_kcal: meanIntake, mean_garmin_expenditure_kcal: meanExpenditure,
    weight_delta_kg: weightDeltaKg, implied_deficit_kcal_per_day: impliedDeficit,
    composition_derived_tdee: meanIntake !== null && impliedDeficit !== null ? meanIntake + impliedDeficit : null,
    note: "Rough estimate (7700 kcal/kg fat). Garmin-overestimate vs under-logging cannot be distinguished.",
  };
}
