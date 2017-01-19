
使用`varnish`做缓存来提升系统的并发能力，它配置简单，性能强悍，因此很多后端开发者都喜欢使用它，但是很多人都没有真正的使用好。下面是我使用`varnish`以来，自己的一些见解（本文基于varnish 5.x）,首先下面是我`varnish`配置遵循的三个准则:

- `varnish`配置中不出现针对特别url的处理，保证vcl配置的通用性

    如`req.url ~ "/user/me"`之类的配置在varnish中不使用，在最开始使用`varnish`的时候，我也是经常使用这样的配置方式，最后发现完全没办法管理 ，而且每次增加项目，完全没办法直接加入现有的`varnish`,每次都要新增，完全无法做为一种服务存在

- 有特定的规则可以在`varnish`收到请求时，则判断是该请求是否可以缓存

    对于不可缓存的请求（这个在开发过程中可以确定），发起HTTP请求时，使用特定的query参数`cache=false`或者设置`Cache-Control:no-cache`，则可以在`recv`阶段直接`pass`给backend，提升处理性能

- 缓存的时效性通过`Cache-Control`来设置，而且尽量不设置太长

    对于数据的缓存，我刚开始使用的时候，也是有多长时间设置多长时间的，后来发现，其实完全没有这个必要，请求`/books`，如果设置`Cache-Control:max-age=3600`，那么的确是3600秒才请求backend一次，但是如果我设置为`Cache-Control:max-age=3600, s-maxage=60`，对于backend是每60秒会请求一次，但是性能上感觉不到什么区别。那么后一种配置有什么好处呢？首先避免占用过高的内存使用，其次我自己在使用过程中的确出现过由于人为原因配置了错误的数据，导致接口缓存数据错误，需要手工清除缓存的情况，找出所有可能影响的url，对所有的varnish一一清除，这也是很浪费时间而且容易出错的事情。（我自己的使用实践是基本不会设置s-maxage超过300s）

下面我再来详细解我制定上面三个准则的过程中，对于`varnish`的一些理解：

### 不可以缓存的请求，应该是怎么处理更加便捷？

`varnish`中判断请求不可缓存的方式有两种，一种是在`vcl_recv`处理函数中定义规则对哪些HTTP请求不做缓存，还有一种就是在`vcl_backend_response`设置该请求的响应为`uncacheable`，并设置`ttl`。这两种方式中，第一种方式效率更高，我一开始使用的时候，经常是每多一个（一类）请求，就增加一条判断，如：

```
sub vcl_recv {

  ...

  if(req.url ~ "/user/me" || req.url ~ "/fav/book") {
    return (pass);
  }

  ...

}
```

后来发现这种做法实在是太麻烦了，在使用`varnish`时，希望多个项目可以共享，因此配置文件是公共的，每个项目的url规则不一，配置越来越多，简直有点无从管理了。后续开始偷懒，调整为后一种方式，要求后端对所有响应的请求都必须设置`Cache-Control`字段，通过该字段来判断该请求是否可用，配置文件如下：

```
sub vcl_backend_response {

  ...

  # The following scenarios set uncacheable
  if (beresp.ttl <= 0s ||
    beresp.http.Set-Cookie ||
    beresp.http.Surrogate-Control ~ "no-store" ||
    (!beresp.http.Surrogate-Control &&
      beresp.http.Cache-Control ~ "no-cache|no-store|private") ||
    beresp.http.Vary == "*"){
    # Hit-For-Pass
    set beresp.uncacheable = true;
    set beresp.ttl = 120s;
    set beresp.grace = 0s;
    return (deliver);
  }

  ...

}
```

通过各后端配置HTTP响应头来判定缓存的使用问题，使用了一段时间，并没有发现有什么异常之处，但是总觉得这种判断有点事后补救的方式，因为很多请求在使用的时候就已经知道该请求是不能缓存的，因此完善了一下`vcl_recv`的配置，调整为：

```
sub vcl_recv {

  ...

  # no cache request
  if(req.http.Cache-Control == "no-cache" || req.url ~ "\?cache=false" || req.url ~ "&cache=false"){
    return (pass);
  }

  ...

}
```

调整之后，提供了通用的方式可以直接在`vcl_recv`阶段直接不使用缓存，在接口请求的时候，如果确认该请求是不可缓存的，则设置HTTP请求头的`Cache-Control`或者增加url query的方式，经过此调用之后，对于不可缓存的请求的处理已经是一种通用的模式，`varnish`对接的是多少个应用也不再需要重复配置了。可能有人会觉得这种方式会导致如果有恶意攻击者，可以绕过了`varnish`，直接请求到`backend`，对于这个问题，我的处理方式是，如果该请求是可以缓存的，但是请求的HTTP头中带有`Cache-Control:no-cache`或者query中有`cache=false`，则表明是恶意请求，直接返回出错，并记录IP。

注：设置`uncacheable`的响应并不是不缓存，而是被缓存起来，在下一次请求的时候，命中缓存，但该缓存不是直接返回，再是hit for pass。可以简单的认为，这个请求是有缓存，但是该缓存不是直接使用，而是告诉后续的相同请求，应该做`pass`操作


### varnish的缓存是根据什么来保存的，怎么区分是否同一个缓存？

对于这个问题，最简单的方式就是直接上`vcl_hash`的配置说明：

```
sub vcl_hash{
  hash_data(req.url);
  if (req.http.host) {
    hash_data(req.http.host);
  } else {
    hash_data(server.ip);
  }
  return (lookup);
}
```

由上面的配置可以看出，`varnish`是使用请求的url + 请求的HTTP头中的host，如果没有host，则取服务器的ip。这里需要注意，尽量保证经过`varnish`的请求都有Host，如果是直接取`server.ip`，对于多backend的应用，就会导致每个backend的缓存都会保存一份。当然如果你能保证该`varnish`只是一个应用程序使用，只需要根据`req.url`部分就能区分，那么可以精简`vcl_hash`的判断（不建议）：

```
sub vcl_hash{
  hash_data(req.url);
  return (lookup);
}
```

知道`varnish`的缓存方式之后，下面来看以下问题：

- `/books?type=it&limit=2` 与 `/books?limit=2&type=it` 这两个url是否使用同一份缓存
- 如果有人恶意的使用不同的参数，那么是不是导致`varnish`的缓存会一直在增加

对于第一个问题，两个url被认为是不相同的，使用的缓存不是同一份，那么这个应该怎么解决呢？`varnish`提供了`querysort`的函数，使用该函数在`vcl_recv`中将`req.url`重新调整则可。

那么第二个问题呢？暂时我所知道的是，`varnish`上暂时无法对这种做什么优化的处理，所以我使用的方式是在后端对参数做严格的校验，不符合的参数（有多余的参数）都直接响应失败。

注：大家是否都很想去试试通过增加时间戳的方式调用别人的`varnish`，把别人的`varnish`挤爆？如果大家想试，最好试自己的`varnish`就好，大家可能会发现，响应的请求数据大部分才几KB，过期时间也不会很长，内存又大，还没挤完，旧的就已过过期了。^-^

#### 是不是设置了Cache-Control请求就会缓存，如果该响应刚好出错了怎么办？

对于这个问题，很多人可能都不清楚如果响应出错的时候，缓存是会缓存还是不会呢？这个问题我一开始也是没找到文档说明，所以我最开始的处理方式是，如果请求出错的时候，把`Cache-Control:no-cache`重新设置一次，后面去了解`varnish`的代码，发现有如下的实现：


```c
void
RFC2616_Ttl(struct busyobj *bo, double now, double *t_origin,
    float *ttl, float *grace, float *keep)

  ...

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

  ...

}
```

详细的代码可以查看[RFC2616_Ttl](https://github.com/vicanso/varnish-generator/blob/master/RFC2616_Ttl.md)或者直接从`varnish`的源码中搜索`RFC2616_Ttl`函数。

从上面的代码可以看出，只对于特定的`HTTP Status Code`，才会根据`Cache-Control`或者`Expires`来设置缓存时间，非上述状态码的请求，就算是设置了也无效。`Cache-Control`中可以设置max-age与s-maxage为配置客户端缓存与`varnish`缓存的不同。那么有没办法对出错的请求做`varnish`缓存了呢？是可以的，调整`vcl_backend_response`的配置：

```
sub vcl_backend_response {

  ...

  if (beresp.status == 500 && beresp.http.Force-Caching) {
    set beresp.ttl = 120s;
    return (deliver);
  }

  ...

}
```

上面的配置可以实现如果HTTP Status Code是500，并且后端有返回HTTP响应头`Force-Caching`，则将出错的请求也缓存，但我不建议使用这种方式，当然如果真有这种需要，可以对这种处理做更完善的调整，如缓存时间从Cache-Control中获取等等。

#### 当一开始并没有缓存的时候，相同url的并发请求到达同一个varnish实例，后端会接收到多少个请求呢？


- 当并发可缓存的请求，后端只收到一条请求，其它的请求由`varnish`保存到队列中，当有正常响应时，将队列中的请求一一响应（非正常响应的处理在后续讲解）
- 当并发不可缓存请求（指由后端返回Cache-Control:no-cache ），`varnish`发出第一个请求，此时由于不知道该请求是否可以缓存，因此其它请求进入队列，在请求响应时，确认该请求不可缓存，队列相关请求转发到后端
- 当并发请求时，如果此时后端不可用(503，后端响应太慢，varnish认为响应超时)，所有并发请求使用同一响应返回，后端只接收到一个请求。
- 当并发请求时，如果后端的最终响应是不可缓存的HTTP Status（如500等），那么进入队列的其它请求会在收到出错响应的时候，全部转发至后端

由上面的测试可以看出，如果请求无法在`vcl_recv`中无法判断是否非缓存请求，并发的请求都会先进入队列，等第一个请求响应结果再决定是复制使用当前响应数据还是直接转发到后端请求。这里需要特别注意的是，如果本能缓存的请求，但是因为接口报错（依赖的其它系统超时之类），导致该接口不能缓存，如果此时等待的请求特别多，那么这些请求全部往后端转发时，有可能导致后端系统支撑不了。


#### 使用m-stale提升过期数据的响应

在真实使用的环境中，数据在刚过期的时间，为了更好的响应速度，我希望能够直接使用过期数据返回（因为刚过期，时效性还是能保证的），同时去更新缓存的数据，因此调整`vcl_hit`的配置，从`Cache-Control`中获取`m-stale`：

```
sub vcl_hit {

  ...

  # backend is healthy
  if (std.healthy(req.backend_hint)) {
    # set the stale
    if(obj.ttl + std.duration(std.integer(regsub(obj.http.Cache-Control, "[\s\S]*m-stale=(\d)+[\s\S]*", "\1"), 2) + "s", 2s) > 0s){
      return (deliver);
    }
  }

  ...

}

```

#### 将default_ttl设置为0

在我使用varnish的实践中，由于后端都使用`Cache-Control`字段，`default_ttl`的意义变得不怎么有用，而且在实践中发现，这个值无论设置多少感觉都无法满足大部分接口的使用（除非是静态文件服务器），而且使用该字段之后，后端开发有可能是因为忘记写`Cache-Control`而将本不该缓存的请求缓存起来，因此我更建议将`default_ttl`设置为0（避免将不可缓存的数据缓存起来），所有的缓存时间都由后端开发自己使用`max-age`或`s-maxage`控制


#### 下面列举使用上述配置之后，不同类型的HTTP请求响应流程

##### 不可缓存的请求

- POST/PUT等请求 `vcl_recv` --> `vcl_hash` --> `vcl_pass` --> `vcl_backend_fetch` --> `vcl_response` --> `vcl_deliver`

- 请求头中Cache-Control:no-cache或者url中query参数带有cache=false `vcl_recv` --> `vcl_hash` --> `vcl_pass` --> `vcl_backend_fetch` --> `vcl_response` --> `vcl_deliver`

- HTTP Status Code 不属于 202、203、204、300、301、302、304、307、404、410、414，响应头设置Cache-Control也无用 `vcl_recv` --> `vcl_hash` --> `vcl_miss` --> `vcl_backend_fetch` --> `vcl_response` --> `vcl_deliver`

- Set-Cookie、max-age=0 等由服务器端返回的数据设置不能缓存的，`vcl_recv` --> `vcl_hash` --> `vcl_miss` --> `vcl_backend_fetch` --> `vcl_response` --> `vcl_deliver`

##### 可缓存的GET/HEAD请求

GET /cache/max-age/60 返回数据设置Cache-Control:public, max-age=60

- 无缓存，数据从backend中拉取 `vcl_recv` --> `vcl_hash` --> `vcl_miss` --> `vcl_backend_fetch` --> `vcl_response` --> `vcl_deliver`

- 有缓存且未过期，从缓存中返回，X-Hits + 1  `vcl_recv` --> `vcl_hash` --> `vcl_hit` --> `vcl_deliver`

- 有缓存且已过期，backend正常，过期时间未超过stale(3s)，从缓存中返回，且从backend中拉取数据更新缓存  `vcl_recv` --> `vcl_hash` --> `vcl_hit` --> `vcl_deliver` --> `vcl_backend_fetch` --> `vcl_response`

- 有缓存且已过期(也超过stale)，backend正常，从backend中拉取数据更新缓存 `vcl_recv` --> `vcl_hash` --> `vcl_miss` --> `vcl_backend_fetch` --> `vcl_response` --> `vcl_deliver`

- 有缓存且已过期，backend挂起，过期时间未超过grace(60s)，从缓存中返回 `vcl_recv` --> `vcl_hash` --> `vcl_hit` --> `vcl_deliver` --> `vcl_backend_fetch`

- 有缓存且已过期，backend挂起，过期时间超过grace(60s)，Backend fetch failed `vcl_recv` --> `vcl_hash` --> `vcl_miss` --> `vcl_backend_fetch` --> `vcl_deliver`
