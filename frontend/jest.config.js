// only the pure logic under src/lib is tested here. the components need a
// react-native renderer, which is a much larger setup than these files justify.
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/src/lib/__tests__/**/*.test.ts"],
};
