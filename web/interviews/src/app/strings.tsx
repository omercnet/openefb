import type { ReactNode } from "react";
import type { Lang } from "@/lib/lang";

/**
 * UI copy per language. Names, emails and codes go through <bdi> so a Latin string inside Hebrew text (or the other way
 * round) keeps its own direction and doesn't reorder the neighbouring punctuation.
 */
export interface Ctx {
  interviewer: string;
  contactEmail: string;
  maxMinutes: number;
}

export interface Strings {
  pageTitle: string;
  intro: (c: Ctx) => ReactNode;
  readFirst: string;
  rules: ((c: Ctx) => ReactNode)[];
  agree: string;
  start: string;
  micNote: string;
  langLabel: string;
  deviceLabel: string;
  deviceNear: string;
  deviceFar: string;
  noiseCheck: string;
  noiseChecking: string;
  noiseQuiet: (db: number) => string;
  noiseLoud: (db: number) => string;
  noiseSilent: string;
  connecting: string;
  muted: string;
  listening: string;
  hearing: string;
  thinking: string;
  speaking: string;
  mute: string;
  unmute: string;
  end: string;
  saving: string;
  keepOpen: string;
  thanks: string;
  ended: string;
  dropped: string;
  capped: string;
  saved: string;
  deleteTo: (email: ReactNode) => ReactNode;
  deleteNoEmail: string;
  errMicBlocked: string;
  errMicNone: string;
  errMicOther: string;
  errConsent: string;
  errLink: string;
  errLimit: string;
  errBusy: string;
  errGeneric: string;
}

const B = ({ children }: { children: ReactNode }) => <bdi>{children}</bdi>;

const en: Strings = {
  pageTitle: "A 20-minute chat about flying with your iPad",
  intro: (c) => (
    <>
      For VFR pilots. No sales pitch: <B>{c.interviewer}</B> just wants to hear about your last few flights.
    </>
  ),
  readFirst: "Before we start, please read this",
  rules: [
    (c) => (
      <>
        <b>Who&apos;s asking:</b> <B>{c.interviewer}</B>. You&apos;ll talk with an <b>AI voice interviewer</b> (not a person), running on OpenAI&apos;s speech technology, so your voice is processed by OpenAI.
      </>
    ),
    () => (
      <>
        <b>What&apos;s recorded:</b> the conversation is <b>audio-recorded and transcribed</b>. If you choose to share an email at the end, that is stored too.
      </>
    ),
    (c) => (
      <>
        <b>How it&apos;s used:</b> to study how pilots use iPads in the cockpit. Only <B>{c.interviewer}</B> can see it. Short quotes may be used in notes without your name.
      </>
    ),
    (c) => (
      <>
        <b>Delete or stop:</b> you can end any time with the End button. To have your interview deleted, email{" "}
        {c.contactEmail ? <a href={`mailto:${c.contactEmail}`}>{c.contactEmail}</a> : "the person who sent you this link"}.
      </>
    ),
    (c) => <>Takes about 20 minutes (stops at {c.maxMinutes}). Please don&apos;t do this while flying. Headphones and a quiet spot help.</>,
  ],
  agree: "I'm 18 or older, and I agree to be recorded and transcribed as described above.",
  start: "Start interview",
  micNote: "Your browser will ask to use the microphone. Nothing is recorded until you tap Start.",
  langLabel: "Language",
  deviceLabel: "Where is your microphone?",
  deviceNear: "Headphones, or phone held near my face",
  deviceFar: "Laptop or iPad on a table",
  noiseCheck: "Check background noise (3 s)",
  noiseChecking: "Listening to the room for 3 seconds. Stay quiet.",
  noiseQuiet: (db) => `Background noise is low (${db} dBFS). Good to go.`,
  noiseLoud: (db) => `It's noisy here (${db} dBFS). Headphones with a mic, or a quieter spot, will give a much better interview. You can still start.`,
  noiseSilent: "We couldn't hear any signal. Check that the right microphone is selected and not muted.",
  connecting: "Connecting…",
  muted: "Muted",
  listening: "Listening",
  hearing: "Hearing you",
  thinking: "Thinking",
  speaking: "Interviewer speaking",
  mute: "Mute",
  unmute: "Unmute",
  end: "End interview",
  saving: "Saving your interview…",
  keepOpen: "Please keep this page open for a moment.",
  thanks: "Thank you!",
  ended: "Interview ended",
  dropped: "The connection dropped. What we captured so far has been saved, so you don't need to do anything.",
  capped: "We reached the time limit. What we captured has been saved.",
  saved: "Your interview has been saved. You can close this page.",
  deleteTo: (email) => <>To have it deleted, email {email}.</>,
  deleteNoEmail: "the person who sent you this link",
  errMicBlocked:
    "Microphone access was blocked. Allow the microphone for this site (on iPhone: the aA menu in Safari > Website Settings > Microphone, or Settings > Safari > Microphone), then tap Start again.",
  errMicNone: "No microphone was found on this device.",
  errMicOther: "Couldn't open the microphone. Check that no other app is using it, then try again.",
  errConsent: "Consent is required before the interview can start.",
  errLink: "This interview link is not valid.",
  errLimit: "The interview limit for today has been reached. Please try again tomorrow.",
  errBusy: "Could not start the voice session. Please try again in a minute.",
  errGeneric: "Could not start the interview.",
};

// he: numbers with a minus sign are wrapped in LRI/PDI (U+2066/U+2069) so "-62 dBFS" isn't reordered inside RTL text
const he: Strings = {
  pageTitle: "שיחה של 20 דקות על טיסה עם ה-iPad",
  intro: (c) => (
    <>
      לטייסי VFR. בלי מכירות: <B>{c.interviewer}</B> פשוט רוצה לשמוע על הטיסות האחרונות שלכם.
    </>
  ),
  readFirst: "לפני שמתחילים, בבקשה לקרוא את זה",
  rules: [
    (c) => (
      <>
        <b>מי שואל:</b> <B>{c.interviewer}</B>. השיחה היא עם <b>מראיין קולי מבוסס בינה מלאכותית</b> (לא בן אדם), שרץ על טכנולוגיית הדיבור של <B>OpenAI</B>, ולכן הקול מעובד אצל OpenAI.
      </>
    ),
    () => (
      <>
        <b>מה מוקלט:</b> השיחה <b>מוקלטת ומתומללת</b>. אם משאירים אימייל בסוף, גם הוא נשמר.
      </>
    ),
    (c) => (
      <>
        <b>למה זה משמש:</b> כדי ללמוד איך טייסים משתמשים ב-iPad בקוקפיט. רק <B>{c.interviewer}</B> רואה את זה. ציטוטים קצרים עשויים להופיע בסיכומים בלי שם.
      </>
    ),
    (c) => (
      <>
        <b>למחוק או לעצור:</b> אפשר לסיים בכל רגע עם כפתור הסיום. כדי למחוק את הראיון, יש לשלוח אימייל ל-
        {c.contactEmail ? <a href={`mailto:${c.contactEmail}`} dir="ltr">{c.contactEmail}</a> : "מי ששלח את הקישור"}.
      </>
    ),
    (c) => <>לוקח בערך 20 דקות (נעצר אחרי {c.maxMinutes}). בבקשה לא לעשות את זה תוך כדי טיסה. אוזניות ומקום שקט עוזרים.</>,
  ],
  agree: "גיל 18 ומעלה, והסכמה לשימוש בהקלטה ובתמלול של השיחה כמתואר למעלה.",
  start: "להתחיל ראיון",
  micNote: "הדפדפן יבקש גישה למיקרופון. שום דבר לא מוקלט עד הלחיצה על \"להתחיל ראיון\".",
  langLabel: "שפה",
  deviceLabel: "איפה המיקרופון?",
  deviceNear: "אוזניות, או טלפון צמוד לפנים",
  deviceFar: "לפטופ או iPad על שולחן",
  noiseCheck: "בדיקת רעשי רקע (3 שניות)",
  noiseChecking: "מקשיב לחדר במשך 3 שניות. נא לא לדבר.",
  noiseQuiet: (db) => `רעש הרקע נמוך (\u2066${db} dBFS\u2069). אפשר להתחיל.`,
  noiseLoud: (db) => `רועש כאן (\u2066${db} dBFS\u2069). אוזניות עם מיקרופון, או מקום שקט יותר, ישפרו מאוד את הראיון. אפשר להתחיל בכל זאת.`,
  noiseSilent: "לא שמענו שום אות. כדאי לבדוק שנבחר המיקרופון הנכון ושהוא לא מושתק.",
  connecting: "מתחבר…",
  muted: "מושתק",
  listening: "מקשיב",
  hearing: "שומע אתכם",
  thinking: "חושב",
  speaking: "המראיין מדבר",
  mute: "להשתיק",
  unmute: "לבטל השתקה",
  end: "לסיים ראיון",
  saving: "שומר את הראיון…",
  keepOpen: "בבקשה להשאיר את הדף פתוח עוד רגע.",
  thanks: "תודה!",
  ended: "הראיון הסתיים",
  dropped: "החיבור נפל. מה שנקלט עד עכשיו נשמר, אז אין צורך לעשות כלום.",
  capped: "הגענו למגבלת הזמן. מה שנקלט נשמר.",
  saved: "הראיון נשמר. אפשר לסגור את הדף.",
  deleteTo: (email) => <>כדי למחוק אותו, יש לשלוח אימייל ל-{email}.</>,
  deleteNoEmail: "מי ששלח את הקישור",
  errMicBlocked:
    "הגישה למיקרופון נחסמה. יש לאפשר את המיקרופון לאתר הזה (באייפון: תפריט aA ב-Safari > הגדרות אתר > מיקרופון, או הגדרות > Safari > מיקרופון), ואז ללחוץ שוב על \"להתחיל ראיון\".",
  errMicNone: "לא נמצא מיקרופון במכשיר הזה.",
  errMicOther: "לא הצלחנו לפתוח את המיקרופון. כדאי לבדוק שאף אפליקציה אחרת לא משתמשת בו ולנסות שוב.",
  errConsent: "צריך הסכמה לפני שאפשר להתחיל את הראיון.",
  errLink: "קישור הראיון הזה לא תקין.",
  errLimit: "הגענו למגבלת הראיונות להיום. אפשר לנסות שוב מחר.",
  errBusy: "לא הצלחנו להתחיל את שיחת הקול. אפשר לנסות שוב בעוד דקה.",
  errGeneric: "לא הצלחנו להתחיל את הראיון.",
};

export const STRINGS: Record<Lang, Strings> = { en, he };
