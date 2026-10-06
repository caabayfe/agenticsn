import { afterEach, describe, expect, it } from "bun:test";
import { developmentInstances } from "../../src/registry/development-instances";
import { FAKE_CONTEXT } from "../support/fakes";
import { instanceWorkspace } from "../support/instance-workspace";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe("developmentInstances", () => {
  it("names the workspace's development instances", async () => {
    const ws = await instanceWorkspace({});
    cleanups.push(ws.cleanup);
    expect(await developmentInstances(ws.context)).toEqual(["pdi"]);
  });

  it("leaves out test and production instances", async () => {
    const ws = await instanceWorkspace({}, "production");
    cleanups.push(ws.cleanup);
    expect(await developmentInstances(ws.context)).toEqual([]);
  });

  it("is empty outside a workspace", async () => {
    expect(await developmentInstances(FAKE_CONTEXT)).toEqual([]);
  });
});
