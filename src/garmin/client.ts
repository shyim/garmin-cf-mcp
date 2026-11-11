// TypeScript port of the python-garminconnect API layer (garminconnect==0.3.2).
//
// Auth model (edge-compatible subset):
// - API calls: `Authorization: Bearer <di_token>` + native GCM headers.
// - Refresh: POST https://diauth.<domain>/di-oauth2-service/oauth/token
//   grant_type=refresh_token, HTTP Basic auth with `<di_client_id>:`.
// - Token JSON is identical to garmin_tokens.json so users can reuse the
//   output of the original `garmin-mcp-auth` CLI directly.
//
// The interactive email/password/MFA sign-in lives in ./login.ts (SSO mobile
// API → service ticket → DI token); this file only talks to connectapi.

import type { GarminTokens } from "../store/tokens.js";
import { activityImageIds, decodeActivityImage } from "./activity-image.js";

export const NATIVE_HEADERS: Record<string, string> = {
  "User-Agent": "GCM-Android-5.23",
  "X-Garmin-User-Agent":
    "com.garmin.android.apps.connectmobile/5.23; ; Google/sdk_gphone64_arm64/google; Android/33; Dalvik/2.1.0",
  "X-Garmin-Paired-App-Version": "10861",
  "X-Garmin-Client-Platform": "Android",
  "X-App-Ver": "10861",
  "X-Lang": "en",
  "X-GCExperience": "GC5",
  "Accept-Language": "en-US,en;q=0.9",
};

export function basicAuth(clientId: string): string {
  return "Basic " + btoa(`${clientId}:`);
}

export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function expiresSoon(token: string, skewSec = 900): boolean {
  const p = decodeJwtPayload(token);
  if (!p || typeof p.exp !== "number") return false;
  return Date.now() / 1000 > p.exp - skewSec;
}

export class GarminAuthError extends Error {}
export class GarminRateLimitError extends Error {}
export class GarminConnectionError extends Error {}
export class GarminNotFoundError extends Error {}

export interface GarminClientOptions {
  onTokensRefreshed?: (t: GarminTokens) => Promise<void> | void;
}

/** Endpoint paths mirrored from python-garminconnect (garminconnect==0.3.2).
 *  Case and nesting matter (e.g. endurancescore is lowercase, challenges
 *  live under badgechallenge-service, readiness under metrics-service). */
export const EP = {
  socialProfile: "/userprofile-service/socialProfile",
  activities: "/activitylist-service/activities/search/activities",
  activitiesCount: "/activitylist-service/activities/count",
  activityBase: "/activity-service/activity",
  activityTypes: "/activity-service/activity/activityTypes",
  activityForDate: "/mobile-gateway/heartRate/forDate", // + /{date}
  dailySummary: "/usersummary-service/usersummary/daily", // + /{displayName} ?calendarDate=
  userSummaryChart: "/wellness-service/wellness/dailySummaryChart", // + /{displayName} ?date=
  floorsDaily: "/wellness-service/wellness/floorsChartData/daily", // + /{date}
  heartratesDaily: "/wellness-service/wellness/dailyHeartRate", // + /{displayName} ?date=
  dailyStatsSteps: "/usersummary-service/stats/steps/daily", // + /{start}/{end}
  weeklySteps: "/usersummary-service/stats/steps/weekly", // + /{end}/{weeks}
  weeklyStress: "/usersummary-service/stats/stress/weekly", // + /{end}/{weeks}
  weeklyIntensity: "/usersummary-service/stats/im/weekly", // + /{start}/{end}
  personalRecord: "/personalrecord-service/personalrecord/prs",
  earnedBadges: "/badge-service/badge/earned",
  availableBadges: "/badge-service/badge/available",
  adhocChallenges: "/adhocchallenge-service/adHocChallenge/historical",
  badgeChallenges: "/badgechallenge-service/badgeChallenge/completed",
  availableBadgeChallenges: "/badgechallenge-service/badgeChallenge/available",
  nonCompletedBadge: "/badgechallenge-service/badgeChallenge/non-completed",
  inprogressVirtual: "/badgechallenge-service/virtualChallenge/inProgress",
  dailySleep: "/wellness-service/wellness/dailySleepData", // + /{displayName} ?date=&nonSleepBufferMinutes=60
  dailyStress: "/wellness-service/wellness/dailyStress", // + /{date}
  hillScore: "/metrics-service/metrics/hillscore", // + /stats
  bodyBattery: "/wellness-service/wellness/bodyBattery/reports/daily", // ?startDate=&endDate=
  bodyBatteryEvents: "/wellness-service/wellness/bodyBattery/events", // + /{date}
  bloodPressureRange: "/bloodpressure-service/bloodpressure/range", // + /{start}/{end}
  bloodPressure: "/bloodpressure-service/bloodpressure",
  enduranceScore: "/metrics-service/metrics/endurancescore", // + /stats
  runningTolerance: "/metrics-service/metrics/runningtolerance/stats",
  menstrualCalendar: "/periodichealth-service/menstrualcycle/calendar", // + /{start}/{end}
  menstrualDayview: "/periodichealth-service/menstrualcycle/dayview", // + /{date}
  pregnancy: "/periodichealth-service/menstrualcycle/pregnancysnapshot",
  goals: "/goal-service/goal/goals",
  rhr: "/userstats-service/wellness/daily", // + /{displayName} ?calendarDate=
  hrv: "/hrv-service/hrv", // + /{date} or /daily/{start}/{end}
  trainingReadiness: "/metrics-service/metrics/trainingreadiness", // + /{date}
  racePredictor: "/metrics-service/metrics/racepredictions",
  trainingStatus: "/metrics-service/metrics/trainingstatus/aggregated", // + /{date}
  fitnessage: "/fitnessage-service/fitnessage", // + /{date}
  weight: "/weight-service",
  hydrationDaily: "/usersummary-service/usersummary/hydration/daily", // + /{date}
  hydrationSet: "/usersummary-service/usersummary/hydration/log",
  respirationDaily: "/wellness-service/wellness/daily/respiration", // + /{date}
  spo2Daily: "/wellness-service/wellness/daily/spo2", // + /{date}
  intensityDaily: "/wellness-service/wellness/daily/im", // + /{date}
  lifestyle: "/lifestylelogging-service/dailyLog", // + /{date}
  dailyEvents: "/wellness-service/wellness/dailyEvents", // ?calendarDate=
  devices: "/device-service/deviceregistration/devices",
  deviceInfo: "/device-service/deviceservice", // + /mylastused | /device-info/settings/{id}
  primaryDevice: "/web-gateway/device-info/primary-training-device",
  solar: "/web-gateway/solar", // + /{deviceId}/{start}/{end}
  deviceMessages: "/device-service/devicemessage/messages",
  gear: "/gear-service/gear/filterGear",
  gearBase: "/gear-service/gear", // + /link|unlink/{uuid}/activity/{id}
  nutritionFoodLog: "/nutrition-service/food/logs", // + /{date}, /range, /quickAdd
  nutritionMeals: "/nutrition-service/meals", // + /{date}
  nutritionSettings: "/nutrition-service/settings", // + /{date}
  nutritionFoodSearch: "/nutrition-service/food/search",
  nutritionCustomFood: "/nutrition-service/customFood", // + /{id}
  nutritionServingUnits: "/nutrition-service/metadata/customFoodServingUnits",
  trainingPlan: "/trainingplan-service/trainingplan",
  workouts: "/workout-service/workout",
  workoutSchedule: "/workout-service/schedule", // POST + /{workoutId} {date}; DELETE + /{scheduleId}
  calendarBase: "/calendar-service", // + /year/{y}/month/{m0}
  courses: "/course-service/course",
  heartRateZones: "/biometric-service/heartRateZones",
  powerZones: "/biometric-service/powerZones",
  biometric: "/biometric-service/biometric", // + /latestLactateThreshold | /latestFunctionalThresholdPower/CYCLING
  biometricStats: "/biometric-service/stats",
  maxMetrics: "/metrics-service/metrics/maxmet/daily", // + /{date}/{date}
  fitnessStats: "/fitnessstats-service/activity",
  fitDownload: "/download-service/files/activity",
  upload: "/upload-service/upload",
  userSettings: "/userprofile-service/userprofile/user-settings",
  userProfileSettings: "/userprofile-service/userprofile/settings",
} as const;

export class GarminClient {
  tokens: GarminTokens;
  onRefreshed?: GarminClientOptions["onTokensRefreshed"];
  private displayName: string | null;
  private refreshing: Promise<void> | null = null;

  constructor(tokens: GarminTokens, opts?: GarminClientOptions) {
    this.tokens = { ...tokens };
    this.onRefreshed = opts?.onTokensRefreshed;
    this.displayName = tokens.displayName ?? null;
  }

  get domain(): string {
    return this.tokens.domain ?? "garmin.com";
  }
  get connectapiBase(): string {
    return `https://connectapi.${this.domain}`;
  }
  get diauthUrl(): string {
    return `https://diauth.${this.domain}/di-oauth2-service/oauth/token`;
  }

  private apiHeaders(): Record<string, string> {
    if (!this.tokens.di_token) throw new GarminAuthError("Not authenticated");
    return {
      ...NATIVE_HEADERS,
      Authorization: `Bearer ${this.tokens.di_token}`,
      Accept: "application/json",
    };
  }

  private async refreshDiToken(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        client_id: this.tokens.di_client_id,
        refresh_token: this.tokens.di_refresh_token,
      });
      const res = await fetch(this.diauthUrl, {
        method: "POST",
        headers: {
          ...NATIVE_HEADERS,
          Authorization: basicAuth(this.tokens.di_client_id),
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
          "Cache-Control": "no-cache",
        },
        body: body.toString(),
      });
      if (!res.ok)
        throw new GarminAuthError(`Garmin token refresh failed: ${res.status}`);
      const data = (await res.json()) as {
        access_token: string;
        refresh_token?: string;
      };
      this.tokens.di_token = data.access_token;
      if (data.refresh_token) this.tokens.di_refresh_token = data.refresh_token;
      const payload = decodeJwtPayload(data.access_token);
      if (payload && typeof payload.client_id === "string")
        this.tokens.di_client_id = payload.client_id;
      if (this.onRefreshed) await this.onRefreshed({ ...this.tokens });
    })();
    try {
      await this.refreshing;
    } finally {
      this.refreshing = null;
    }
  }

  private async ensureFresh(): Promise<void> {
    if (this.tokens.di_token && expiresSoon(this.tokens.di_token)) {
      try {
        await this.refreshDiToken();
      } catch {
        /* fall through — request will retry/raise */
      }
    }
  }

  /** Core request helper: GET/POST/PUT/DELETE against connectapi host. */
  async request<T = unknown>(
    method: string,
    path: string,
    opts: {
      params?: Record<string, string | number | boolean | undefined>;
      json?: unknown;
      form?: URLSearchParams | string;
      multipart?: FormData;
      headers?: Record<string, string>;
      raw?: boolean;
    } = {},
  ): Promise<T> {
    if (
      path.includes("?") ||
      path.includes("#") ||
      path.includes("\\") ||
      /(^|\/)\.\.(\/|;|$)/.test(path)
    )
      throw new Error(`Invalid API path: ${path}`);
    await this.ensureFresh();

    const url = new URL(`${this.connectapiBase}/${path.replace(/^\//, "")}`);
    if (opts.params)
      for (const [k, v] of Object.entries(opts.params))
        if (v !== undefined) url.searchParams.set(k, String(v));

    const headers: Record<string, string> = {
      ...this.apiHeaders(),
      // Garmin's export endpoints answer 406 to Accept: application/json.
      ...(opts.raw ? { Accept: "*/*" } : {}),
      ...(opts.headers ?? {}),
    };
    let body: BodyInit | undefined;
    if (opts.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.json);
    } else if (opts.form !== undefined) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = opts.form.toString();
    } else if (opts.multipart !== undefined) {
      // fetch must generate the multipart boundary, including on an auth retry.
      body = opts.multipart;
    }

    const doFetch = () =>
      fetch(url.toString(), { method, headers, body, signal: AbortSignal.timeout(20000) });

    let res = await doFetch();
    if (res.status === 401) {
      await this.refreshDiToken();
      const retryHeaders: Record<string, string> = { ...this.apiHeaders(), ...(opts.raw ? { Accept: "*/*" } : {}), ...(opts.headers ?? {}) };
      if (opts.json !== undefined) retryHeaders["Content-Type"] = "application/json";
      res = await fetch(url.toString(), {
        method,
        headers: retryHeaders,
        body,
        signal: AbortSignal.timeout(20000),
      });
    }
    if (res.status === 204) return {} as T;
    if (res.status === 404) throw new GarminNotFoundError(`Not found: ${path}`);
    if (res.status === 429) throw new GarminRateLimitError("Garmin rate limit hit — wait a few minutes.");
    if (res.status === 401 || res.status === 403)
      throw new GarminAuthError(
        "Garmin authentication failed — sign in again at /account (or re-import tokens via garmin_connect).",
      );
    if (res.status >= 400)
      throw new GarminConnectionError(`Garmin API error ${res.status} on ${path}`);
    if (opts.raw) return (await res.arrayBuffer()) as unknown as T;
    const text = await res.text();
    if (!text) return {} as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }

  get<T = unknown>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>("GET", path, { params });
  }
  /** Garmin's GraphQL gateway (training-plan scalar, etc.). */
  queryGraphql<T = unknown>(query: string): Promise<T> {
    return this.request<T>("POST", "/graphql-gateway/graphql", { json: { query } });
  }
  post<T = unknown>(path: string, json?: unknown): Promise<T> {
    return this.request<T>("POST", path, { json });
  }
  put<T = unknown>(path: string, json?: unknown): Promise<T> {
    return this.request<T>("PUT", path, { json });
  }
  del<T = unknown>(path: string, json?: unknown): Promise<T> {
    return this.request<T>("DELETE", path, json !== undefined ? { json } : {});
  }

  // ---- identity ----
  async getDisplayName(): Promise<string> {
    if (this.displayName) return this.displayName;
    const p = await this.get<{ displayName?: string }>(EP.socialProfile);
    if (!p?.displayName) throw new GarminConnectionError("Could not resolve displayName");
    this.displayName = p.displayName;
    return p.displayName;
  }

  // ---- activities ----
  searchActivities(params: Record<string, string | number | boolean | undefined>) {
    return this.get(EP.activities, params);
  }
  listActivities(start = 0, limit = 20, activityType?: string) {
    const params: Record<string, string> = { start: String(start), limit: String(limit) };
    if (activityType) params.activityType = activityType;
    return this.get(EP.activities, params);
  }
  getActivitiesCount() {
    return this.get(EP.activitiesCount);
  }
  getActivity(id: string | number) {
    return this.get(`${EP.activityBase}/${id}`);
  }
  async uploadActivityImage(id: string | number, imageBase64: string, filename: string) {
    if ((typeof id === "number" && !Number.isSafeInteger(id)) || !/^[1-9]\d*$/.test(String(id)))
      throw new Error("activity_id must be a positive integer (use a string for large IDs)");
    const image = decodeActivityImage(imageBase64, filename);
    const before = new Set(activityImageIds(await this.getActivity(id)));
    const form = new FormData();
    form.append("file", image, filename);
    let upload: unknown;
    try {
      upload = await this.request("POST", `${EP.activityBase}/${id}/image`, { multipart: form });
    } catch (e) {
      throw new Error(`Photo upload failed or its outcome is unknown: ${(e as Error).message}. Inspect get_activity before retrying to avoid duplicate photos.`);
    }
    // A successful POST is not proof that the image is visible yet. Never repeat
    // the POST on a verification failure; Garmin may have accepted it already.
    const returnedId = (upload as { imageId?: unknown } | null)?.imageId;
    const expectedId = typeof returnedId === "string" || typeof returnedId === "number" ? String(returnedId) : null;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt) await new Promise((resolve) => setTimeout(resolve, 1000));
        const ids = activityImageIds(await this.getActivity(id));
        const added = ids.filter((imageId) => !before.has(imageId));
        const verified = expectedId ? added.includes(expectedId) : added.length === 1;
        if (verified) return { activity_id: String(id), uploaded: true, verified: true, image_ids: added };
      }
    } catch {
      // Report the completed write even if the following GET fails.
    }
    return {
      activity_id: String(id), uploaded: true, verified: false,
      warning: "Garmin accepted the upload, but a new image could not be confirmed. Inspect get_activity metadataDTO.activityImages before retrying to avoid duplicates.",
    };
  }
  updateActivity(id: string | number, payload: unknown) {
    return this.request("PUT", `${EP.activityBase}/${id}`, { json: payload });
  }
  getActivityTypes() {
    return this.get(EP.activityTypes);
  }
  getActivitiesForDate(date: string) {
    return this.get(`${EP.activityForDate}/${date}`);
  }

  // ---- thin wrappers used by tools ----
  getDailySummary(displayName: string, date: string) {
    return this.get(`${EP.dailySummary}/${displayName}`, { calendarDate: date });
  }
  getStepsData(displayName: string, date: string) {
    return this.get(`${EP.userSummaryChart}/${displayName}`, { date });
  }
  getHeartRates(displayName: string, date: string) {
    return this.get(`${EP.heartratesDaily}/${displayName}`, { date });
  }
  getSleep(date: string) {
    return this.getDisplayName().then((dn) =>
      this.get(`${EP.dailySleep}/${dn}`, { date, nonSleepBufferMinutes: 60 }),
    );
  }
  getStress(date: string) {
    return this.get(`${EP.dailyStress}/${date}`);
  }
  getBodyBattery(start: string, end: string) {
    return this.get(EP.bodyBattery, { startDate: start, endDate: end });
  }
  getHrv(date: string) {
    return this.get(`${EP.hrv}/${date}`);
  }
  getHrvRange(start: string, end: string) {
    return this.get(`${EP.hrv}/daily/${start}/${end}`);
  }
  getRespiration(date: string) {
    return this.get(`${EP.respirationDaily}/${date}`);
  }
  getSpo2(date: string) {
    return this.get(`${EP.spo2Daily}/${date}`);
  }
  getHydration(date: string) {
    return this.get(`${EP.hydrationDaily}/${date}`);
  }
  getTrainingStatus(date: string) {
    return this.get(`${EP.trainingStatus}/${date}`);
  }
  getTrainingReadiness(date: string) {
    return this.get(`${EP.trainingReadiness}/${date}`);
  }
  getRacePredictor() {
    return this.get(EP.racePredictor);
  }
  getWeighIns(start: string, end: string) {
    return this.get(`${EP.weight}/weight/range/${start}/${end}`);
  }
  getDevices() {
    return this.get(EP.devices);
  }
  getDeviceLastUsed() {
    return this.get(`${EP.deviceInfo}/mylastused`);
  }
  getDeviceSettings(deviceId: string | number) {
    return this.get(`${EP.deviceInfo}/device-info/settings/${deviceId}`);
  }
  getPrimaryDevice() {
    return this.get(EP.primaryDevice);
  }
  getGear() {
    return this.get(EP.gear, { page: 0, pageSize: 100 } as Record<string, string | number>);
  }
  getWorkouts() {
    return this.get(EP.workouts);
  }
  getWorkout(id: string | number) {
    return this.get(`${EP.workouts}/${id}`);
  }
  getCalendarMonth(year: number, month0: number) {
    return this.get(`${EP.calendarBase}/year/${year}/month/${month0}`);
  }
  getCourses(params?: Record<string, string | number | boolean | undefined>) {
    return this.get(EP.courses, params);
  }
}
