export function fixtureEnv(overrides={}) {
  const env={};
  for(const key of ['SystemRoot','WINDIR','TEMP','TMP','PATH','Path'])if(process.env[key])env[key]=process.env[key];
  return {...env,MODELYMATE_SKIP_ENV_FILES:'true',NODE_ENV:'production',HOST:'127.0.0.1',PORT:'0',
    SITE_AUTH_MODE:'legacy',SESSION_COOKIE_SECURE:'true',TRUST_TAILSCALE_PROXY:'false',
    TRUSTED_PROXY_IPS:'',TAILSCALE_ALLOWED_LOGIN:'',TESLAMATE_BASE_URL:'https://fixture.example.invalid',
    TESLAMATE_INTERNAL_URL:'',TESLAMATE_AUTHORIZATION:'Bearer fixture-only',TESLAMATE_AUTHORIZATION_FILE:'',
    AMAP_KEY:'fixture-public-key',AMAP_SECURITY_CODE:'fixture-only-map-code',...overrides};
}
