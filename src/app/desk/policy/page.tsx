import { RolePage } from "@/components/role-page";
import { DESK_ROLES } from "@/server/auth/policy";
import { requirePage } from "@/server/auth/guards";
import { getPolicyForCoordinator } from "@/server/repositories/policy";

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

/**
 * The coordinator's read-only copy of the church policy, including the crisis
 * script, the configurable local line, and the professional referrals. Those
 * three never appear on a volunteer or caregiver payload.
 */
export default async function DeskPolicyPage() {
  const { person, session } = await requirePage(DESK_ROLES);
  const current = await getPolicyForCoordinator(session);

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
            aria-labelledby="policy-version"
            className="rounded-lg border border-line bg-surface p-5"
          >
            <h2 id="policy-version" className="font-serif text-2xl text-ink">
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
                  .
                </>
              ) : (
                "Not signed yet — this draft is not in force."
              )}
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
                <dt className="font-semibold text-ink">Reminder window</dt>
                <dd>{current.reminderWindowHours} hours before a covered time</dd>
              </div>
              <div>
                <dt className="font-semibold text-ink">Call threshold</dt>
                <dd>
                  {current.callThresholdHours} hours before an open time starts
                </dd>
              </div>
            </dl>
          </section>

          <section
            aria-labelledby="policy-promises"
            className="rounded-lg border border-line bg-surface p-5"
          >
            <h2 id="policy-promises" className="font-serif text-2xl text-ink">
              Safeguarding promises
            </h2>
            <ol className="mt-3 flex list-decimal flex-col gap-3 pl-6">
              {current.safeguardingPromises.map((promise, index) => (
                <li
                  key={`${current.version}-${index}`}
                  className="max-w-prose text-base leading-relaxed text-ink"
                >
                  {promise}
                </li>
              ))}
            </ol>
          </section>

          <section
            aria-labelledby="policy-questions"
            className="rounded-lg border border-line bg-surface p-5"
          >
            <h2 id="policy-questions" className="font-serif text-2xl text-ink">
              The nine typed questions
            </h2>
            <ul className="mt-3 flex flex-col gap-3">
              {current.questionSet.map((question) => (
                <li
                  key={question.id}
                  className="max-w-prose text-base leading-relaxed text-ink"
                >
                  <p>
                    <span className="font-semibold">{question.id}</span>{" "}
                    {question.text}
                  </p>
                  <p className="text-ink-muted">
                    {question.answerType === "yesno"
                      ? "Yes or no"
                      : `Pick one: ${question.options?.join(" · ") ?? ""}`}
                    {question.samples
                      ? ` · ${question.samples} samples`
                      : null}
                  </p>
                </li>
              ))}
            </ul>
          </section>

          <section
            aria-labelledby="policy-crisis"
            data-testid="policy-crisis"
            className="rounded-lg border border-line bg-surface p-5"
          >
            <h2 id="policy-crisis" className="font-serif text-2xl text-ink">
              Crisis script and local line
            </h2>
            <p className="mt-2 max-w-prose text-base leading-relaxed text-ink">
              {current.crisisScript}
            </p>
            <p className="mt-3 max-w-prose text-base leading-relaxed text-ink">
              <span className="font-semibold">Local line: </span>
              {current.localCrisisLine ??
                "No local line is saved yet; 988 stands in."}
            </p>
          </section>

          <section
            aria-labelledby="policy-referrals"
            className="rounded-lg border border-line bg-surface p-5"
          >
            <h2 id="policy-referrals" className="font-serif text-2xl text-ink">
              Professional referrals
            </h2>
            <ul className="mt-3 flex flex-col gap-3">
              {current.referralResources.map((resource) => (
                <li
                  key={resource.name}
                  className="max-w-prose text-base leading-relaxed text-ink"
                >
                  <p className="font-semibold">{resource.name}</p>
                  <p className="text-ink-muted">{resource.detail}</p>
                  {resource.phone ? (
                    <p className="text-ink-muted">Phone: {resource.phone}</p>
                  ) : null}
                  {resource.url ? (
                    <p className="text-ink-muted">{resource.url}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>

          <section
            aria-labelledby="policy-versioned"
            className="rounded-lg border border-line bg-surface p-5"
          >
            <h2 id="policy-versioned" className="font-serif text-2xl text-ink">
              Versioned, never rewritten
            </h2>
            <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted">
              Saving an edit creates a new version. The promises a family was
              given stay exactly as they were. Publishing waits for a named
              person to sign it.
            </p>
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
