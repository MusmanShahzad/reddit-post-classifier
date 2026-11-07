import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CollectionStatusPanel } from "@/components/organisms";
import { countdown } from "@/lib/schedule";

const NOW = new Date("2026-01-01T12:00:00Z");
const inMinutes = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

function panel(schedule: Partial<NonNullable<Parameters<typeof CollectionStatusPanel>[0]["schedule"]>>, isCollecting = false) {
  return render(
    <CollectionStatusPanel
      lastRun={null}
      isCollecting={isCollecting}
      onRunCollection={() => undefined}
      schedule={{ intervalMins: 30, nextRunAt: inMinutes(12), queued: false, autoCollectEnabled: true, scheduled: true, ...schedule }}
    />,
  );
}

describe("the next run on the dashboard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts down while the schedule is on", () => {
    panel({});
    expect(screen.getByTestId("next-run").textContent).toContain("Next run in 12:00");
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(screen.getByTestId("next-run").textContent).toContain("Next run in 11:55");
  });

  it("says the run is due once the time is up", () => {
    panel({ nextRunAt: inMinutes(-1) });
    expect(screen.getByTestId("next-run").textContent).toContain("is due");
  });

  it.each([
    ["automatic collection is off", { autoCollectEnabled: false, scheduled: false }, false, "Automatic collection is off"],
    ["the session is not on the schedule", { scheduled: false }, false, "not on the schedule"],
    ["a run is queued", { queued: true }, false, "waiting in the queue"],
  ])("shows no countdown when %s", (_name, schedule, collecting, note) => {
    panel(schedule, collecting);
    expect(screen.queryByTestId("next-run")).toBeNull();
    expect(screen.getByText(new RegExp(note))).toBeTruthy();
  });

  it("shows no countdown during a run", () => {
    panel({}, true);
    expect(screen.queryByTestId("next-run")).toBeNull();
  });
});

describe("countdown", () => {
  it("formats minutes and hours, and never goes below zero", () => {
    expect(countdown(65_000)).toBe("1:05");
    expect(countdown(3_900_000)).toBe("1h 05m");
    expect(countdown(-5_000)).toBe("0:00");
  });
});
