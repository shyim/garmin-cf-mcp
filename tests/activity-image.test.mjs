import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { GarminClient, GarminAuthError, GarminNotFoundError, GarminRateLimitError } from "../.test-build/garmin/client.js";
import { MAX_IMAGE_BYTES, decodeActivityImage } from "../.test-build/garmin/activity-image.js";
import { registerActivityTools } from "../.test-build/mcp/tools-activities.js";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==";
const tokens = { di_token: "test-token", di_refresh_token: "test-refresh", di_client_id: "test-client" };
const detail = (...ids) => ({ metadataDTO: { activityImages: ids.map((imageId) => ({ imageId })) } });
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function sequence(handlers) {
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, ...options });
    assert.ok(handlers.length, "unexpected extra network request");
    return handlers.shift()(url, options);
  };
  return requests;
}

test("sends one file as multipart with native auth and confirms a newly added ID", async () => {
  const requests = sequence([
    () => json(detail("old")),
    async (url, options) => {
      assert.equal(url, "https://connectapi.garmin.com/activity-service/activity/25048173751/image");
      assert.equal(options.method, "POST");
      assert.equal(options.headers.Authorization, "Bearer test-token");
      assert.equal(options.headers["User-Agent"], "GCM-Android-5.23");
      assert.equal(options.headers["Content-Type"], undefined);
      const request = new Request(url, options);
      assert.match(request.headers.get("content-type"), /^multipart\/form-data; boundary=/);
      const form = await request.formData();
      assert.deepEqual([...form.keys()], ["file"]);
      const file = form.get("file");
      assert.equal(file.name, "summary.png");
      assert.equal(file.type, "image/png");
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), Buffer.from(png, "base64"));
      return json({ imageId: "new" });
    },
    () => json(detail("old", "new")),
  ]);
  const result = await new GarminClient(tokens).uploadActivityImage("25048173751", png, "summary.png");
  assert.deepEqual(result, { activity_id: "25048173751", uploaded: true, verified: true, image_ids: ["new"] });
  assert.equal(requests.length, 3);
});

test("an empty 204 upload response can be verified and uses the tenant's Garmin domain", async () => {
  const requests = sequence([() => json(detail()), () => new Response(null, { status: 204 }), () => json(detail(42))]);
  const result = await new GarminClient({ ...tokens, domain: "garmin.cn" }).uploadActivityImage(123, png, "photo.PNG");
  assert.equal(result.verified, true);
  assert.ok(requests.every(({ url }) => url.startsWith("https://connectapi.garmin.cn/")));
});

test("401 refresh retries the multipart body with fresh authorization and a valid boundary", async () => {
  let firstBytes;
  const requests = sequence([
    () => json(detail()),
    async (_, options) => { firstBytes = await options.body.get("file").arrayBuffer(); return json({}, 401); },
    (url, options) => {
      assert.equal(url, "https://diauth.garmin.com/di-oauth2-service/oauth/token");
      assert.equal(options.method, "POST");
      return json({ access_token: "fresh-token", refresh_token: "fresh-refresh" });
    },
    async (url, options) => {
      assert.equal(options.headers.Authorization, "Bearer fresh-token");
      assert.equal(options.headers["Content-Type"], undefined);
      const form = await new Request(url, options).formData();
      assert.deepEqual(await form.get("file").arrayBuffer(), firstBytes);
      return json({ imageId: "new" });
    },
    () => json(detail("new")),
  ]);
  let saved;
  const result = await new GarminClient(tokens, { onTokensRefreshed: (value) => { saved = value; } }).uploadActivityImage(123, png, "photo.png");
  assert.equal(result.verified, true);
  assert.equal(saved.di_token, "fresh-token");
  assert.equal(requests.filter((r) => r.method === "POST" && r.url.includes("/activity-service/")).length, 2);
});

test("retries only verification GETs when the new photo is initially absent", async () => {
  const requests = sequence([() => json(detail()), () => json({}), () => json(detail()), () => json(detail("new"))]);
  assert.equal((await new GarminClient(tokens).uploadActivityImage(123, png, "photo.png")).verified, true);
  assert.equal(requests.filter((r) => r.method === "POST").length, 1);
});

test("existing images alone never verify an upload", async () => {
  const requests = sequence([() => json(detail("old")), () => json({}), ...Array.from({ length: 3 }, () => () => json(detail("old")))]);
  const result = await new GarminClient(tokens).uploadActivityImage(123, png, "photo.png");
  assert.equal(result.uploaded, true);
  assert.equal(result.verified, false);
  assert.match(result.warning, /before retrying/);
  assert.equal(requests.filter((r) => r.method === "POST").length, 1);
});

test("another new image does not verify a returned imageId", async () => {
  sequence([() => json(detail()), () => json({ imageId: "expected" }), ...Array.from({ length: 3 }, () => () => json(detail("other")))]);
  assert.equal((await new GarminClient(tokens).uploadActivityImage(123, png, "photo.png")).verified, false);
});

test("verification failure preserves the accepted upload and never repeats it", async () => {
  const requests = sequence([() => json(detail()), () => json({}), () => json({}, 429)]);
  const result = await new GarminClient(tokens).uploadActivityImage(123, png, "photo.png");
  assert.equal(result.uploaded, true);
  assert.equal(result.verified, false);
  assert.equal(requests.length, 3);
});

for (const status of [403, 404, 429, 500]) {
  test(`upload HTTP ${status} reports failure without verification or an automatic retry`, async () => {
    const requests = sequence([() => json(detail()), () => json({}, status)]);
    await assert.rejects(new GarminClient(tokens).uploadActivityImage(123, png, "photo.png"), /Inspect get_activity before retrying/);
    assert.equal(requests.length, 2);
  });
}

test("network failure has an uncertain outcome and is not retried", async () => {
  const requests = sequence([() => json(detail()), () => { throw new TypeError("network failure"); }]);
  await assert.rejects(new GarminClient(tokens).uploadActivityImage(123, png, "photo.png"), /outcome is unknown/);
  assert.equal(requests.length, 2);
});

test("invalid activity IDs, encodings, filenames, signatures and size fail before network access", async () => {
  sequence([]);
  for (const id of ["../1", "1/image", "0", -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
    await assert.rejects(new GarminClient(tokens).uploadActivityImage(id, png, "photo.png"), /activity_id/);
  for (const [data, filename] of [
    ["", "photo.png"], ["%%%", "photo.png"], [`data:image/png;base64,${png}`, "photo.png"],
    [png + "\n", "photo.png"], ["AB==", "photo.png"], [png, "../photo.png"], [png, "a\\photo.png"],
    [png, "bad\r\n.png"], [png, "photo.gif"], [png, "photo.jpg"], ["aGVsbG8=", "photo.png"],
    [Buffer.alloc(MAX_IMAGE_BYTES + 1).toString("base64"), "photo.png"],
  ]) await assert.rejects(new GarminClient(tokens).uploadActivityImage(123, data, filename));
});

test("accepts JPEG signatures and rejects malformed activity responses before writing", async () => {
  assert.equal(decodeActivityImage("/9j/2Q==", "photo.jpeg").type, "image/jpeg");
  const requests = sequence([() => json({ activityImages: [] })]);
  await assert.rejects(new GarminClient(tokens).uploadActivityImage(123, png, "photo.png"), /metadataDTO.activityImages/);
  assert.equal(requests.length, 1);
});

test("validates a full 5 MiB payload without recursive Base64 regex matching", async () => {
  const bytes = Buffer.alloc(MAX_IMAGE_BYTES);
  Buffer.from(png, "base64").copy(bytes);
  const blob = decodeActivityImage(bytes.toString("base64"), "photo.png");
  assert.equal(blob.size, MAX_IMAGE_BYTES);
  assert.equal(blob.type, "image/png");
});

test("preflight errors preserve client error types and do not upload", async () => {
  for (const [status, ErrorType] of [[403, GarminAuthError], [404, GarminNotFoundError], [429, GarminRateLimitError]]) {
    const requests = sequence([() => json({}, status)]);
    await assert.rejects(new GarminClient(tokens).uploadActivityImage(123, png, "photo.png"), ErrorType);
    assert.equal(requests.length, 1);
  }
});

test("registers a non-idempotent write, honors tool filters, and returns MCP errors", async () => {
  const registrations = new Map();
  const server = { registerTool: (name, config, handler) => registrations.set(name, { config, handler }) };
  const env = { GARMIN_ENABLED_TOOLS: "upload_activity_image" };
  const client = { uploadActivityImage: async () => { throw new Error("invalid photo"); } };
  registerActivityTools({ env, client, server, origin: "https://example.test", userId: "test" });
  assert.deepEqual([...registrations.keys()], ["upload_activity_image"]);
  const { config, handler } = registrations.get("upload_activity_image");
  assert.equal(config.annotations.readOnlyHint, false);
  assert.equal(config.annotations.idempotentHint, false);
  assert.equal(config.inputSchema.shape.activity_id.safeParse("../1").success, false);
  assert.equal((await handler({ activity_id: 123, image_base64: png, filename: "photo.png" })).isError, true);
  registrations.clear();
  registerActivityTools({ env: { GARMIN_DISABLED_TOOLS: "upload_activity_image" }, client, server });
  assert.equal(registrations.has("upload_activity_image"), false);
});
