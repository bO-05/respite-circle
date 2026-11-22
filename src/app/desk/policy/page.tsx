import { RolePage } from "@/components/role-page";
import { PolicyEditorForm } from "@/components/policy-editor-form";
import { DESK_ROLES } from "@/server/auth/policy";
import { requirePage } from "@/server/auth/guards";
import { POLICY_LOOSEN_CONFIRMATION } from "@/server/domain/policy";
import {
  POLICY_REFERRAL_ROWS_ON_SCREEN,
  type PolicyEditorReferral,
} from "@/server/domain/policy-editor";
import {
  getPolicyForCoordinator,
  listPolicyVersions,
} from "@/server/repositories/policy";

export const dynamic = "force-dynamic";

function formatDate(date: Date | null): string {
  if (!date) return "not yet";
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatInstant(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(date);
}

function blankReferral(): PolicyEditorReferral {
  return { name: "", detail: "", phone: "", url: "" };
}

/**
 * The coordinator's editable copy of the church policy.
 *
 * One page, one save path: every edit becomes a new immutable version with a
 * required named sign-off, the author's name in the audit trail, and the
 * instant it was saved. The fields this screen does not own (familiar-face
 * default, auto-publish, driver policy) are carried from the current version.
 *
 * Crisis and referral content stays on this desk page. It is rendered here for
 * the coordinator's request only, and it never appears on `/promises` or in a
 * volunteer's view.
 */
export default async function DeskPolicyPage() {
  const { person, session } = await requirePage(DESK_ROLES);
  const [current, versions] = await Promise.all([
    getPolicyForCoordinator(session),
    listPolicyVersions(session),
  ]);

  const inForce = versions.find((version) => version.inForce) ?? null;
  const nextVersion = current ? current.version + 1 : 1;

  const referralRows: PolicyEditorReferral[] = current
    ? [
        ...current.referralResources.map((resource) => ({
          name: resource.name,
          detail: resource.detail,
          phone: resource.phone ?? "",
          url: resource.url ?? "",
        })),
        ...Array.from(
          {
            length: Math.max(
              0,
              POLICY_REFERRAL_ROWS_ON_SCREEN -
                current.referralResources.length,
            ),
          },
          blankReferral,
        ),
      ]
    : [];

  return (
    <RolePage
      person={person}
      role={session.role}
      title="Church policy and promises"
      lead="Every published version keeps its author, its named sign-off, and the date it was saved."
    >
      {current ? (
        <>
          <section
            aria-labelledby="policy-current"
            className="rounded-lg border border-line bg-surface p-5"
          >
            <h2
              id="policy-current"
              data-testid="policy-current-version"
              className="font-serif text-2xl text-ink"
            >
              Version {current.version}
            </h2>
            <p
              className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted"
              data-testid="policy-signoff"
            >
              {current.signedOffBy ? (
                <>
                  Signed by {current.signedOffBy} on{" "}
                  <time dateTime={current.signedOffAt?.toISOString()}>
                    {formatDate(current.signedOffAt)}
                  </time>
                  .{" "}
                  {inForce?.version === current.version
                    ? "This is the version in force."
                    : "This version is signed, but a later version is not in force yet."}
                </>
              ) : (
                "Not signed yet. Publishing is blocked while unsigned, and the promises page keeps the last signed version."
              )}
            </p>
            <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted">
              {inForce
                ? `The promises page and every new ask use version ${inForce.version}, signed by ${inForce.signedOffBy} on ${formatDate(inForce.signedOffAt)}.`
                : "No version is signed yet, so the promises page publishes nothing and a new ask waits for a person."}
            </p>
            <dl className="mt-4 grid max-w-prose gap-2 text-base leading-relaxed text-ink-muted sm:grid-cols-2">
              <div>
                <dt className="font-semibold text-ink">Familiar face default</dt>
                <dd>{current.familiarFaceDefault ? "On" : "Off"}</dd>
              </div>
              <div>
                <dt className="font-semibold text-ink">Auto-publish low-risk</dt>
                <dd>
                  {current.autoPublishLowRisk
                    ? "On — meal and errand slots only"
                    : "Off"}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-ink">Volunteer drivers</dt>
                <dd>
                  {current.transportEnabled
                    ? "Driver policy signed"
                    : "Not signed — drive slots are blocked"}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-ink">Reminder window</dt>
                <dd>{current.reminderWindowHours} hours before a covered time</dd>
              </div>
              <div>
                <dt className="font-semibold text-ink">Call threshold</dt>
                <dd>
                  {current.callThresholdHours} hours before a time starts
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-ink">Call after</dt>
                <dd>
                  {current.callAfterOpenHours} hours on the board before a call
                </dd>
              </div>
            </dl>
          </section>

          <PolicyEditorForm nextVersion={nextVersion}>
            <section
              aria-labelledby="editor-promises"
              className="flex flex-col gap-4"
            >
              <div>
                <h3
                  id="editor-promises"
                  className="font-serif text-xl text-ink"
                >
                  Safeguarding promises
                </h3>
                <p className="mt-1 max-w-prose text-base leading-relaxed text-ink-muted">
                  These are the sentences a family reads on the promises page.
                  Clearing one removes it from the next version; at least one is
                  required.
                </p>
              </div>
              {current.safeguardingPromises.map((promise, index) => {
                const fieldId = `policy-promise-${index}`;
                return (
                  <div key={fieldId} className="flex flex-col gap-1">
                    <label
                      htmlFor={fieldId}
                      className="text-base font-semibold text-ink"
                    >
                      Promise {index + 1}
                    </label>
                    <textarea
                      id={fieldId}
                      name="promise"
                      defaultValue={promise}
                      rows={3}
                      className="w-full max-w-prose rounded-md border border-line bg-paper px-3 py-2 text-base leading-relaxed text-ink"
                    />
                  </div>
                );
              })}
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="policy-promise-new"
                  className="text-base font-semibold text-ink"
                >
                  Add a promise (optional)
                </label>
                <textarea
                  id="policy-promise-new"
                  name="promise"
                  defaultValue=""
                  rows={2}
                  className="w-full max-w-prose rounded-md border border-line bg-paper px-3 py-2 text-base leading-relaxed text-ink"
                />
              </div>
            </section>

            <section
              aria-labelledby="editor-questions"
              className="flex flex-col gap-4"
            >
              <div>
                <h3
                  id="editor-questions"
                  className="font-serif text-xl text-ink"
                >
                  The nine typed questions
                </h3>
                <p className="mt-1 max-w-prose text-base leading-relaxed text-ink-muted">
                  The wording is yours. The id, the answer type, the pick
                  options, and the safety sampling stay fixed.
                </p>
              </div>
              {current.questionSet.map((question) => {
                const fieldId = `policy-question-${question.id}`;
                return (
                  <div key={question.id} className="flex flex-col gap-1">
                    <label
                      htmlFor={fieldId}
                      className="text-base font-semibold text-ink"
                    >
                      Question {question.id} text
                    </label>
                    <textarea
                      id={fieldId}
                      name={`question.${question.id}`}
                      defaultValue={question.text}
                      rows={3}
                      className="w-full max-w-prose rounded-md border border-line bg-paper px-3 py-2 text-base leading-relaxed text-ink"
                    />
                    <p className="max-w-prose text-sm leading-relaxed text-ink-muted">
                      {question.answerType === "yesno"
                        ? "Yes or no"
                        : `Pick one: ${question.options?.join(" · ") ?? ""}`}
                      {question.samples ? ` · ${question.samples} samples` : null}
                    </p>
                  </div>
                );
              })}
            </section>

            <section
              aria-labelledby="editor-crisis"
              className="flex flex-col gap-4"
            >
              <div>
                <h3 id="editor-crisis" className="font-serif text-xl text-ink">
                  Crisis script and local line
                </h3>
                <p className="mt-1 max-w-prose text-base leading-relaxed text-ink-muted">
                  This stays on the desk and on a safety hold card. It never
                  appears on the promises page or a volunteer&apos;s screen.
                </p>
              </div>
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="policy-crisis-script"
                  className="text-base font-semibold text-ink"
                >
                  Crisis script
                </label>
                <textarea
                  id="policy-crisis-script"
                  name="crisisScript"
                  defaultValue={current.crisisScript}
                  rows={6}
                  className="w-full max-w-prose rounded-md border border-line bg-paper px-3 py-2 text-base leading-relaxed text-ink"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="policy-local-line"
                  className="text-base font-semibold text-ink"
                >
                  Local crisis line
                </label>
                <input
                  id="policy-local-line"
                  name="localCrisisLine"
                  type="text"
                  defaultValue={current.localCrisisLine ?? ""}
                  className="min-h-11 w-full max-w-prose rounded-md border border-line bg-paper px-3 py-2 text-base text-ink"
                />
                <p className="max-w-prose text-sm leading-relaxed text-ink-muted">
                  The church&apos;s own line and the hours a person answers it.
                  Leave blank if 988 is the only line this church prints.
                </p>
              </div>
            </section>

            <section
              aria-labelledby="editor-referrals"
              className="flex flex-col gap-4"
            >
              <div>
                <h3
                  id="editor-referrals"
                  className="font-serif text-xl text-ink"
                >
                  Professional referrals
                </h3>
                <p className="mt-1 max-w-prose text-base leading-relaxed text-ink-muted">
                  A pain, a lift, or a medication question goes to a person with
                  a professional referral, never to a volunteer slot. A row with
                  no words is ignored; at least one referral is required.
                </p>
              </div>
              {referralRows.map((resource, index) => (
                <fieldset
                  key={`policy-referral-${index}`}
                  className="rounded-md border border-line bg-paper px-4 py-3"
                >
                  <legend className="px-1 text-base font-semibold text-ink">
                    Referral {index + 1}
                  </legend>
                  <div className="mt-2 grid gap-3">
                    <div className="flex flex-col gap-1">
                      <label
                        htmlFor={`policy-referral-${index}-name`}
                        className="text-base text-ink"
                      >
                        Referral {index + 1} name
                      </label>
                      <input
                        id={`policy-referral-${index}-name`}
                        name="referralName"
                        type="text"
                        defaultValue={resource.name}
                        className="min-h-11 w-full max-w-prose rounded-md border border-line bg-surface px-3 py-2 text-base text-ink"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label
                        htmlFor={`policy-referral-${index}-detail`}
                        className="text-base text-ink"
                      >
                        Referral {index + 1} detail
                      </label>
                      <textarea
                        id={`policy-referral-${index}-detail`}
                        name="referralDetail"
                        defaultValue={resource.detail}
                        rows={2}
                        className="w-full max-w-prose rounded-md border border-line bg-surface px-3 py-2 text-base leading-relaxed text-ink"
                      />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="flex flex-col gap-1">
                        <label
                          htmlFor={`policy-referral-${index}-phone`}
                          className="text-base text-ink"
                        >
                          Referral {index + 1} phone
                        </label>
                        <input
                          id={`policy-referral-${index}-phone`}
                          name="referralPhone"
                          type="text"
                          defaultValue={resource.phone}
                          className="min-h-11 w-full rounded-md border border-line bg-surface px-3 py-2 text-base text-ink"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label
                          htmlFor={`policy-referral-${index}-url`}
                          className="text-base text-ink"
                        >
                          Referral {index + 1} web address
                        </label>
                        <input
                          id={`policy-referral-${index}-url`}
                          name="referralUrl"
                          type="text"
                          defaultValue={resource.url}
                          className="min-h-11 w-full rounded-md border border-line bg-surface px-3 py-2 text-base text-ink"
                        />
                      </div>
                    </div>
                  </div>
                </fieldset>
              ))}
            </section>

            <section
              aria-labelledby="editor-clocks"
              className="flex flex-col gap-4"
            >
              <div>
                <h3 id="editor-clocks" className="font-serif text-xl text-ink">
                  The two safeguarding clocks
                </h3>
                <p className="mt-1 max-w-prose text-base leading-relaxed text-ink-muted">
                  The earlier clock wins. Both are policy content, so changing
                  either one is a new signed version.
                </p>
              </div>

              <div className="flex flex-col gap-1">
                <label
                  htmlFor="policy-reminder-window"
                  className="text-base font-semibold text-ink"
                >
                  Reminder window (hours)
                </label>
                <input
                  id="policy-reminder-window"
                  name="reminderWindowHours"
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  defaultValue={current.reminderWindowHours}
                  className="min-h-11 w-32 rounded-md border border-line bg-paper px-3 py-2 text-base text-ink"
                />
                <p className="max-w-prose text-sm leading-relaxed text-ink-muted">
                  One reminder may be written this many hours before a covered
                  time.
                </p>
              </div>

              <div className="flex flex-col gap-1">
                <label
                  htmlFor="policy-call-threshold"
                  className="text-base font-semibold text-ink"
                >
                  Call threshold — hours before the time starts
                </label>
                <input
                  id="policy-call-threshold"
                  name="callThresholdHours"
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  defaultValue={current.callThresholdHours}
                  className="min-h-11 w-32 rounded-md border border-line bg-paper px-3 py-2 text-base text-ink"
                />
                <p className="max-w-prose text-sm leading-relaxed text-ink-muted">
                  The coverage watch begins this many hours before a time
                  starts. A bigger number means the church sees it earlier; a
                  smaller number means later.
                </p>
              </div>

              <div className="flex flex-col gap-1">
                <label
                  htmlFor="policy-call-after"
                  className="text-base font-semibold text-ink"
                >
                  Call after — hours after it was posted
                </label>
                <input
                  id="policy-call-after"
                  name="callAfterOpenHours"
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  defaultValue={current.callAfterOpenHours}
                  className="min-h-11 w-32 rounded-md border border-line bg-paper px-3 py-2 text-base text-ink"
                />
                <p className="max-w-prose text-sm leading-relaxed text-ink-muted">
                  If a time is still untaken this many hours after it was
                  posted, a person picks up the phone. A bigger number means a
                  later call.
                </p>
              </div>

              <div className="flex flex-col gap-1 rounded-md border border-amber bg-amber-soft px-4 py-3">
                <label
                  htmlFor="policy-loosen-confirmation"
                  className="text-base font-semibold text-ink"
                >
                  Typed confirmation for a loosening
                </label>
                <input
                  id="policy-loosen-confirmation"
                  name="loosenConfirmation"
                  type="text"
                  autoComplete="off"
                  aria-describedby="policy-loosen-help"
                  className="min-h-11 w-full max-w-xs rounded-md border border-line bg-paper px-3 py-2 text-base text-ink"
                />
                <p
                  id="policy-loosen-help"
                  className="max-w-prose text-sm leading-relaxed text-ink"
                >
                  If either clock gives the church less notice — a smaller
                  first number, or a larger second number — type{" "}
                  <strong>{POLICY_LOOSEN_CONFIRMATION}</strong> here. The save
                  is refused without it and is flagged in the audit log.
                </p>
              </div>
            </section>

            <section
              aria-labelledby="editor-signoff"
              className="flex flex-col gap-2 rounded-md border border-line bg-paper px-4 py-3"
            >
              <h3 id="editor-signoff" className="font-serif text-xl text-ink">
                Sign-off
              </h3>
              <label
                htmlFor="policy-signed-off-by"
                className="text-base font-semibold text-ink"
              >
                Your name, as the sign-off for this version
              </label>
              <input
                id="policy-signed-off-by"
                name="signedOffBy"
                type="text"
                defaultValue=""
                autoComplete="name"
                aria-required="true"
                aria-describedby="policy-signoff-help"
                className="min-h-11 w-full max-w-prose rounded-md border border-line bg-surface px-3 py-2 text-base text-ink"
              />
              <p
                id="policy-signoff-help"
                className="max-w-prose text-sm leading-relaxed text-ink-muted"
              >
                A named person signs every version. Leaving this blank is
                refused and saves nothing: publishing is blocked while unsigned.
                The version is saved with your name and the date and time.
              </p>
            </section>
          </PolicyEditorForm>

          <section
            aria-labelledby="policy-history"
            className="rounded-lg border border-line bg-surface p-5"
          >
            <h2 id="policy-history" className="font-serif text-2xl text-ink">
              Version history
            </h2>
            <p className="mt-1 max-w-prose text-base leading-relaxed text-ink-muted">
              Newest first. Rows are never rewritten; a save adds one.
            </p>
            <div className="mt-3 overflow-x-auto">
              <table
                data-testid="policy-history"
                className="w-full max-w-prose border-collapse text-base"
              >
                <caption className="sr-only">
                  Saved policy versions, newest first
                </caption>
                <thead>
                  <tr className="border-b border-line text-left">
                    <th scope="col" className="py-2 pr-3 font-semibold">
                      Version
                    </th>
                    <th scope="col" className="py-2 pr-3 font-semibold">
                      Signed by
                    </th>
                    <th scope="col" className="py-2 pr-3 font-semibold">
                      Saved
                    </th>
                    <th scope="col" className="py-2 font-semibold">
                      Clocks
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {versions.map((version) => (
                    <tr
                      key={version.id}
                      data-version={version.version}
                      className="border-b border-line align-top"
                    >
                      <th scope="row" className="py-2 pr-3 font-semibold">
                        {version.version}
                        {version.inForce ? (
                          <span className="block text-sm font-normal text-green">
                            In force
                          </span>
                        ) : null}
                      </th>
                      <td className="py-2 pr-3">
                        {version.signedOffBy ?? "Unsigned draft"}
                      </td>
                      <td className="py-2 pr-3">
                        <time dateTime={version.createdAt.toISOString()}>
                          {formatInstant(version.createdAt)}
                        </time>
                      </td>
                      <td className="py-2">
                        {version.callThresholdHours}h before ·{" "}
                        {version.callAfterOpenHours}h on the board
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <section
          aria-labelledby="policy-empty"
          className="rounded-lg border border-line bg-surface p-5"
        >
          <h2 id="policy-empty" className="font-serif text-2xl text-ink">
            No policy version is saved yet
          </h2>
          <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted">
            Seed the demo church, or save a first version with a named
            sign-off. Nothing is published until a person signs it.
          </p>
        </section>
      )}
    </RolePage>
  );
}
