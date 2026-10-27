export type KodoService = 'up' | 'rs' | 'rsf';
export interface RegionEndpointFailure {
  service: KodoService | 'region';
  category: 'INVALID_REGION_STRUCTURE' | 'INVALID_DOMAINS' | 'EMPTY_DOMAINS' | 'TOO_MANY_DOMAINS' | 'NON_STRING_HOST' | 'URL_SCHEME' | 'CREDENTIALS' | 'PORT' | 'INVALID_HOST_SYNTAX' | 'WRONG_SERVICE' | 'UNRECOGNIZED_DOMAIN';
  domainClass: 'qbox.me' | 'qiniuapi.com' | 'qiniu.com' | 'qiniup.com' | 'other' | 'not-a-host';
  index?: number;
}
export interface KodoEndpoints { up: string[]; rs: string[]; rsf: string[]; }
export function isAllowedServiceHost(service: string, host: unknown): boolean;
export function parseRegionEndpoints(value: unknown): KodoEndpoints;
export class RegionEndpointError extends Error {
  readonly code: 'INVALID_REGION_ENDPOINT';
  readonly failure: RegionEndpointFailure;
  constructor(service: RegionEndpointFailure['service'], category: RegionEndpointFailure['category'], domainClass?: RegionEndpointFailure['domainClass'], index?: number);
}
