module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/__tests__/**/*.test.ts"],
  // the runner imports the app's own modules by relative path, and those are
  // outside this package's root
  roots: ["<rootDir>/src"],
};
