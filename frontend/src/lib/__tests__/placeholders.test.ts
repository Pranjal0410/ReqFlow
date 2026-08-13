import { placeholderFields } from "../placeholders";

// the scan fills a body with values that pass, and falls back to the type name
// only for something it has no way to guess
describe("placeholderFields", () => {
  it("finds fields still standing in for a type", () => {
    expect(placeholderFields('{"title":"string","count":"number"}')).toEqual(["title", "count"]);
  });

  it("says nothing about real values", () => {
    expect(placeholderFields('{"title":"Database timeout","severity":"critical","count":3}')).toEqual([]);
  });

  it("looks inside nested objects", () => {
    expect(placeholderFields('{"user":{"email":"string","name":"Ada"}}')).toEqual(["user.email"]);
  });

  it("is not fooled by a sentence that mentions a type", () => {
    expect(placeholderFields('{"note":"the string was truncated"}')).toEqual([]);
  });

  it("ignores a body that is not json yet", () => {
    expect(placeholderFields('{ half typed')).toEqual([]);
    expect(placeholderFields("")).toEqual([]);
  });
});
