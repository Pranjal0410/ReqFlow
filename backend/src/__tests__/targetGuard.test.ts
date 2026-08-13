import { isPrivateTarget } from "../services/targetGuard";

describe("isPrivateTarget", () => {
  it("allows loopback and localhost", () => {
    expect(isPrivateTarget("http://localhost:3001/api")).toBe(true);
    expect(isPrivateTarget("http://127.0.0.1:4000/health")).toBe(true);
    expect(isPrivateTarget("http://127.1.2.3/x")).toBe(true);
    expect(isPrivateTarget("http://0.0.0.0:8080")).toBe(true);
  });

  it("allows the private ranges", () => {
    expect(isPrivateTarget("http://10.207.161.60:4000")).toBe(true);
    expect(isPrivateTarget("http://192.168.1.5:3000")).toBe(true);
    expect(isPrivateTarget("http://172.16.0.1")).toBe(true);
    expect(isPrivateTarget("http://172.31.255.254")).toBe(true);
    expect(isPrivateTarget("http://169.254.1.1")).toBe(true);
  });

  it("blocks public hosts", () => {
    expect(isPrivateTarget("https://example.com")).toBe(false);
    expect(isPrivateTarget("https://api.github.com/users")).toBe(false);
    expect(isPrivateTarget("http://8.8.8.8")).toBe(false);
    // 172.32 is outside 172.16/12
    expect(isPrivateTarget("http://172.32.0.1")).toBe(false);
    expect(isPrivateTarget("http://193.168.1.1")).toBe(false);
  });

  it("blocks hostnames that merely start like a private address", () => {
    // a naive startsWith("192.168.") check would let these through, and they
    // are ordinary domains someone can register and point anywhere
    expect(isPrivateTarget("http://192.168.evil.com")).toBe(false);
    expect(isPrivateTarget("http://10.attacker.net")).toBe(false);
    expect(isPrivateTarget("http://127.0.0.1.evil.com")).toBe(false);
    expect(isPrivateTarget("http://localhost.evil.com")).toBe(false);
  });

  it("blocks non http protocols", () => {
    expect(isPrivateTarget("file:///etc/passwd")).toBe(false);
    expect(isPrivateTarget("ftp://127.0.0.1/x")).toBe(false);
  });

  it("blocks malformed urls instead of throwing", () => {
    expect(isPrivateTarget("not a url")).toBe(false);
    expect(isPrivateTarget("")).toBe(false);
    expect(isPrivateTarget("http://")).toBe(false);
  });
});

// "localhost:3001" is how the address is normally written, and URL reads
// localhost: as the scheme, so the guard used to refuse it as a public host
describe("isPrivateTarget without a scheme", () => {
  it("lets an ordinary local address through", () => {
    expect(isPrivateTarget("localhost:3001/api")).toBe(true);
    expect(isPrivateTarget("127.0.0.1:4000")).toBe(true);
    expect(isPrivateTarget("192.168.1.5:3000/x")).toBe(true);
  });

  it("still refuses a public host written the same way", () => {
    expect(isPrivateTarget("example.com")).toBe(false);
    expect(isPrivateTarget("api.github.com/users")).toBe(false);
    expect(isPrivateTarget("8.8.8.8:80")).toBe(false);
  });

  it("is not fooled by a hostname that only looks private", () => {
    expect(isPrivateTarget("192.168.evil.com")).toBe(false);
    expect(isPrivateTarget("localhost.evil.com")).toBe(false);
    expect(isPrivateTarget("127.0.0.1.evil.com")).toBe(false);
  });

  it("keeps refusing a scheme that is not http", () => {
    expect(isPrivateTarget("file:///etc/passwd")).toBe(false);
    expect(isPrivateTarget("ftp://localhost:21")).toBe(false);
  });
});
