/** Offline browser retry audit with injected requests and clock; no real waits or HTTP. */
import assert from "node:assert/strict";
import { sendChatRequest } from "../lib/chatRetry";

type Reply = { status: number; data: Record<string, unknown>; retryAfter?: string };
function harness(replies: Reply[], initialTime = Date.parse("2026-10-07T12:00:00Z")) {
  let time = initialTime;
  let calls = 0;
  const requests: { conversationId: string | null; message: string }[] = [];
  const waits: number[] = [];
  const countdown: (number | null)[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    assert.equal(input, "/api/chat");
    assert.equal(init?.method, "POST");
    requests.push(JSON.parse(String(init?.body)));
    const reply = replies[calls++];
    assert.ok(reply, "unexpected extra request");
    return new Response(JSON.stringify(reply.data), {
      status: reply.status,
      headers: reply.retryAfter === undefined ? {} : { "Retry-After": reply.retryAfter },
    });
  };
  return {
    requests, waits, countdown,
    run: (conversationId: string | null = null) => sendChatRequest(
      "How many eggs to eat per day?", conversationId, (seconds) => countdown.push(seconds),
      { fetch: fakeFetch, now: () => time, wait: async (ms) => { waits.push(ms); time += ms; } }
    ),
  };
}
const success = (conversationId = "owned-conversation"): Reply => ({
  status: 200, data: { conversationId, answer: "Eggs can be included in a varied diet.", claims: [], answerMode: "general" },
});
const capacity = (seconds = "2", conversationId = "owned-conversation"): Reply => ({
  status: 503, retryAfter: seconds,
  data: { conversationId, answer: "At capacity.", claims: [], errorCode: "capacity", retryAfterSeconds: Number(seconds) },
});

async function main() {
  let passed = 0;
  const failures: string[] = [];
  async function test(label: string, run: () => Promise<void>) {
    try { await run(); passed++; console.log(`PASS: ${label}`); }
    catch (error) {
      failures.push(label);
      console.error(`FAIL: ${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  await test("successful answer makes one request and clears the wait indicator", async () => {
    const h = harness([success()]);
    const result = await h.run();
    assert.equal(result.response.status, 200);
    assert.equal(h.requests.length, 1);
    assert.equal(h.waits.length, 0);
    assert.deepEqual(h.countdown, [null]);
  });
  await test("capacity retry respects the countdown and preserves returned conversation ownership", async () => {
    const h = harness([capacity(), success()]);
    const result = await h.run();
    assert.equal(result.response.status, 200);
    assert.equal(h.requests.length, 2);
    assert.equal(h.requests[0].conversationId, null);
    assert.equal(h.requests[1].conversationId, "owned-conversation");
    assert.equal(h.requests[1].message, h.requests[0].message);
    assert.deepEqual(h.waits, [1000, 1000]);
    assert.deepEqual(h.countdown.filter((value) => value !== null), [2, 1]);
    assert.equal(h.countdown.at(-1), null);
  });
  await test("provider outages and authorization errors are never automatically retried", async () => {
    for (const status of [401, 403, 422, 503]) {
      const h = harness([{ status, retryAfter: "2", data: { errorCode: "provider_unavailable", answer: "Unavailable." } }]);
      assert.equal((await h.run()).response.status, status);
      assert.equal(h.requests.length, 1);
      assert.equal(h.waits.length, 0);
    }
  });
  await test("persistent capacity stops after two retries and returns the final failure", async () => {
    const h = harness([capacity(), capacity(), capacity()]);
    const result = await h.run();
    assert.equal(result.response.status, 503);
    assert.equal(result.data.errorCode, "capacity");
    assert.equal(h.requests.length, 3);
    assert.equal(h.waits.reduce((sum, ms) => sum + ms, 0), 4000);
    assert.equal(h.countdown.at(-1), null);
  });
  await test("daily quota and waits above ninety seconds fail immediately", async () => {
    for (const seconds of ["91", "3600", "86400"]) {
      const h = harness([capacity(seconds)]);
      assert.equal((await h.run()).response.status, 503);
      assert.equal(h.requests.length, 1);
      assert.equal(h.waits.length, 0);
    }
  });
  await test("combined capacity waits remain below the total browser deadline", async () => {
    const h = harness([capacity("80"), capacity("80")]);
    assert.equal((await h.run()).response.status, 503);
    assert.equal(h.requests.length, 2);
    assert.equal(h.waits.reduce((sum, ms) => sum + ms, 0), 80_000);
  });
  await test("HTTP date Retry-After is measured against the injected current time", async () => {
    const h = harness([capacity("Wed, 07 Oct 2026 12:00:03 GMT"), success()]);
    assert.equal((await h.run()).response.status, 200);
    assert.equal(h.waits.reduce((sum, ms) => sum + ms, 0), 3000);
  });
  await test("body retry hint works when the proxy did not supply a header", async () => {
    const noHeader = capacity(); delete noHeader.retryAfter;
    noHeader.data.retryAfterSeconds = 3;
    const h = harness([noHeader, success()]);
    assert.equal((await h.run()).response.status, 200);
    assert.equal(h.waits.reduce((sum, ms) => sum + ms, 0), 3000);
  });
  await test("invalid or nonpositive retry hints cannot start an unbounded retry loop", async () => {
    for (const seconds of ["0", "-1", "not-a-date"]) {
      const h = harness([capacity(seconds)]);
      assert.equal((await h.run()).response.status, 503);
      assert.equal(h.requests.length, 1);
      assert.equal(h.waits.length, 0);
    }
  });
  await test("ownership mismatch is recovered once by starting a fresh conversation", async () => {
    const h = harness([{ status: 404, data: { error: "Not found" } }, success("new-owned-conversation")]);
    const result = await h.run("old-conversation");
    assert.equal(result.response.status, 200);
    assert.equal(result.data.conversationId, "new-owned-conversation");
    assert.deepEqual(h.requests.map((r) => r.conversationId), ["old-conversation", null]);
    assert.equal(h.waits.length, 0);
  });
  await test("repeated ownership failures stop after the one allowed recovery", async () => {
    const notFound = { status: 404, data: { error: "Not found" } };
    const h = harness([notFound, notFound]);
    assert.equal((await h.run("old-conversation")).response.status, 404);
    assert.equal(h.requests.length, 2);
    assert.equal(h.waits.length, 0);
  });
  await test("ownership recovery and capacity retry maintain the new conversation identifier", async () => {
    const h = harness([{ status: 404, data: { error: "Not found" } }, capacity("1", "new-owner"), success("new-owner")]);
    assert.equal((await h.run("old-owner")).response.status, 200);
    assert.deepEqual(h.requests.map((r) => r.conversationId), ["old-owner", null, "new-owner"]);
    assert.equal(h.waits.reduce((sum, ms) => sum + ms, 0), 1000);
  });
  await test("transport failure returns to the caller without a duplicate request", async () => {
    let requests = 0;
    await assert.rejects(sendChatRequest("How do I cook eggs?", null, () => {}, {
      fetch: async () => { requests++; throw new Error("offline transport unavailable"); },
      wait: async () => { throw new Error("must not wait on transport failure"); },
    }), /offline transport unavailable/);
    assert.equal(requests, 1);
  });
  console.log(`\nBrowser capacity retry audit: ${passed} passed, ${failures.length} failed. No network, API quota or real waits.`);
  if (failures.length) process.exitCode = 1;
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
