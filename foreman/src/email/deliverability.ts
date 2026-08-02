import { promises as dns } from 'node:dns';

/**
 * Does this domain actually let us send as it?
 *
 * A sending domain with a hard-fail SPF record and no include for the
 * provider will have every message disavowed by its own DNS. Nothing throws,
 * nothing bounces at the API — the mail is simply rejected or junked at the
 * far end, and you find out from customers who never replied.
 *
 * So this is checked at boot and surfaced in the UI rather than discovered.
 * It is a report, never a gate: DNS is somebody else's infrastructure and a
 * lookup failing is not a reason to refuse to start.
 */

export type Severity = 'ok' | 'warn' | 'blocker';

export interface Finding {
  severity: Severity;
  what: string;
  detail: string;
}

export interface DeliverabilityReport {
  domain: string;
  findings: Finding[];
  /** True when nothing found would stop mail arriving. */
  looksSendable: boolean;
}

/** `Cubekrafts <info@cubekrafts.com>` and `info@cubekrafts.com` both work. */
export function domainOf(from: string): string | null {
  const match = /<([^>]+)>/.exec(from);
  const address = (match?.[1] ?? from).trim();
  const at = address.lastIndexOf('@');
  if (at === -1) return null;
  const domain = address.slice(at + 1).trim().toLowerCase();
  return domain.includes('.') ? domain : null;
}

/**
 * The `all` mechanism decides what happens to a sender that matched nothing.
 *
 * `-all` says reject it, `~all` says treat it as suspicious, `?all` and `+all`
 * say do not care. Only the first two matter to us, and they matter in
 * opposite directions: `-all` is the one that silently destroys a campaign.
 */
export function allQualifier(spf: string): '-' | '~' | '?' | '+' | null {
  const match = /(^|\s)([-~?+]?)all(\s|$)/i.exec(spf);
  if (!match) return null;
  return (match[2] || '+') as '-' | '~' | '?' | '+';
}

export function includes(spf: string): string[] {
  return [...spf.matchAll(/include:([^\s]+)/gi)].map((m) => m[1]!.toLowerCase());
}

export interface DnsLike {
  resolveTxt(hostname: string): Promise<string[][]>;
}

/**
 * Look up what is published and say what it means.
 *
 * `expectedInclude` is configuration rather than a constant, because which
 * token a provider wants is the provider's business and changes without
 * warning. Left unset, the check still catches the case that actually breaks
 * sending — a hard fail with no obvious provider entry — and asks you to
 * confirm the rest yourself, rather than asserting something it cannot know.
 */
export async function checkDomain(
  domain: string,
  opts: { expectedInclude?: string; resolver?: DnsLike } = {},
): Promise<DeliverabilityReport> {
  const resolver = opts.resolver ?? dns;
  const findings: Finding[] = [];

  let spf: string | null = null;
  try {
    const txt = await resolver.resolveTxt(domain);
    spf = txt.map((parts) => parts.join('')).find((r) => /^v=spf1\b/i.test(r)) ?? null;
  } catch (err) {
    findings.push({
      severity: 'warn',
      what: 'SPF could not be looked up',
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  if (spf === null && findings.length === 0) {
    findings.push({
      severity: 'blocker',
      what: 'no SPF record',
      detail: `${domain} publishes no SPF record, so nothing is authorised to send as it.`,
    });
  } else if (spf !== null) {
    const qualifier = allQualifier(spf);
    const present = includes(spf);
    const wanted = opts.expectedInclude?.toLowerCase();
    const hasProvider = wanted !== undefined && present.includes(wanted);

    if (wanted !== undefined && !hasProvider) {
      findings.push({
        severity: qualifier === '-' ? 'blocker' : 'warn',
        what: `SPF does not include ${wanted}`,
        detail:
          `${domain} publishes "${spf}". ` +
          (qualifier === '-'
            ? 'The -all means anything not listed is explicitly disavowed, so mail sent ' +
              `through this provider will be rejected. Add include:${wanted} before the all.`
            : `Add include:${wanted} so this provider is authorised.`),
      });
    } else if (wanted === undefined) {
      findings.push({
        severity: qualifier === '-' ? 'warn' : 'ok',
        what: 'SPF found, provider not verified',
        detail:
          `${domain} publishes "${spf}". ` +
          (qualifier === '-'
            ? 'It ends in -all, so anything not listed is disavowed. Confirm your ' +
              'provider is one of the includes above, and set EMAIL_SPF_INCLUDE so this ' +
              'check can verify it for you.'
            : 'Set EMAIL_SPF_INCLUDE so this check can confirm your provider is listed.'),
      });
    } else {
      findings.push({
        severity: 'ok',
        what: 'SPF authorises the provider',
        detail: `include:${wanted} is present, ending in ${qualifier ?? 'no'}all.`,
      });
    }

    // Ten is the hard limit in the SPF specification. Past it receivers stop
    // evaluating and return permerror, which fails the same way a wrong
    // record does but is much harder to spot.
    if (present.length >= 9) {
      findings.push({
        severity: 'warn',
        what: 'SPF is close to the lookup limit',
        detail: `${present.length} includes. Past ten, receivers stop evaluating and the record fails.`,
      });
    }
  }

  // DKIM is what survives forwarding, and it is what DMARC will align on once
  // the policy is anything stronger than none.
  const selector = opts.expectedInclude?.includes('resend') ? 'resend' : null;
  if (selector) {
    try {
      await resolver.resolveTxt(`${selector}._domainkey.${domain}`);
      findings.push({ severity: 'ok', what: 'DKIM key published', detail: `${selector}._domainkey.${domain}` });
    } catch {
      findings.push({
        severity: 'blocker',
        what: 'no DKIM key',
        detail: `${selector}._domainkey.${domain} does not resolve. The provider gives you this record when you verify the domain.`,
      });
    }
  }

  try {
    const dmarc = (await resolver.resolveTxt(`_dmarc.${domain}`))
      .map((parts) => parts.join(''))
      .find((r) => /^v=DMARC1\b/i.test(r));
    if (dmarc) {
      const policy = /\bp=(\w+)/i.exec(dmarc)?.[1]?.toLowerCase();
      findings.push({
        severity: policy === 'reject' || policy === 'quarantine' ? 'warn' : 'ok',
        what: `DMARC policy is ${policy ?? 'unset'}`,
        detail:
          policy === 'reject' || policy === 'quarantine'
            ? 'Anything failing both SPF and DKIM alignment will be dropped. Get both right first.'
            : 'Nothing will be dropped on DMARC alone, but receivers still weigh SPF and DKIM.',
      });
    }
  } catch {
    // No DMARC is common and not a blocker on its own.
  }

  return {
    domain,
    findings,
    looksSendable: !findings.some((f) => f.severity === 'blocker'),
  };
}

/** One line per finding, for the boot log. */
export function summarise(report: DeliverabilityReport): string {
  const mark = { ok: '  ok', warn: 'warn', blocker: 'STOP' };
  return [
    `email domain ${report.domain}: ${report.looksSendable ? 'looks sendable' : 'WILL NOT ARRIVE'}`,
    ...report.findings.map((f) => `  [${mark[f.severity]}] ${f.what} — ${f.detail}`),
  ].join('\n');
}
