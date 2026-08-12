// ts-jest refuses typescript 7 as a peer and leans on the compiler api that
// TS7 removed, the same thing that broke ts-node. swc transpiles without
// touching that api, so the project stays on TS7.
module.exports = {
  testEnvironment: "node",
  transform: {
    "^.+\\.(t|j)sx?$": ["@swc/jest"],
  },
  testMatch: ["**/__tests__/**/*.test.ts"],
};
