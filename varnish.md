
## varnish 的缓存生成

首先先来看一下`varnish`源代码中对于Cache TTL的生成，以及几个默认的配置值

- `default_grace` 10.000s

- `default_keep` 0.000s

- `default_ttl` 120.000s

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

### Cache TTL

- status: 302、307 如果有设置`Cache-Control`或者`Expires`，则解析该字段做为缓存时效，或者为`-1`

- status: 202、203、204、300、301、304、404、410、414 如果有设置`Cache-Control`或者`Expires`，则解析该字段做为缓存时效，否则为`default ttl`

- 其它的缓存都设置为不缓存`-1`

### Cache Grace

- 使用配置的默认 grace

- 如果`Response`返回的`Cache-Control`有设置stale-while-revalidate，则使用该值


而我自己在使用`varnish`的实践中，发现有些时间客户没有控制好缓存的配置，因此我是选择设置`default_ttl`为0，Cache TTL 由backend返回的Cache-Control控制。我自己使用的`varnish`配置，主要通过以下的情况

### vcl_recv

- SPDY or HTTP/2.0 `synth(405)`

- method isn't GET HEAD PUT POST TRACE OPTIONS DELETE  `pipe`

- websocket `pipe`

- method isn't GET HEAD `pass`

- Authorization  `pass`

- request url "\?cache=false" or "&cache=false" or Cache-Control == "no-cache"  `pass`


注：如果是GET请求，发送方如果能确定该请求是不可以缓存的，尽量使用设置Request Cache-Control header 的方式

### vcl_backend_response

- ttl 小于0 设置该请求为不可缓存，ttl为120s，`deliver`

- response header Set-Cookie 不为空，设置该请求为不可缓存，ttl为120s，`deliver`

- response header Surrogate-Control ~ "no-store" ，设置该请求为不可缓存，ttl为120s，`deliver`

- response header Surrogate-Control 为空，而且 Cache-Control ~ "no-cache|no-store|private" ，设置该请求为不可缓存，ttl为120s，`deliver`

- response header Vary == '*'，设置该请求为不可缓存，ttl为120s，`deliver`

- 其它的情况(ttl由s-maxage or max-age等生成) `deliver`



根据配置好的`default.vcl`，启动`varnishd`，以及启动测试 server

```bash
varnishd -f ~/github/varnish-generator/examples/default.vcl -a :8001 -p default_ttl=0 -p default_grace=60 -F

node test/support/server
```

## Test

### 不可缓存的请求

- POST/PUT等请求 `vcl_recv` --> `vcl_hash` --> `vcl_pass` --> `vcl_backend_fetch` --> `vcl_response` --> `vcl_deliver`

- 请求关中Cache-Control:no-cache或者url中query参数带有cache=false `vcl_recv` --> `vcl_hash` --> `vcl_pass` --> `vcl_backend_fetch` --> `vcl_response` --> `vcl_deliver`

- HTTP Status 不属于 202、203、204、300、301、302、304、307、404、410、414，响应头设置Cache-Control也无用 `vcl_recv` --> `vcl_hash` --> `vcl_miss` --> `vcl_backend_fetch` --> `vcl_response` --> `vcl_deliver`

- Set-Cookie、max-age=0 等由服务器端返回的数据导致不能缓存的，`vcl_recv` --> `vcl_hash` --> `vcl_miss` --> `vcl_backend_fetch` --> `vcl_response` --> `vcl_deliver`

### 可缓存的GET/HEAD请求

GET /cache/max-age/60 返回数据设置Cache-Control:public, max-age=60

- 无缓存，数据从backend中拉取 `vcl_recv` --> `vcl_hash` --> `vcl_miss` --> `vcl_backend_fetch` --> `vcl_response` --> `vcl_deliver`

- 有缓存且未过期，从缓存中返回，X-Hits + 1  `vcl_recv` --> `vcl_hash` --> `vcl_hit` --> `vcl_deliver`

- 有缓存且已过期，backend正常，过期时间未超过stale(3s)，从缓存中返回，且从backend中拉取数据更新缓存  `vcl_recv` --> `vcl_hash` --> `vcl_hit` --> `vcl_deliver` --> `vcl_backend_fetch` --> `vcl_response`

- 有缓存且已过期(也超过stale)，backend正常，从backend中拉取数据更新缓存 `vcl_recv` --> `vcl_hash` --> `vcl_miss` --> `vcl_backend_fetch` --> `vcl_response` --> `vcl_deliver`

- 有缓存且已过期，backend挂起，过期时间未超过grace(60s)，从缓存中返回 `vcl_recv` --> `vcl_hash` --> `vcl_hit` --> `vcl_deliver` --> `vcl_backend_fetch`

- 有缓存且已过期，backend挂起，过期时间超过grace(60s)，Backend fetch failed `vcl_recv` --> `vcl_hash` --> `vcl_miss` --> `vcl_backend_fetch` --> `vcl_deliver`





`varnish` 是否可以对请求缓存，取决于从后端服务返回的HTTP响应头中的`Cache-Control`. 

有 Cookie 的不做缓存


Varnish decides whether it can store the content or not based on the response it gets back from the backend. The backend can instruct Varnish to cache the content with the HTTP response header Cache-Control. There are a few conditions where Varnish will not cache, the most common one being the use of cookies. Since cookies indicates a client-specific web object, Varnish will by default not cache it.






202、203、204、300、301、304、404、410、414 如果有设置`Cache-Control`或者`Expires`，则解析该字段做为缓存时效，或者为`default ttl`

其它的缓存都设置为不缓存`-1`

https://www.varnish-cache.org/docs/5.0/users-guide/vcl-built-in-subs.html


set directors round_robin random ....


## client side

vcl_recv --> hash

vcl_recv --> pass

vcl_recv --> pipe

vcl_recv --> synth

vcl_recv --> purge


vcl_pipe --> pipe

vcl_pipe --> synth


vcl_pass --> fetch

vcl_pass --> restart

vcl_pass --> synth

Called when a cache lookup is successful. The object being hit may be stale: It can have a zero or negative ttl with only grace or keep time left.
vcl_hit --> deliver

vcl_hit --> miss

vcl_hit --> pass

vcl_hit --> restart

vcl_hit --> synth


vcl_miss --> fetch

vcl_miss --> pass

vcl_miss --> restart

vcl_miss --> synth


vcl_hash --> lookup


vcl_purge --> restart

vcl_purge --> synth


vcl_deliver --> deliver

vcl_deliver --> restart

vcl_deliver --> synth


vcl_synth --> deliver

vcl_synth --> restart


## Backend Side

vcl_backend_fetch --> fetch

vcl_backend_fetch --> abandon



vcl_backend_response --> deliver

vcl_backend_response --> abandon

vcl_backend_response --> retry



vcl_backend_error --> deliver

vcl_backend_error --> retry



vcl_init --> ok

vcl_init --> fail


vcl_fini --> ok

https://www.varnish-cache.org/docs/5.0/users-guide/purging.html

Forcing a cache miss
The final way to invalidate an object is a method that allows you to refresh an object by forcing a hash miss for a single request. If you set 'req.hash_always_miss' to true, Varnish will miss the current object in the cache, thus forcing a fetch from the backend. This can in turn add the freshly fetched object to the cache, thus overriding the current one. The old object will stay in the cache until ttl expires or it is evicted by some other means.



https://www.varnish-cache.org/docs/5.0/reference/states.html



https://www.varnish-cache.org/docs/5.0/reference/vmod_std.generated.html