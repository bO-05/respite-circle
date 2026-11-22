// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { AskForm } from "@/components/ask-form";
import { ASK_SAMPLES } from "@/lib/ask-samples";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

const HERO_ASK =
  "I haven't had a Saturday morning to myself since March. Mum is fine with people she knows, she just can't be alone.\n\nShe loves hymns and tea.";

type FakeRecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
  started: boolean;
  stopped: boolean;
};

class FakeRecognition implements FakeRecognitionInstance {
  static instances: FakeRecognition[] = [];

  continuous = false;
  interimResults = false;
  lang = "";
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  started = false;
  stopped = false;

  constructor() {
    FakeRecognition.instances.push(this);
  }

  start() {
    this.started = true;
  }

  stop() {
    this.stopped = true;
    this.onend?.();
  }

  abort() {
    this.onend = null;
  }
}

function speechEvent(
  transcript: string,
  options: { final: boolean; resultIndex?: number; previousFinal?: string[] },
) {
  const results = [
    ...(options.previousFinal ?? []).map((text) => ({
      isFinal: true,
      length: 1,
      0: { transcript: text },
    })),
    { isFinal: options.final, length: 1, 0: { transcript } },
  ];
  return {
    resultIndex: options.resultIndex ?? results.length - 1,
    results,
  };
}

function jsonResponse(body: unknown, ok = true, status = 201) {
  return Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(body),
  });
}

const fetchMock = vi.fn();

beforeEach(() => {
  pushMock.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  FakeRecognition.instances = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  delete (window as unknown as { webkitSpeechRecognition?: unknown })
    .webkitSpeechRecognition;
});

describe("AskForm without dictation support", () => {
  it("offers the control, explains the browser, and still lets typing work", async () => {
    render(<AskForm coordinatorFirstName="Grace" />);

    await screen.findByText(/this browser can't dictate/i);
    expect(
      screen.getByRole("button", { name: /dictate/i }),
    ).toBeInTheDocument();

    const textarea = screen.getByLabelText(/tell us what a hard week looks like/i);
    fireEvent.change(textarea, { target: { value: HERO_ASK } });
    expect(textarea).toHaveValue(HERO_ASK);

    // Tapping dictation cannot throw and cannot make a request.
    fireEvent.click(screen.getByRole("button", { name: /dictate/i }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(textarea).toHaveValue(HERO_ASK);
  });
});

describe("AskForm dictation", () => {
  beforeEach(() => {
    Object.defineProperty(window, "SpeechRecognition", {
      configurable: true,
      writable: true,
      value: FakeRecognition,
    });
  });

  it("appends interim and final transcript to the box", async () => {
    render(<AskForm coordinatorFirstName="Grace" />);

    const dictate = await screen.findByRole("button", {
      name: /start dictating/i,
    });
    fireEvent.click(dictate);

    const recognition = FakeRecognition.instances[0];
    expect(recognition).toBeDefined();
    expect(recognition.started).toBe(true);
    expect(recognition.continuous).toBe(true);
    expect(recognition.interimResults).toBe(true);

    const textarea = screen.getByLabelText(/tell us what a hard week looks like/i);

    act(() => {
      recognition.onresult?.(speechEvent("Mum is fine", { final: false }));
    });
    expect(textarea).toHaveValue("Mum is fine");

    act(() => {
      recognition.onresult?.(speechEvent("Mum is fine", { final: true }));
    });
    expect(textarea).toHaveValue("Mum is fine");

    act(() => {
      recognition.onresult?.(
        speechEvent("with people she knows", {
          final: true,
          previousFinal: ["Mum is fine"],
        }),
      );
    });
    expect(textarea).toHaveValue("Mum is fine with people she knows");

    fireEvent.click(screen.getByRole("button", { name: /stop dictating/i }));
    expect(recognition.stopped).toBe(true);
    await screen.findByText(/dictation stopped/i);
    expect(textarea).toHaveValue("Mum is fine with people she knows");
  });

  it("keeps words the caregiver had already typed before dictating", async () => {
    render(<AskForm coordinatorFirstName="Grace" />);

    const textarea = screen.getByLabelText(/tell us what a hard week looks like/i);
    fireEvent.change(textarea, { target: { value: "A note first." } });

    fireEvent.click(await screen.findByRole("button", { name: /start dictating/i }));
    const recognition = FakeRecognition.instances[0];

    act(() => {
      recognition.onresult?.(
        speechEvent("Then spoken words.", { final: true }),
      );
    });
    expect(textarea).toHaveValue("A note first. Then spoken words.");

    fireEvent.click(screen.getByRole("button", { name: /stop dictating/i }));
    expect(textarea).toHaveValue("A note first. Then spoken words.");
  });

  it("survives a microphone refusal and leaves typing usable", async () => {
    render(<AskForm coordinatorFirstName="Grace" />);

    fireEvent.click(await screen.findByRole("button", { name: /start dictating/i }));
    const recognition = FakeRecognition.instances[0];

    act(() => {
      recognition.onerror?.({ error: "not-allowed" });
    });
    await screen.findByText(/blocking the microphone/i);

    const textarea = screen.getByLabelText(/tell us what a hard week looks like/i);
    fireEvent.change(textarea, { target: { value: "Typed instead." } });
    expect(textarea).toHaveValue("Typed instead.");
  });
});

describe("AskForm submission", () => {
  it("shows an associated error and creates nothing when the box is empty", async () => {
    render(<AskForm coordinatorFirstName="Grace" />);

    fireEvent.click(screen.getByRole("button", { name: /send this to/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/please write a few words/i);
    expect(fetchMock).not.toHaveBeenCalled();

    const textarea = screen.getByLabelText(/tell us what a hard week looks like/i);
    expect(textarea).toHaveAttribute("aria-invalid", "true");
    expect(textarea.getAttribute("aria-describedby")).toContain("ask-text-error");
    expect(textarea).toHaveFocus();
  });

  it("treats whitespace as empty and keeps the alert associated", async () => {
    render(<AskForm coordinatorFirstName="Grace" />);

    const textarea = screen.getByLabelText(/tell us what a hard week looks like/i);
    fireEvent.change(textarea, { target: { value: "  \n\t " } });
    fireEvent.click(screen.getByRole("button", { name: /send this to/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /please write a few words/i,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses to send without the consent line and says why", async () => {
    render(<AskForm coordinatorFirstName="Grace" />);

    fireEvent.change(
      screen.getByLabelText(/tell us what a hard week looks like/i),
      { target: { value: HERO_ASK } },
    );
    fireEvent.click(screen.getByRole("button", { name: /send this to/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /tick the box/i,
    );
    expect(fetchMock).not.toHaveBeenCalled();

    const consent = screen.getByLabelText(/i understand that Grace/i);
    expect(consent).toHaveFocus();
    expect(consent).toHaveAttribute("aria-invalid", "true");
  });

  it("sends the words exactly as written and opens the receipt", async () => {
    fetchMock.mockReturnValue(jsonResponse({ ok: true, askId: "ask-1" }));
    render(<AskForm coordinatorFirstName="Grace" />);

    fireEvent.change(
      screen.getByLabelText(/tell us what a hard week looks like/i),
      { target: { value: HERO_ASK } },
    );
    fireEvent.click(screen.getByLabelText(/i understand that Grace/i));
    fireEvent.click(screen.getByRole("button", { name: /send this to/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      { method: string; body: string },
    ];
    expect(url).toBe("/api/asks");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ text: HERO_ASK, consent: true });

    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith("/ask/ask-1"),
    );
  });

  it("shows the server's calm message and stays on the page when it refuses", async () => {
    fetchMock.mockReturnValue(
      jsonResponse(
        { ok: false, code: "no_policy", message: "Please call the church office." },
        false,
        503,
      ),
    );
    render(<AskForm coordinatorFirstName="Grace" />);

    fireEvent.change(
      screen.getByLabelText(/tell us what a hard week looks like/i),
      { target: { value: HERO_ASK } },
    );
    fireEvent.click(screen.getByLabelText(/i understand that Grace/i));
    fireEvent.click(screen.getByRole("button", { name: /send this to/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /please call the church office/i,
    );
    expect(pushMock).not.toHaveBeenCalled();
  });
});

describe("AskForm examples", () => {
  it("labels every example fictional and fills the box when one is chosen", async () => {
    render(<AskForm coordinatorFirstName="Grace" />);

    expect(
      screen.getByText(/these examples are fictional/i),
    ).toBeInTheDocument();

    const buttons = screen.getAllByRole("button", { name: /use the example/i });
    expect(buttons).toHaveLength(5);

    fireEvent.click(buttons[0]);
    expect(
      screen.getByLabelText(/tell us what a hard week looks like/i),
    ).toHaveValue(ASK_SAMPLES[0].body);
  });
});
