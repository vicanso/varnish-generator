varnish 是否可以对请求缓存，取决于从后端服务返回的HTTP响应头中的`Cache-Control`. 

有 Cookie 的不做缓存


Varnish decides whether it can store the content or not based on the response it gets back from the backend. The backend can instruct Varnish to cache the content with the HTTP response header Cache-Control. There are a few conditions where Varnish will not cache, the most common one being the use of cookies. Since cookies indicates a client-specific web object, Varnish will by default not cache it.




302、307 如果有设置`Cache-Control`或者`Expires`，则解析该字段做为缓存时效，或者为`-1`

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