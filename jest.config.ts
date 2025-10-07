export default {
    collectCoverage: true,
    coverageDirectory: "coverage",
    coverageProvider: "v8",
    preset: 'ts-jest',
    roots: [ "src/" ],
    testMatch: ["**/*.test.ts"],
    watchman: false,
};
