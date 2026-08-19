import { TestCase, ApiResponse } from "../types";

function getNestedValue(obj: any, path: string): any {
  // handles paths like "status", "data.user.email", "data.token"
  const parts = path.split(".");
  let current = obj;
  for (const part of parts) {
    if (current === undefined || current === null) return undefined;
    current = current[part];
  }
  return current;
}

// What a field name points at. Exported because a failing assertion has to be
// able to say what it saw, and a second reading of "data.user.email" written
// somewhere else would agree with this one right up until it did not.
export function actualFor(response: ApiResponse, field: string): any {
  return getNestedValue(
    {
      status: response.status,
      statusText: response.statusText,
      timing: response.timing.total,
      ttfb: response.timing.ttfb,
      size: response.size,
      data: response.data,
    },
    field
  );
}

// shared so the Tests panel and the automatic run after a request cannot
// disagree about what passing means
export function runAssertions(
  tests: TestCase[],
  response: ApiResponse | null
): TestCase[] {
  if (!response) return tests;

  return tests.map((test) => {
    const actual = actualFor(response, test.field);
    let passed = false;

    switch (test.operator) {
      case "equals":
        passed = String(actual) === test.value;
        break;
      case "not equals":
        passed = String(actual) !== test.value;
        break;
      case "contains":
        passed = String(actual).includes(test.value);
        break;
      case "exists":
        passed = actual !== undefined && actual !== null;
        break;
      case "greater than":
        passed = Number(actual) > Number(test.value);
        break;
      case "less than":
        passed = Number(actual) < Number(test.value);
        break;
    }

    return { ...test, passed };
  });
}
