"""Platform-independent drag lifecycle and physical-pixel edge geometry."""

from dataclasses import dataclass


def new_tab_url(browser: str) -> str:
    return {"chrome": "chrome://newtab/", "msedge": "edge://newtab/",
            "brave": "brave://newtab/"}[browser]


def is_new_tab_url(value: str) -> bool:
    # The rendered document can use Chromium's internal new-tab-page alias.
    return value.strip().lower().rstrip("/") in {
        f"{scheme}://{page}" for scheme in ("chrome", "edge", "brave")
        for page in ("newtab", "new-tab-page", "new-tab-page-third-party")}


def normalize_url(value: str, browser: str) -> str:
    value = value.strip()
    if not value:
        return ""
    if any(character.isspace() for character in value):
        return ""
    if is_new_tab_url(value):
        return new_tab_url(browser)
    # Chromium internal pages must retain their browser-specific scheme.
    if "://" in value or value.startswith(("about:", "file:")):
        return value
    if "." in value.split("/")[0] or value.startswith("localhost"):
        return "https://" + value
    return ""


@dataclass(frozen=True)
class Sample:
    hwnd: int
    browser_window: bool
    rect: tuple[int, int, int, int]
    cursor: tuple[int, int]
    pressed: bool
    time: float
    class_name: str = ""


class FileDragTracker:
    """The planned Explorer/button/100-pixel heuristic; no OLE drop capture."""

    def __init__(self):
        self.edge = None

    def update(self, sample: Sample, screen: tuple[int, int], active: set[str]):
        width, height = screen
        x, y = sample.cursor
        distances = {"LEFT": abs(x), "RIGHT": abs(width - 1 - x),
                     "TOP": abs(y), "BOTTOM": abs(height - 1 - y)}
        candidates = [edge for edge in distances if edge in active and distances[edge] <= 100]
        edge = (min(candidates, key=distances.get) if sample.pressed and
                sample.class_name in ("CabinetWClass", "Progman", "WorkerW") and candidates else None)
        events = []
        if edge != self.edge:
            if self.edge is not None:
                events.append({"type": "LOCAL_FILE_DRAG", "active": False, "edge": self.edge})
            if edge is not None:
                events.append({"type": "LOCAL_FILE_DRAG", "active": True, "edge": edge})
        self.edge = edge
        return events


def geometry(sample: Sample, screen: tuple[int, int], active: set[str]) -> dict:
    """At corners choose the closest active edge; cursor proximity wins."""
    width, height = screen
    left, top, right, bottom = sample.rect
    x, y = sample.cursor
    cursor_distances = {"LEFT": abs(x), "RIGHT": abs(width - 1 - x),
                        "TOP": abs(y), "BOTTOM": abs(height - 1 - y)}
    window_distances = {"LEFT": max(0, left), "RIGHT": max(0, width - right),
                        "TOP": max(0, top), "BOTTOM": max(0, height - bottom)}
    candidates = [edge for edge in cursor_distances if edge in active and
                  min(cursor_distances[edge], window_distances[edge]) <= 120]
    edge = min(candidates, key=lambda e: (cursor_distances[e] > 120,
               min(cursor_distances[e], window_distances[e]), cursor_distances[e])) if candidates else None
    protrusions = {"LEFT": -left, "RIGHT": right - width,
                   "TOP": -top, "BOTTOM": bottom - height}
    vertical = edge in ("LEFT", "RIGHT")
    ratio = ((top + bottom) / (2 * height) if vertical else
             (left + right) / (2 * width))
    return {"hwnd": sample.hwnd, "edge": edge,
            "protrusionPx": max(0, protrusions.get(edge, 0)),
            "centerRatio": max(0.0, min(1.0, ratio)),
            "width": right - left, "height": bottom - top,
            "cursorX": x, "cursorY": y,
            "cursorAtEdge": edge is not None and cursor_distances[edge] <= 4}


class DragTracker:
    """One qualification per physical drag; stale worker results are discarded."""

    def __init__(self):
        self.previous = None
        self.hwnd = None
        self.generation = 0
        self.started = False

    def reset(self):
        self.previous = None
        self.hwnd = None
        self.started = False
        self.generation += 1

    def update(self, sample: Sample, screen: tuple[int, int], active: set[str]):
        events = []
        request = None
        previous = self.previous
        if self.hwnd is not None and (not sample.pressed or sample.hwnd != self.hwnd):
            if self.started:
                # Focus loss cancels even if the button was released between
                # polls; the previous cursor position cannot authorize a commit.
                same_window = sample.hwnd == self.hwnd
                end_sample = sample if same_window else previous
                fields = geometry(end_sample, screen, active)
                if same_window:
                    # END has no placement fields in the shared contract.
                    # Publish the release sample's geometry immediately before it.
                    events.append({"type": "LOCAL_DRAG_MOVE", **fields})
                elapsed = max(sample.time - previous.time, 0.001)
                velocity = ((sample.cursor[0] - previous.cursor[0]) ** 2 +
                            (sample.cursor[1] - previous.cursor[1]) ** 2) ** 0.5 / elapsed
                events.append({"type": "LOCAL_DRAG_END", "hwnd": self.hwnd,
                               "edge": fields["edge"],
                               "cursorAtEdge": same_window and fields["cursorAtEdge"] and not sample.pressed,
                               "velocity": velocity})
            self.reset()
        if (self.hwnd is None and previous and sample.pressed and previous.pressed
                and sample.browser_window and sample.hwnd == previous.hwnd
                and sample.rect != previous.rect):
            self.hwnd = sample.hwnd
            self.generation += 1
            request = (self.generation, sample.hwnd)
        if self.started:
            events.append({"type": "LOCAL_DRAG_MOVE", **geometry(sample, screen, active)})
        self.previous = sample
        return events, request

    def qualify(self, generation: int, info: dict):
        if (generation != self.generation or self.hwnd != info.get("hwnd")
                or type(info.get("tabCount")) is not int or info["tabCount"] < 1
                or not info.get("url")):
            return None
        self.started = True
        return {"type": "LOCAL_DRAG_START", **info}
