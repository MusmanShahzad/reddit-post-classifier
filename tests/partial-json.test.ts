import { describe, expect, it } from "vitest";
import { partialStringField } from "@/lib/partial-json";

describe("partialStringField", () => {
  it("is null before the field starts", () => {
    expect(partialStringField('{"conver', "conversationalReply")).toBeNull();
  });

  it("returns the text so far while the string is still open", () => {
    expect(partialStringField('{"conversationalReply": "Hi! Tell me', "conversationalReply")).toBe("Hi! Tell me");
  });

  it("stops at the closing quote and ignores later fields", () => {
    const raw = '{"conversationalReply":"Done.","needsClarification":true}';
    expect(partialStringField(raw, "conversationalReply")).toBe("Done.");
  });

  it("decodes escapes and holds back one cut in half", () => {
    expect(partialStringField('{"conversationalReply":"Line one\\nLine \\"two\\"', "conversationalReply")).toBe(
      'Line one\nLine "two"',
    );
    expect(partialStringField('{"conversationalReply":"Wait\\', "conversationalReply")).toBe("Wait");
    expect(partialStringField('{"conversationalReply":"caf\\u00e', "conversationalReply")).toBe("caf");
    expect(partialStringField('{"conversationalReply":"caf\\u00e9"', "conversationalReply")).toBe("café");
  });

  it("grows as more of the stream arrives", () => {
    const full = '{"conversationalReply":"What do you sell?","config":null}';
    const seen = [10, 30, 40, full.length].map((n) => partialStringField(full.slice(0, n), "conversationalReply"));
    expect(seen).toEqual([null, "What d", "What do you sell", "What do you sell?"]);
  });
});
