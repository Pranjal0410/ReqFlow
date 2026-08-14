import { hasRealCode } from "../services/codegen";

// Told a project has no controller layer, the model answers with a controller
// entry whose body is a comment saying exactly that. Rendered as a tab, that is
// an empty file where a developer expects code, so the layer is judged on what
// survives having its comments stripped.
describe("hasRealCode", () => {
  it("rejects a block comment standing in for a layer", () => {
    expect(
      hasRealCode("/* This project does not use a separate controller layer */")
    ).toBe(false);
  });

  it("rejects line comments and whitespace", () => {
    expect(hasRealCode("// nothing to add here\n//\n   \n")).toBe(false);
    expect(hasRealCode("   ")).toBe(false);
  });

  it("keeps code that happens to be commented", () => {
    expect(hasRealCode("// adds a comment\nrouter.post('/x', handler);")).toBe(true);
    expect(hasRealCode("/** doc */\nconst f = () => 1;")).toBe(true);
  });
});
