
```c
void
RFC2616_Ttl(struct busyobj *bo, double now, double *t_origin,
    float *ttl, float *grace, float *keep)
{
  unsigned max_age, age;
  double h_date, h_expires;
  const char *p;
  const struct http *hp;

  CHECK_OBJ_NOTNULL(bo, BUSYOBJ_MAGIC);
  assert(now != 0.0 && !isnan(now));
  AN(t_origin);
  AN(ttl);
  AN(grace);
  AN(keep);

  *t_origin = now;
  *ttl = cache_param->default_ttl;
  *grace = cache_param->default_grace;
  *keep = cache_param->default_keep;

  hp = bo->beresp;

  max_age = age = 0;
  h_expires = 0;
  h_date = 0;

  /*
   * Initial cacheability determination per [RFC2616, 13.4]
   * We do not support ranges to the backend yet, so 206 is out.
   */

  if (http_GetHdr(hp, H_Age, &p)) {
    /*
     * We deliberately run with partial results, rather than
     * reject the Age: header outright.  This will be future
     * compatible with fractional seconds.
     */
    age = strtoul(p, NULL, 10);
    *t_origin -= age;
  }

  if (http_GetHdr(hp, H_Expires, &p))
    h_expires = VTIM_parse(p);

  if (http_GetHdr(hp, H_Date, &p))
    h_date = VTIM_parse(p);

  switch (http_GetStatus(hp)) {
  default:
    *ttl = -1.;
    break;
  case 302: /* Moved Temporarily */
  case 307: /* Temporary Redirect */
    /*
     * https://tools.ietf.org/html/rfc7231#section-6.1
     *
     * Do not apply the default ttl, only set a ttl if Cache-Control
     * or Expires are present. Uncacheable otherwise.
     */
    *ttl = -1.;
    /* FALL-THROUGH */
  case 200: /* OK */
  case 203: /* Non-Authoritative Information */
  case 204: /* No Content */
  case 300: /* Multiple Choices */
  case 301: /* Moved Permanently */
  case 304: /* Not Modified - handled like 200 */
  case 404: /* Not Found */
  case 410: /* Gone */
  case 414: /* Request-URI Too Large */
    /*
     * First find any relative specification from the backend
     * These take precedence according to RFC2616, 13.2.4
     */

    if ((http_GetHdrField(hp, H_Cache_Control, "s-maxage", &p) ||
        http_GetHdrField(hp, H_Cache_Control, "max-age", &p)) &&
        p != NULL) {

      if (*p == '-')
        max_age = 0;
      else
        max_age = strtoul(p, NULL, 0);

      *ttl = max_age;
      break;
    }

    /* No expire header, fall back to default */
    if (h_expires == 0)
      break;


    /* If backend told us it is expired already, don't cache. */
    if (h_expires < h_date) {
      *ttl = 0;
      break;
    }

    if (h_date == 0 ||
        fabs(h_date - now) < cache_param->clock_skew) {
      /*
       * If we have no Date: header or if it is
       * sufficiently close to our clock we will
       * trust Expires: relative to our own clock.
       */
      if (h_expires < now)
        *ttl = 0;
      else
        *ttl = h_expires - now;
      break;
    } else {
      /*
       * But even if the clocks are out of whack we can still
       * derive a relative time from the two headers.
       * (the negative ttl case is caught above)
       */
      *ttl = (int)(h_expires - h_date);
    }

  }

  /*
   * RFC5861 outlines a way to control the use of stale responses.
   * We use this to initialize the grace period.
   */
  if (*ttl >= 0 && http_GetHdrField(hp, H_Cache_Control,
      "stale-while-revalidate", &p) && p != NULL) {

    if (*p == '-')
      *grace = 0;
    else
      *grace = strtoul(p, NULL, 0);
  }

  VSLb(bo->vsl, SLT_TTL,
      "RFC %.0f %.0f %.0f %.0f %.0f %.0f %.0f %u",
      *ttl, *grace, *keep, now,
      *t_origin, h_date, h_expires, max_age);
}
```