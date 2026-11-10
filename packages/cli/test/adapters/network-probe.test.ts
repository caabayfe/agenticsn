import { describe, expect, it } from "bun:test";
import { networkProbe } from "../../src/adapters/network-probe";

describe("the network probe", () => {
  it("reports the proxy of the environment it is given, without its credentials", async () => {
    const check = await networkProbe({ HTTPS_PROXY: "http://u:p@proxy.example:8080" }).run();
    expect(check).toMatchObject({ name: "network", status: "ok" });
    expect(check.detail).toBe(
      "HTTPS_PROXY=http://***@proxy.example:8080; built-in certificate list",
    );
  });
});
