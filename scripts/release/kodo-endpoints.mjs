// qiniu/nodejs-sdk v7.15.5 Region.fromRegionId + official Kodo region table.
// Only the reviewed management qbox hosts are added; this is not *.qbox.me.
const reviewedRegions = ['z0', 'cn-east-2', 'z1', 'z2', 'na0', 'as0', 'ap-southeast-2', 'ap-southeast-3'];
const services = ['up', 'rs', 'rsf'];
const legacy = {
  up: /^(?:up|upload)(?:-[a-z0-9]+)*\.(?:qiniup\.com|qbox\.me)$/,
  rs: /^rs(?:-[a-z0-9]+)*\.(?:qiniuapi\.com|qiniu\.com)$/,
  rsf: /^rsf(?:-[a-z0-9]+)*\.(?:qiniuapi\.com|qiniu\.com)$/,
};
const qbox = Object.fromEntries(['rs', 'rsf'].map(service => [service, new Set(reviewedRegions.map(region => `${service}-${region}.qbox.me`))]));
const dnsHost = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
function syntaxFailure(host) {
  if (typeof host !== 'string') return 'NON_STRING_HOST';
  if (/[\u0000-\u0020\u007f]/.test(host)) return 'INVALID_HOST_SYNTAX';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(host)) return 'URL_SCHEME';
  if (host.includes('@')) return 'CREDENTIALS';
  if (host.includes(':')) return 'PORT';
  if (!dnsHost.test(host)) return 'INVALID_HOST_SYNTAX';
  return null;
}
function family(host) {
  for (const suffix of ['qbox.me', 'qiniuapi.com', 'qiniu.com', 'qiniup.com']) if (host === suffix || host.endsWith(`.${suffix}`)) return suffix;
  return 'other';
}

export function isAllowedServiceHost(service, host) {
  return services.includes(service) && syntaxFailure(host) === null && (legacy[service].test(host) || qbox[service]?.has(host) === true);
}
export class RegionEndpointError extends Error {
  constructor(service, category, domainClass = 'not-a-host', index) {
    super(`Region endpoint rejected: ${service}/${category}/${domainClass}`);
    this.name = 'RegionEndpointError'; this.code = 'INVALID_REGION_ENDPOINT';
    this.failure = Object.freeze({ service, category, domainClass, ...(index === undefined ? {} : { index }) });
  }
}

/** Match the SDK v4 hosts[0].{up,rs,rsf}.domains shape; never echo raw input. */
export function parseRegionEndpoints(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.hosts) || !value.hosts.length || !value.hosts[0] || typeof value.hosts[0] !== 'object' || Array.isArray(value.hosts[0])) throw new RegionEndpointError('region', 'INVALID_REGION_STRUCTURE');
  const record = value.hosts[0], endpoints = {};
  for (const service of services) {
    const domains = record[service]?.domains;
    if (!Array.isArray(domains)) throw new RegionEndpointError(service, 'INVALID_DOMAINS');
    if (!domains.length) throw new RegionEndpointError(service, 'EMPTY_DOMAINS');
    if (domains.length > 16) throw new RegionEndpointError(service, 'TOO_MANY_DOMAINS');
    for (let index = 0; index < domains.length; index++) {
      const host = domains[index], invalidSyntax = syntaxFailure(host);
      if (invalidSyntax) throw new RegionEndpointError(service, invalidSyntax, 'not-a-host', index);
      if (!isAllowedServiceHost(service, host)) {
        const category = services.some(other => other !== service && isAllowedServiceHost(other, host)) ? 'WRONG_SERVICE' : 'UNRECOGNIZED_DOMAIN';
        throw new RegionEndpointError(service, category, family(host), index);
      }
    }
    endpoints[service] = domains.map(host => `https://${host}`);
  }
  return endpoints;
}
