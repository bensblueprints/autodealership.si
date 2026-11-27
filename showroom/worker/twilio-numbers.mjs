// A dealer can import existing SMS senders from its assigned Twilio Messaging Service.
const numberSid = /^PN[a-f0-9]{32}$/i;
export function managedTwilioAccount(routes, site) {
  const account = routes?.[site];
  if (!account || !/^AC[a-f0-9]{32}$/i.test(account.account || "") ||
      !/^MG[a-f0-9]{32}$/i.test(account.service || "") || !/^[a-z0-9]{32}$/i.test(account.authToken || "")) return null;
  if (Object.entries(routes).some(([id, other]) => id !== site && other &&
      (other.account === account.account || other.service === account.service || (account.from && account.from === other.from)))) return null;
  return account;
}
function ownedNumber(row, account) {
  return row?.account_sid === account.account && row.service_sid === account.service &&
    numberSid.test(row.sid) && /^\+[1-9]\d{7,14}$/.test(row.phone_number) && row.capabilities?.includes("SMS");
}
async function getNumberResource(url, account, transport) {
  const response = await transport(url, {headers:{Authorization:"Basic "+btoa(account.account+":"+account.authToken)},
    redirect:"error",signal:AbortSignal.timeout(8000)});
  if (!response.ok) throw Error("Twilio could not verify this dealership’s sender pool.");
  return response.json();
}
export async function listTwilioNumbers(account, transport=fetch) {
  const base = "https://messaging.twilio.com/v1/Services/"+account.service+"/PhoneNumbers";
  let url = base+"?PageSize=100";
  const rows = [], seen = new Set();
  while (url) {
    const page = new URL(url);
    if (page.origin !== "https://messaging.twilio.com" || page.pathname !== new URL(base).pathname ||
        page.username || page.password || seen.has(page.href)) throw Error("Unexpected Twilio pagination.");
    seen.add(page.href);
    const data = await getNumberResource(page.href, account, transport);
    if (!Array.isArray(data.phone_numbers)) throw Error("Twilio returned an incomplete sender list.");
    for (const row of data.phone_numbers) if (ownedNumber(row,account)) rows.push({sid:row.sid,phone:row.phone_number});
    url = data.meta?.next_page_url || "";
  }
  return rows;
}
export async function verifyTwilioNumber(account, sid, transport=fetch) {
  if (!numberSid.test(sid || "")) return null;
  const row = await getNumberResource("https://messaging.twilio.com/v1/Services/"+account.service+"/PhoneNumbers/"+sid, account, transport);
  return row.sid===sid && ownedNumber(row,account) ? {sid,phone:row.phone_number} : null;
}
export async function createNumberRegistry(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS public.dealer_twilio_numbers(
    sid text PRIMARY KEY, phone text UNIQUE NOT NULL, site uuid NOT NULL REFERENCES public.client_sites(id) ON DELETE CASCADE,
    account text NOT NULL, service text NOT NULL, imported_at timestamptz NOT NULL DEFAULT now())`);
}
