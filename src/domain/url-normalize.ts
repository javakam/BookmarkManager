export type UrlChangeType =
  | 'host-lowercased'
  | 'www-removed'
  | 'default-port-removed'
  | 'trailing-slash-removed'
  | 'tracking-parameter-removed'
  | 'query-removed'
  | 'fragment-removed';

export interface UrlChange {
  readonly type: UrlChangeType;
  readonly before?: string;
  readonly after?: string;
  readonly parameter?: string;
}

export interface NormalizedUrlCandidates {
  readonly conservativeKey: string;
  readonly looseKey: string;
  readonly conservativeChanges: readonly UrlChange[];
  readonly looseChanges: readonly UrlChange[];
}

interface RawAuthority {
  readonly hostname: string;
  readonly port?: string;
  readonly rawPath: string;
}

const TRACKING_PARAMETER = /^(?:utm_.+|fbclid|gclid|spm)$/iu;

function freezeChange(change: UrlChange): UrlChange {
  return Object.freeze(change);
}

function extractRawAuthority(rawUrl: string): RawAuthority | undefined {
  const match = /^(?:https?):\/\/([^/?#]*)([^?#]*)/iu.exec(rawUrl);
  if (!match) {
    return undefined;
  }

  const authority = match[1].slice(match[1].lastIndexOf('@') + 1);
  if (authority.startsWith('[')) {
    const closingBracket = authority.indexOf(']');
    if (closingBracket === -1) {
      return undefined;
    }
    const port = authority.slice(closingBracket + 1).match(/^:(\d+)$/u)?.[1];
    return {
      hostname: authority.slice(0, closingBracket + 1),
      port,
      rawPath: match[2],
    };
  }

  const portMatch = /:(\d+)$/u.exec(authority);
  return {
    hostname: portMatch ? authority.slice(0, portMatch.index) : authority,
    port: portMatch?.[1],
    rawPath: match[2],
  };
}

function serializeAuthority(parsed: URL, hostname: string): string {
  const credentials = parsed.username
    ? `${parsed.username}${parsed.password ? `:${parsed.password}` : ''}@`
    : '';
  return `${parsed.protocol}//${credentials}${hostname}${
    parsed.port ? `:${parsed.port}` : ''
  }`;
}

function decodedParameterName(rawParameter: string): string {
  const rawName = rawParameter.split('=', 1)[0].replace(/\+/gu, ' ');
  try {
    return decodeURIComponent(rawName);
  } catch {
    return rawName;
  }
}

export function normalizeUrlCandidates(
  rawUrl: string,
): NormalizedUrlCandidates | undefined {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return undefined;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return undefined;
  }

  const rawAuthority = extractRawAuthority(rawUrl);
  if (!rawAuthority) {
    return undefined;
  }

  const conservativeChanges: UrlChange[] = [];
  const rawLowercaseHostname = rawAuthority.hostname.toLowerCase();
  if (rawAuthority.hostname !== rawLowercaseHostname) {
    conservativeChanges.push(
      freezeChange({
        type: 'host-lowercased',
        before: rawAuthority.hostname,
        after: rawLowercaseHostname,
      }),
    );
  }

  let conservativeHostname = parsed.hostname.toLowerCase();
  if (conservativeHostname.startsWith('www.')) {
    conservativeChanges.push(
      freezeChange({
        type: 'www-removed',
        before: conservativeHostname,
        after: conservativeHostname.slice(4),
      }),
    );
    conservativeHostname = conservativeHostname.slice(4);
  }

  const defaultPort = parsed.protocol === 'https:' ? '443' : '80';
  if (rawAuthority.port === defaultPort) {
    conservativeChanges.push(
      freezeChange({
        type: 'default-port-removed',
        before: rawAuthority.port,
        after: '',
      }),
    );
  }

  let conservativePath = parsed.pathname;
  if (rawAuthority.rawPath.endsWith('/')) {
    conservativePath = conservativePath.slice(0, -1);
    conservativeChanges.push(
      freezeChange({
        type: 'trailing-slash-removed',
        before: parsed.pathname,
        after: conservativePath,
      }),
    );
  } else if (conservativePath === '/') {
    conservativePath = '';
  }

  const keptQueryParts: string[] = [];
  const rawQuery = parsed.search.slice(1);
  if (rawQuery) {
    for (const rawParameter of rawQuery.split('&')) {
      const parameter = decodedParameterName(rawParameter);
      if (TRACKING_PARAMETER.test(parameter)) {
        conservativeChanges.push(
          freezeChange({
            type: 'tracking-parameter-removed',
            before: rawParameter,
            after: '',
            parameter,
          }),
        );
      } else {
        keptQueryParts.push(rawParameter);
      }
    }
  }
  const conservativeSearch = keptQueryParts.length
    ? `?${keptQueryParts.join('&')}`
    : '';
  const conservativeKey = `${serializeAuthority(
    parsed,
    conservativeHostname,
  )}${conservativePath}${conservativeSearch}${parsed.hash}`;

  const looseChanges: UrlChange[] = [];
  if (parsed.search) {
    looseChanges.push(
      freezeChange({ type: 'query-removed', before: parsed.search, after: '' }),
    );
  }
  if (parsed.hash) {
    looseChanges.push(
      freezeChange({
        type: 'fragment-removed',
        before: parsed.hash,
        after: '',
      }),
    );
  }
  const looseKey = `${serializeAuthority(
    parsed,
    parsed.hostname.toLowerCase(),
  )}${parsed.pathname}`;

  return Object.freeze({
    conservativeKey,
    looseKey,
    conservativeChanges: Object.freeze(conservativeChanges),
    looseChanges: Object.freeze(looseChanges),
  });
}
