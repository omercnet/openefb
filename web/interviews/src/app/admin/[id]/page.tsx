import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { loadInterview } from "@/lib/interviews";
import { mmss, toMarkdown } from "@/lib/markdown";

export const dynamic = "force-dynamic";

export default async function Detail({ params }: { params: Promise<{ id: string }> }) {
  if (!isAdmin((await headers()).get("authorization"))) return <main>Authentication required.</main>;
  const { id } = await params;
  const iv = await loadInterview(id);
  if (!iv) notFound();
  const p = iv.outcome?.profile;
  return (
    <main className="wide">
      <p>
        <Link href="/admin">← All interviews</Link>
      </p>
      <h1>Interview {iv.startedAt.slice(0, 16).replace("T", " ")} UTC</h1>
      <p className="muted">
        {iv.status} · {iv.durationSec != null ? `${Math.round(iv.durationSec / 60)} min` : "live"} · {iv.lang === "he" ? "Hebrew" : "English"} · consent v{iv.consentVersion} at {iv.consentAt} · {iv.model}
        {iv.noise && (
          <>
            <br />
            noise reduction: {iv.noise.reduction} (device: {iv.noise.device ?? "?"}) · turn detection: {iv.noise.turnDetection}
            {iv.noise.ambientDb != null && <> · ambient {iv.noise.ambientDb} dBFS</>}
            {iv.noise.mic && (
              <>
                {" "}
                · mic NS/EC/AGC: {String(iv.noise.mic.noiseSuppression)}/{String(iv.noise.mic.echoCancellation)}/{String(iv.noise.mic.autoGainControl)}
              </>
            )}
          </>
        )}
      </p>

      <div className="card">
        <b>Commitment:</b> {iv.outcome ? iv.outcome.commitment : "not recorded"}
        {iv.outcome?.email && (
          <>
            {" "}
            · <a href={`mailto:${iv.outcome.email}`}>{iv.outcome.email}</a>
          </>
        )}
        {iv.outcome?.note && <div className="muted">{iv.outcome.note}</div>}
        {p && (
          <div className="muted">
            {[p.certificate, p.hours_per_year && `${p.hours_per_year} h/yr`, p.aircraft, p.owner_or_rental, p.efb_used && `EFB: ${p.efb_used}`]
              .filter(Boolean)
              .join(" · ")}
          </div>
        )}
      </div>

      {iv.audio && (
        <>
          <h2>Audio</h2>
          <audio controls preload="none" src={`/api/admin/interviews/${iv.id}/audio`} />
        </>
      )}

      <h2>Notes (markdown, for docs/CUSTOMER.md)</h2>
      <p>
        <a className="btn" href={`/api/admin/interviews/${iv.id}/export`} target="_blank">
          Open .md
        </a>
      </p>
      <pre>{toMarkdown(iv)}</pre>

      <h2>Transcript</h2>
      {iv.transcript.length === 0 && <p className="muted">Empty.</p>}
      {iv.transcript.map((e, i) => (
        <div key={i} className={`turn ${e.role}`} dir={iv.lang === "he" ? "rtl" : "ltr"} lang={iv.lang ?? "en"}>
          <small dir="ltr">
            [{mmss(e.t)}] {e.role === "pilot" ? "Pilot" : "Interviewer"}
          </small>
          <div dir="auto">{e.text}</div>
        </div>
      ))}

      <h2>Delete</h2>
      <form method="post" action={`/api/admin/interviews/${iv.id}/delete`}>
        <button className="danger" type="submit">
          Delete this interview (transcript + audio)
        </button>
      </form>
    </main>
  );
}
